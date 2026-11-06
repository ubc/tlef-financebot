/** Clone two already parsed public chapters into an independent local course.
 * Copies verified vectors, or rebuilds missing vectors using local FastEmbed.
 * No LLM calls, cache rows, source assignments or original-course mutations. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { coursesCol, materialsCol, materialChunksCol, contentRunsCol } from '../server/src/components/mongodb/collections';
import { qdrant, ensureCollection, upsertPoints, collectionVectorSize, deleteCollectionIfExists } from '../server/src/components/qdrant';
import { embed } from '../server/src/components/genai/embeddings';
import { courseCollection } from '../server/src/services/materials.service';
import { getMaterialSourceReadiness, hashSourceChunks } from '../server/src/services/source-readiness.service';
import { initializeAuthoringCommitSupport } from '../server/src/services/authoring-commit.service';

async function main(): Promise<void> {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.qdrantUrl).hostname));
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_[a-z0-9_-]+$/);
  const originalPath = 'audit-results/generation-quality-corpus/fixture.json';
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : 'audit-results/generation-quality-corpus/generation-fixture.json';
  assert.ok(output, 'Pass --output <new-fixture.json>.');
  const original = JSON.parse(await readFile(originalPath, 'utf8')) as { courseId: string; database: string; baseMaterialIds: string[] };
  assert.equal(original.database, env.mongodbDbName);
  await connectMongo();
  const courseId = new ObjectId(); const originalCourseId = new ObjectId(original.courseId);
  const actor = `QUALITY-GENERATION-FIXTURE-${randomUUID()}`;
  let retained = false;
  try {
    assert.equal((await initializeAuthoringCommitSupport()).available, true);
    const originalCourse = await coursesCol().findOne({ _id: originalCourseId }); assert.ok(originalCourse);
    await coursesCol().insertOne({ ...originalCourse, _id: courseId, name: 'Public risk chapters · isolated generation acceptance', courseCode: `QA${courseId.toHexString().slice(-8)}`, ownerPuid: actor, registrationCode: randomUUID(), createdAt: new Date(), published: false, lifecycle: 'draft' });
    const sources = await materialsCol().find({ courseId: originalCourseId, _id: { $in: original.baseMaterialIds.map(id => new ObjectId(id)) }, name: /^Chapter [34]:/ }).sort({ name: 1 }).toArray();
    assert.equal(sources.length, 2);
    const originalCollection = courseCollection(originalCourseId); const collection = courseCollection(courseId);
    const originalInfo = await qdrant.getCollection(originalCollection);
    const size = collectionVectorSize(originalInfo.config.params.vectors); assert.ok(size);
    await ensureCollection(collection, size);
    const provenance: Array<Record<string, unknown>> = [];
    for (const source of sources) {
      const chunks = await materialChunksCol().find({ courseId: originalCourseId, materialId: source._id }).sort({ index: 1 }).toArray();
      const manifest = source.sourceManifest; assert.ok(manifest, 'Original manifest is required.');
      assert.equal(chunks.length, manifest.chunkCount); assert.equal(hashSourceChunks(chunks), manifest.sourceTextHash);
      assert.equal(chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), manifest.characterCount);
      assert.ok(chunks.every((chunk, index) => chunk.index === index && chunk.characterCount === chunk.text.length && chunk.text.trim()));
      const materialId = new ObjectId(); const runId = new ObjectId();
      const points: Array<{ id: string | number; vector: number[]; payload: Record<string, unknown> }> = [];
      let offset: string | number | undefined;
      do {
        const page = await qdrant.scroll(originalCollection, { filter: { must: [{ key: 'materialId', match: { value: source._id.toHexString() } }] }, limit: 200, with_payload: true, with_vector: true, ...(offset !== undefined ? { offset } : {}) });
        for (const point of page.points) {
          const index = point.payload?.chunkIndex;
          assert.ok(typeof index === 'number' && Number.isInteger(index) && chunks[index]);
          assert.equal(point.payload?.chunk, chunks[index].text);
          assert.ok(Array.isArray(point.vector) && point.vector.length === size && point.vector.every(value => typeof value === 'number' && Number.isFinite(value)));
          points.push({ id: randomUUID(), vector: point.vector as number[], payload: { materialId: materialId.toHexString(), chunkIndex: index, chunk: chunks[index].text } });
        }
        const nextOffset = page.next_page_offset;
        assert.ok(nextOffset == null || typeof nextOffset === 'string' || typeof nextOffset === 'number');
        offset = nextOffset ?? undefined;
      } while (offset !== undefined);
      let vectorPreparation = 'copied-verified-index';
      if (points.length !== chunks.length || new Set(points.map(point => point.payload.chunkIndex)).size !== chunks.length) {
        assert.equal(env.embeddingsProvider, 'fastembed', 'Missing vectors may only be rebuilt locally.');
        vectorPreparation = 'rebuilt-local-fastembed'; points.length = 0;
        const vectors = await embed(chunks.map(chunk => chunk.text)); assert.equal(vectors.length, chunks.length);
        for (const [index, vector] of vectors.entries()) {
          assert.equal(vector.length, size); assert.ok(vector.every(Number.isFinite));
          points.push({ id: randomUUID(), vector, payload: { materialId: materialId.toHexString(), chunkIndex: index, chunk: chunks[index].text } });
        }
      }
      await upsertPoints(collection, points);
      const indexed = await qdrant.count(collection, { filter: { must: [{ key: 'materialId', match: { value: materialId.toHexString() } }] }, exact: true });
      assert.equal(indexed.count, chunks.length);
      const now = new Date();
      const oldRun = source.activeRunId ? await contentRunsCol().findOne({ _id: source.activeRunId, courseId: originalCourseId, kind: 'material-ingest' }) : null;
      assert.ok(oldRun?.kind === 'material-ingest' && oldRun.result?.indexedCount === chunks.length && oldRun.result.chunkCount === chunks.length, 'Retained original ingest receipt must agree with actual indexing.');
      await contentRunsCol().insertOne({ ...oldRun, _id: runId, courseId, input: { ...oldRun.input, materialId }, requestedBy: actor, createdAt: now, updatedAt: now });
      await materialChunksCol().insertMany(chunks.map(chunk => ({ ...chunk, _id: new ObjectId(), courseId, materialId })));
      await materialsCol().insertOne({ _id: materialId, courseId, name: source.name, format: source.format, status: 'ready', revision: 1, assignments: [], uploadedAt: now,
        ...(source.kind ? { kind: source.kind } : {}), ...(source.storagePath ? { storagePath: source.storagePath } : {}), ...(source.excerpt ? { excerpt: source.excerpt } : {}),
        activeRunId: runId, sourceManifest: { ...manifest, ingestRunId: runId, indexedAt: now } });
      const readiness = await getMaterialSourceReadiness(courseId, materialId); assert.ok(readiness.ready, readiness.reason ?? 'Copied source is not ready.');
      provenance.push({ originalCourseId: original.courseId, originalMaterialId: source._id.toHexString(), originalIngestRunId: source.activeRunId?.toHexString(),
        materialId: materialId.toHexString(), name: source.name, ingestRunId: runId.toHexString(), sourceTextHash: manifest.sourceTextHash, chunkCount: chunks.length,
        characterCount: manifest.characterCount, vectorPreparation, parserVersion: manifest.parserVersion, chunkerVersion: manifest.chunkerVersion });
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ courseId: courseId.toHexString(), database: env.mongodbDbName, actor, originalFixture: originalPath, originalCourseId: original.courseId,
      createdAt: new Date().toISOString(), sources: provenance, qdrantCollection: courseCollection(courseId), files: [], llmCalls: 0, embeddingProvider: env.embeddingsProvider,
      copiedCacheRows: 0, cleanup: 'Delete this Qdrant collection and include this course in the disposable database drop; original uploaded files remain owned by the original fixture cleanup.' }, null, 2) + '\n', { flag: 'wx' });
    retained = true; console.log(JSON.stringify({ ready: true, fixture: output, courseId: courseId.toHexString(), sources: provenance, llmCalls: 0 }));
  } finally {
    if (!retained) {
      for (const collection of [materialChunksCol(), materialsCol(), contentRunsCol()]) await collection.deleteMany({ courseId });
      await coursesCol().deleteOne({ _id: courseId }); await deleteCollectionIfExists(courseCollection(courseId));
    }
    await closeMongo();
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'generation-fixture-preparation-failed'); process.exitCode = 1; });
