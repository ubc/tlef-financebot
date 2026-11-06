/** Rebuild an isolated chapter fixture (default Chapters 3 and 4) with complete public PDFs and local
 * parser/chunker/FastEmbed/Qdrant only. Advisory classification is explicitly
 * skipped. These test-owned physical-index receipts are not upload-flow tests. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { coursesCol, materialsCol, materialChunksCol, contentRunsCol, INDEX_SPECS } from '../server/src/components/mongodb/collections';
import { parseFile } from '../server/src/components/genai/document-parsing';
import { chunkText } from '../server/src/components/genai/chunking';
import { embed } from '../server/src/components/genai/embeddings';
import { ensureCollection, upsertPoints, qdrant, deleteCollectionIfExists } from '../server/src/components/qdrant';
import { courseCollection } from '../server/src/services/materials.service';
import { initializeAuthoringCommitSupport } from '../server/src/services/authoring-commit.service';
import { getMaterialSourceReadiness, hashSourceChunks, MATERIAL_CHUNKER_VERSION, MATERIAL_PARSER_VERSION } from '../server/src/services/source-readiness.service';
import { AuthoringBudget, withAuthoringBudget } from '../server/src/services/authoring-budget.service';
import type { MaterialChunk } from '../server/src/types/domain';

type Chapter = { chapter: number; title: string; file: string; sha256: string; pages: number; bytes: number };
type Fixture = { courseId: string; database: string; actor: string; files: string[]; qdrantCollection: string };
const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };

async function main(): Promise<void> {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname), 'Local MongoDB only.');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.qdrantUrl).hostname), 'Local Qdrant only.');
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_retest_[a-z0-9_-]+$/, 'Use a new disposable retest database.');
  assert.equal(env.embeddingsProvider, 'fastembed', 'Only local embeddings are allowed during fixture preparation.');
  const db = await connectMongo();
  const cleanupPath = argument('--cleanup');
  if (cleanupPath) {
    try {
      const fixture = JSON.parse(await readFile(cleanupPath, 'utf8')) as Fixture;
      assert.equal(fixture.database, env.mongodbDbName); assert.match(fixture.actor, /^QUALITY-RETEST-FIXTURE-/);
      const courseId = new ObjectId(fixture.courseId);
      const course = await coursesCol().findOne({ _id: courseId });
      assert.ok(course && course.ownerPuid === fixture.actor, 'Only the owned retest course can be cleaned.');
      assert.equal(await coursesCol().countDocuments({}), 1, 'Refuse database cleanup when unrelated courses exist.');
      assert.equal(fixture.qdrantCollection, courseCollection(courseId));
      await deleteCollectionIfExists(fixture.qdrantCollection);
      for (const file of fixture.files) {
        assert.equal(path.dirname(path.resolve(file)), path.resolve('uploads'));
        assert.match(path.basename(file), /^[a-f0-9-]{36}\.pdf$/);
        await rm(file, { force: true });
      }
      await db.dropDatabase();
      console.log(JSON.stringify({ cleaned: true, database: fixture.database, courseId: fixture.courseId, files: fixture.files.length, llmCalls: 0 }));
    } finally { await closeMongo(); }
    return;
  }
  const output = argument('--output'); assert.ok(output, 'Pass --output <new-fixture.json>.');
  const corpusPath = argument('--corpus') ?? 'audit-results/generation-quality-corpus/manifest.json';
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as { chapters: Chapter[]; sourceCatalog: string };
  const requestedChapters = argument('--chapters')?.split(',').map(value => Number(value)) ?? [3, 4];
  assert.ok(requestedChapters.length >= 1 && requestedChapters.length <= 20 && requestedChapters.every(Number.isSafeInteger));
  assert.equal(new Set(requestedChapters).size, requestedChapters.length, 'Chapters must be unique.');
  const chapters = requestedChapters.map(number => corpus.chapters.find(chapter => chapter.chapter === number));
  assert.ok(chapters.every((chapter): chapter is Chapter => !!chapter && chapter.pages >= 15));
  await assert.rejects(readFile(output), error => (error as NodeJS.ErrnoException).code === 'ENOENT', 'Never overwrite earlier observations.');
  assert.equal(await coursesCol().countDocuments({}), 0, 'Use an empty isolated database.');
  const courseId = new ObjectId(); const actor = `QUALITY-RETEST-FIXTURE-${randomUUID()}`;
  const files: string[] = []; const sources: Array<Record<string, unknown>> = [];
  const budget = new AuthoringBudget(`${courseId}:zero-provider-preparation`, { maxSends: 0 });
  let retained = false;
  try {
    assert.equal((await initializeAuthoringCommitSupport()).available, true, 'Real authoring transactions are required.');
    for (const spec of INDEX_SPECS.filter(spec => ['materials', 'materialChunks'].includes(spec.collection))) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    await mkdir('uploads', { recursive: true }); await mkdir(path.dirname(output), { recursive: true });
    await coursesCol().insertOne({ _id: courseId, name: 'Public finance chapters · bounded v2 quality fixture', courseCode: `QA${courseId.toHexString().slice(-8)}`,
      term: '2026W1', ownerPuid: actor, registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive',
      autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date() });
    await withAuthoringBudget(budget, async () => {
      for (const chapter of chapters) {
        assert.ok(chapter);
        const bytes = await readFile(chapter.file); assert.equal(bytes.length, chapter.bytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), chapter.sha256, 'Public PDF hash changed.');
        const storagePath = path.resolve('uploads', `${randomUUID()}.pdf`); await copyFile(chapter.file, storagePath); files.push(storagePath);
        const started = Date.now(); const text = await parseFile(storagePath); assert.ok(text.trim());
        const materialId = new ObjectId(); const runId = new ObjectId(); const now = new Date();
        const name = `Chapter ${chapter.chapter}: ${chapter.title}.pdf`;
        const chunked = await chunkText(text, name); assert.ok(chunked.length);
        const chunks: MaterialChunk[] = chunked.map((chunk, index) => ({ courseId, materialId, index, text: chunk.text,
          characterCount: chunk.text.length, ...(chunk.metadata ? { metadata: chunk.metadata } : {}), createdAt: now }));
        assert.ok(chunks.every(chunk => chunk.text.trim()));
        const vectors = await embed(chunks.map(chunk => chunk.text)); assert.equal(vectors.length, chunks.length);
        const size = vectors[0]?.length; assert.ok(size && vectors.every(vector => vector.length === size && vector.every(Number.isFinite)));
        await ensureCollection(courseCollection(courseId), size);
        await upsertPoints(courseCollection(courseId), vectors.map((vector, index) => ({ id: randomUUID(), vector,
          payload: { materialId: materialId.toHexString(), chunkIndex: index, chunk: chunks[index]!.text } })));
        const count = await qdrant.count(courseCollection(courseId), { filter: { must: [{ key: 'materialId', match: { value: materialId.toHexString() } }] }, exact: true });
        assert.equal(count.count, chunks.length);
        const manifest = { version: 1 as const, ingestRunId: runId, sourceTextHash: hashSourceChunks(chunks), chunkCount: chunks.length,
          characterCount: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), indexedCount: count.count,
          parserVersion: MATERIAL_PARSER_VERSION, chunkerVersion: MATERIAL_CHUNKER_VERSION, indexedAt: new Date() };
        await materialChunksCol().insertMany(chunks);
        await contentRunsCol().insertOne({ _id: runId, courseId, requestedBy: actor, kind: 'material-ingest', status: 'completed', stage: 'indexing',
          input: { materialId, sourceName: name, sourceFormat: 'pdf', trigger: 'upload' }, completedUnits: chunks.length, totalUnits: chunks.length,
          revision: 1, events: [], warnings: [{ code: 'test-fixture-classification-skipped', message: 'Test-owned physical index; advisory model classification was deliberately skipped.', atStage: 'indexing', at: new Date() }],
          createdAt: now, updatedAt: new Date(), startedAt: now, completedAt: new Date(),
          result: { characterCount: manifest.characterCount, chunkCount: chunks.length, indexedCount: count.count, vectorCount: vectors.length, classification: 'skipped' } });
        await materialsCol().insertOne({ _id: materialId, courseId, name, format: 'pdf', kind: 'reading', status: 'ready', assignments: [], revision: 1,
          storagePath, excerpt: text.slice(0, 2000), uploadedAt: now, activeRunId: runId, sourceManifest: manifest });
        const ready = await getMaterialSourceReadiness(courseId, materialId); assert.ok(ready.ready, ready.reason ?? 'Source is not ready.');
        sources.push({ chapter: chapter.chapter, pages: chapter.pages, publicPdf: path.resolve(chapter.file), pdfSha256: chapter.sha256, materialId: materialId.toHexString(),
          name, manifest, parsedCharacterCount: text.length, elapsedMs: Date.now() - started, embeddingDimension: size, readiness: ready,
          chunks: chunks.map(chunk => ({ index: chunk.index, text: chunk.text, characterCount: chunk.characterCount })) });
        console.log(JSON.stringify({ indexed: name, pages: chapter.pages, chunks: chunks.length, llmCalls: budget.snapshot().observedSends }));
      }
    });
    assert.equal(budget.snapshot().observedSends, 0);
    await writeFile(output, JSON.stringify({ version: 1, courseId: courseId.toHexString(), actor, database: env.mongodbDbName,
      qdrantCollection: courseCollection(courseId), files, sources, sourceCatalog: corpus.sourceCatalog, sourceCorpus: path.resolve(corpusPath),
      createdAt: new Date().toISOString(), llmCalls: 0, sourceExtractionCalls: 0, copiedCacheRows: 0, embeddingProvider: env.embeddingsProvider,
      fixtureKind: 'Complete public PDFs physically parsed, chunked, locally embedded and indexed; classification deliberately skipped; not an upload-admission test.' }, null, 2) + '\n', { flag: 'wx' });
    retained = true; console.log(JSON.stringify({ ready: true, fixture: output, courseId: courseId.toHexString(), llmCalls: 0 }));
  } finally {
    if (!retained) {
      await Promise.allSettled([deleteCollectionIfExists(courseCollection(courseId)), ...files.map(file => rm(file, { force: true }))]);
      for (const collection of [materialChunksCol(), materialsCol(), contentRunsCol()]) await collection.deleteMany({ courseId });
      await coursesCol().deleteOne({ _id: courseId });
    }
    await closeMongo();
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'quality-retest-preparation-failed'); process.exitCode = 1; });
