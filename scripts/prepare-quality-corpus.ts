/** Opt-in physical ingestion of complete public PDFs in a disposable local DB.
 * Uses real parser/chunker/embedding/Qdrant/ingestion and recorded advisory model
 * calls. Original public PDFs are copied, never overwritten or redistributed.
 * Success retains the isolated fixtures for the subsequent cache benchmark;
 * failure cleans them. Run --cleanup <fixture.json> after all acceptance work.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { startJobs, stopJobs } from '../server/src/components/jobs';
import { coursesCol, materialChunksCol, materialsCol, contentRunsCol, INDEX_SPECS } from '../server/src/components/mongodb/collections';
import { deleteCollectionIfExists } from '../server/src/components/qdrant';
import { createMaterials, ingestMaterial, trashMaterial, courseCollection } from '../server/src/services/materials.service';
import { acceptMaterialUploadBatch, claimMaterialUploadBatch, prepareMaterialUploadBatch, readMaterialUploadBatch } from '../server/src/services/material-upload-batches.service';
import { assertSourceSelectionReady, getMaterialSourceReadiness } from '../server/src/services/source-readiness.service';
import { withModelUsage, summarizeModelUsage } from '../server/src/services/model-usage.service';
import { AuthoringBudget, withAuthoringBudget } from '../server/src/services/authoring-budget.service';
import { initializeAuthoringCommitSupport } from '../server/src/services/authoring-commit.service';

type CorpusChapter = { chapter: number; title: string; file: string; sha256: string; pages: number; bytes: number };
type Fixture = { courseId: string; foreignCourseId: string; baseMaterialIds: string[]; appendMaterialId: string; replacedMaterialId: string; replacementMaterialId: string; sourceBatchId: string; database: string; files: string[] };
let phase = 'configuration';

async function main() {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname), 'Local MongoDB only.');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.qdrantUrl).hostname), 'Local Qdrant only.');
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_[a-z0-9_-]+$/, 'Use a disposable financebot_quality_smoke_<unique> database.');
  const db = await connectMongo();
  const cleanupIndex = process.argv.indexOf('--cleanup');
  if (cleanupIndex >= 0) {
    const fixture = JSON.parse(await readFile(process.argv[cleanupIndex + 1]!, 'utf8')) as Fixture;
    assert.equal(fixture.database, env.mongodbDbName);
    for (const id of [fixture.courseId, fixture.foreignCourseId]) await deleteCollectionIfExists(courseCollection(new ObjectId(id)));
    const uploadRoot = path.resolve('uploads') + path.sep;
    for (const file of fixture.files) { assert.ok(path.resolve(file).startsWith(uploadRoot)); await rm(file, { force: true }); }
    await db.dropDatabase();
    await closeMongo();
    console.log(JSON.stringify({ cleaned: true, database: fixture.database }));
    return;
  }
  const inputIndex = process.argv.indexOf('--corpus');
  const outputIndex = process.argv.indexOf('--output');
  const corpusPath = inputIndex >= 0 ? process.argv[inputIndex + 1]! : 'audit-results/generation-quality-corpus/manifest.json';
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1]! : 'audit-results/generation-quality-corpus/fixture.json';
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as { coldBatch: number[]; addition: number; chapters: CorpusChapter[] };
  assert.equal(corpus.coldBatch.length, 10);
  const base = corpus.coldBatch.map((number) => corpus.chapters.find((chapter) => chapter.chapter === number)!);
  const addition = corpus.chapters.find((chapter) => chapter.chapter === corpus.addition)!;
  assert.ok([...base, addition].every((chapter) => chapter.pages >= 15));
  const courseId = new ObjectId(), foreignCourseId = new ObjectId(), actor = `QUALITY-CORPUS-${randomUUID()}`;
  const files: string[] = [];
  let completed = false;
  const budget = new AuthoringBudget(courseId.toHexString(), { maxSends: 48, maxEstimatedTokens: 1_500_000 });
  const copy = async (chapter: CorpusChapter, name = `Chapter ${chapter.chapter}: ${chapter.title}.pdf`) => {
    const filePath = path.resolve('uploads', `${randomUUID()}.pdf`);
    await copyFile(chapter.file, filePath); files.push(filePath);
    return { originalname: name, path: filePath, size: (await stat(filePath)).size };
  };
  try {
    phase = 'local-fixture-setup';
    await mkdir('uploads', { recursive: true });
    for (const spec of INDEX_SPECS.filter((spec) => ['materials', 'materialUploadBatches', 'materialChunks'].includes(spec.collection))) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    const makeCourse = (id: ObjectId) => ({ _id: id, name: 'Public finance corpus · isolated local acceptance', courseCode: `QA${id.toHexString().slice(-8)}`, term: '2026W1', ownerPuid: actor, registrationCode: randomUUID(), published: false, lifecycle: 'draft' as const, feedbackStrategy: 'adaptive' as const, autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date() });
    await coursesCol().insertMany([makeCourse(courseId), makeCourse(foreignCourseId)]);
    const transactions = await initializeAuthoringCommitSupport();
    const uploads = await Promise.all(base.map((chapter) => copy(chapter)));
    const intended = uploads.map((file, index) => ({ clientFileId: String(index), name: file.originalname, size: file.size }));
    const requestId = randomUUID();
    const prepared = await prepareMaterialUploadBatch(courseId, actor, requestId, intended);
    const replayed = await prepareMaterialUploadBatch(courseId, actor, requestId, intended);
    assert.equal(prepared._id.toHexString(), replayed._id.toHexString());
    await startJobs(); // No job handlers registered; direct execution below is exclusive.
    const claim = await claimMaterialUploadBatch(courseId, prepared._id, actor);
    await acceptMaterialUploadBatch(courseId, prepared._id, actor, claim.owner!, uploads);
    const received = await readMaterialUploadBatch(courseId, prepared._id, actor);
    assert.equal(received.counts.requested, 10); assert.equal(received.counts.received, 10); assert.equal(received.counts.ready, 0);
    await assert.rejects(assertSourceSelectionReady(courseId, { sourceBatchId: prepared._id.toHexString() }), (error) => error instanceof Error && error.message === 'source-not-ready');
    phase = 'real-pdf-ingestion';
    const indexedAt = Date.now();
    await withAuthoringBudget(budget, async () => {
      const all = received.items.map((item) => item.materialId!);
      let cursor = 0;
      await Promise.all(Array.from({ length: 2 }, async () => {
        while (cursor < all.length) {
          const materialId = all[cursor++]!;
          const material = await materialsCol().findOne({ _id: materialId, courseId }); assert.ok(material?.activeRunId);
          await withModelUsage({ runId: material.activeRunId.toHexString(), courseId: courseId.toHexString(), actor: { puid: actor }, stage: 'material-analysis' }, () => ingestMaterial(materialId.toHexString(), material.activeRunId!.toHexString()));
          const ready = await getMaterialSourceReadiness(courseId, materialId); assert.ok(ready.ready, `PDF source was not indexed: ${ready.reason}`);
          console.log(JSON.stringify({ phase, completedSource: ready.name, chunks: ready.snapshot!.chunkCount }));
        }
      }));
    });
    const indexed = await assertSourceSelectionReady(courseId, { sourceBatchId: prepared._id.toHexString() });
    assert.equal(indexed.included.length, 10);
    const baseIngestionMs = Date.now() - indexedAt;
    const sourceCount = await materialsCol().countDocuments({ courseId });
    const runCount = await contentRunsCol().countDocuments({ courseId, kind: 'material-ingest' });
    phase = 'physical-dedupe-and-ownership';
    const duplicates = await Promise.all([copy(base[0]!, 'Alias One.pdf'), copy(base[0]!, 'Alias Two.pdf')]);
    const deduped = await Promise.all(duplicates.map((file) => createMaterials(courseId, [file], actor)));
    assert.ok(deduped.every(([material]) => material!._id.equals(received.items[0]!.materialId!)));
    assert.equal(await materialsCol().countDocuments({ courseId }), sourceCount);
    assert.equal(await contentRunsCol().countDocuments({ courseId, kind: 'material-ingest' }), runCount);
    for (const file of duplicates) await assert.rejects(stat(file.path), (error) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    const [foreign] = await createMaterials(foreignCourseId, [await copy(base[0]!)], actor); assert.ok(foreign);
    assert.ok(!foreign._id.equals(received.items[0]!.materialId!));
    assert.equal((await getMaterialSourceReadiness(courseId, foreign._id)).name, 'Unavailable source');
    await assert.rejects(readMaterialUploadBatch(foreignCourseId, prepared._id, actor));
    await trashMaterial(foreignCourseId, foreign._id, actor);
    const [afterTrash] = await createMaterials(foreignCourseId, [await copy(base[0]!)], actor); assert.ok(afterTrash && !afterTrash._id.equals(foreign._id));
    assert.ok((await materialsCol().findOne({ _id: foreign._id }))?.deletedAt);
    phase = 'append-and-explicit-replacement';
    const [append] = await createMaterials(courseId, [await copy(addition)], actor); assert.ok(append?.activeRunId);
    // Replacement fixture is another complete, openly downloadable finance PDF,
    // explicitly selected by the test. It never masquerades as author revision.
    const replacementChapter = corpus.chapters.find((chapter) => chapter.chapter === 1)!;
    const [replacement] = await createMaterials(courseId, [await copy(replacementChapter, 'Explicit Chapter 4 replacement · Foundations.pdf')], actor); assert.ok(replacement?.activeRunId);
    await withAuthoringBudget(budget, async () => {
      for (const material of [append, replacement]) await withModelUsage({ runId: material.activeRunId!.toHexString(), courseId: courseId.toHexString(), actor: { puid: actor }, stage: 'material-analysis' }, () => ingestMaterial(material._id.toHexString(), material.activeRunId!.toHexString()));
    });
    const baseMaterialIds = received.items.map((item) => item.materialId!.toHexString());
    const replacedMaterialId = baseMaterialIds[base.findIndex((chapter) => chapter.chapter === 4)]!;
    const fixture: Fixture = { courseId: courseId.toHexString(), foreignCourseId: foreignCourseId.toHexString(), baseMaterialIds, appendMaterialId: append._id.toHexString(), replacedMaterialId, replacementMaterialId: replacement._id.toHexString(), sourceBatchId: prepared._id.toHexString(), database: env.mongodbDbName, files };
    const metadata = { ...fixture, actor, corpus: path.resolve(corpusPath), createdAt: new Date().toISOString(), transactionSupport: transactions,
      baseIngestionMs, fixturePreparationMs: Date.now() - indexedAt, realParserEmbeddingAndIndex: true, llmProvider: env.llmProvider, llmModel: env.llmDefaultModel,
      embeddingProvider: env.embeddingsProvider, embeddingModel: env.embeddingsModel, budget: budget.snapshot(), usage: await summarizeModelUsage({ courseId: courseId.toHexString() }),
      sources: indexed.included, replacementFixture: 'Complete Foundations PDF replaces Chapter 4 by explicit test selection, not a modified author chapter.',
      exclusions: ['Embedding and parsing costs are outside the LLM receipt ledger; fixture runtime is not a production performance guarantee.'] };
    await writeFile(outputPath, JSON.stringify(metadata, null, 2) + '\n');
    completed = true;
    console.log(JSON.stringify({ outcome: 'passed', fixture: path.resolve(outputPath), sourceCount: await materialsCol().countDocuments({ courseId }), chunks: await materialChunksCol().countDocuments({ courseId }), usage: metadata.usage, retainedForCacheBenchmark: true }));
  } finally {
    await stopJobs();
    if (!completed) {
      await Promise.allSettled([deleteCollectionIfExists(courseCollection(courseId)), deleteCollectionIfExists(courseCollection(foreignCourseId)), ...files.map((file) => rm(file, { force: true }))]);
      await db.dropDatabase();
    }
    await closeMongo();
  }
}
main().catch((error) => { console.error(JSON.stringify({ outcome: 'failed', phase, errorType: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message.replace(/mongodb:\/\/[^\s]+/g, '[redacted Mongo URI]') : 'Unknown error' })); process.exitCode = 1; });
