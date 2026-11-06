/** Physical local acceptance for source manifests, upload receipts and duplicate
 * races. One tiny synthetic source uses real local embedding/indexing and at most
 * three configured advisory-model sends. All records/files/points are removed.
 * Existing real corpus fixtures in the same disposable database remain intact.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { startJobs, stopJobs } from '../server/src/components/jobs';
import { contentRunsCol, coursesCol, materialsCol, INDEX_SPECS } from '../server/src/components/mongodb/collections';
import { deleteCollectionIfExists } from '../server/src/components/qdrant';
import { createMaterials, courseCollection, ingestMaterial, retryMaterial, trashMaterial } from '../server/src/services/materials.service';
import { prepareMaterialUploadBatch, claimMaterialUploadBatch, acceptMaterialUploadBatch, readMaterialUploadBatch } from '../server/src/services/material-upload-batches.service';
import { getMaterialSourceReadiness, assertSourceSelectionReady } from '../server/src/services/source-readiness.service';
import { withModelUsage, summarizeModelUsage } from '../server/src/services/model-usage.service';
import { AuthoringBudget, withAuthoringBudget } from '../server/src/services/authoring-budget.service';
import { initializeAuthoringCommitSupport } from '../server/src/services/authoring-commit.service';

let phase = 'configuration';
async function main() {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.qdrantUrl).hostname));
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_[a-z0-9_-]+$/);
  const db = await connectMongo(), courseId = new ObjectId(), actor = `MATERIAL-SMOKE-${randomUUID()}`;
  const files: string[] = [], checks: string[] = [];
  const upload = async (name: string, bytes: string) => {
    const filePath = path.resolve('uploads', `${randomUUID()}${path.extname(name)}`);
    await writeFile(filePath, bytes); files.push(filePath);
    return { originalname: name, path: filePath, size: Buffer.byteLength(bytes) };
  };
  const budget = new AuthoringBudget(courseId.toHexString(), { maxSends: 3, maxEstimatedTokens: 100_000 });
  try {
    phase = 'synthetic-setup';
    await mkdir('uploads', { recursive: true });
    for (const spec of INDEX_SPECS.filter((spec) => ['materials', 'materialUploadBatches', 'materialChunks'].includes(spec.collection))) await db.collection(spec.collection).createIndex(spec.keys, spec.options);
    await coursesCol().insertOne({ _id: courseId, name: 'Material readiness · isolated smoke', courseCode: `SM${courseId.toHexString().slice(-8)}`, term: '2026W1', ownerPuid: actor, registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date() });
    assert.equal((await initializeAuthoringCommitSupport()).available, true, 'Run this concurrency smoke against a local replica set.');
    await startJobs();
    phase = 'concurrent-canonical-creation';
    const teachingText = 'The expected return is the risk-free rate plus beta times the equity risk premium. Beta measures systematic market risk. Total volatility includes both systematic risk and diversifiable firm-specific risk. Diversification can remove firm-specific risk, while market risk remains.';
    const uploads = await Promise.all([upload('chapter-one.txt', teachingText), upload('alias-one.txt', teachingText)]);
    const [one, two] = await Promise.all(uploads.map((file) => createMaterials(courseId, [file], actor)));
    const material = one[0]!;
    assert.ok(material.activeRunId); assert.ok(material._id.equals(two[0]!._id));
    assert.equal(await materialsCol().countDocuments({ courseId }), 1);
    assert.equal(await contentRunsCol().countDocuments({ courseId, kind: 'material-ingest' }), 1);
    const activeRun = await contentRunsCol().findOne({ _id: material.activeRunId, courseId });
    assert.ok(activeRun?.kind === 'material-ingest' && activeRun.input.materialId.equals(material._id));
    assert.equal((await getMaterialSourceReadiness(courseId, material._id)).ready, false);
    checks.push('Concurrent exact-byte upload creates one prelinked canonical head/run under the course transaction fence');
    phase = 'real-indexed-publication';
    let finished = false, pendingObserved = false;
    const work = withAuthoringBudget(budget, () => withModelUsage({ courseId: courseId.toHexString(), runId: material.activeRunId!.toHexString(), actor: { puid: actor }, stage: 'material-analysis' }, () => ingestMaterial(material._id.toHexString(), material.activeRunId!.toHexString()))).finally(() => { finished = true; });
    while (!finished) {
      const ready = await getMaterialSourceReadiness(courseId, material._id);
      if (ready.ready && ready.classification === 'pending') pendingObserved = true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await work;
    assert.ok((await getMaterialSourceReadiness(courseId, material._id)).ready);
    assert.ok(pendingObserved, 'Observe usable indexed evidence during the real advisory classification call.');
    checks.push('Actual chunk/vector publication precedes advisory classification and the manifest is usable while classification remains pending');
    const current = await contentRunsCol().findOne({ _id: material.activeRunId });
    assert.ok(current);
    await contentRunsCol().updateOne({ _id: current._id }, { $set: { status: 'failed', stage: 'classifying', error: { code: 'server-restarted', message: 'Synthetic interruption after indexing', atStage: 'classifying', retryable: true } } });
    assert.ok((await getMaterialSourceReadiness(courseId, material._id)).ready);
    await contentRunsCol().replaceOne({ _id: current._id }, current);
    checks.push('Interrupted advisory run retains valid indexed source eligibility');
    phase = 'receipt-reload';
    const copied = await upload('second-alias.txt', teachingText);
    const prepared = await prepareMaterialUploadBatch(courseId, actor, randomUUID(), [{ clientFileId: 'late', name: copied.originalname, size: copied.size }]);
    const claim = await claimMaterialUploadBatch(courseId, prepared._id, actor);
    const before = await summarizeModelUsage({ courseId: courseId.toHexString() });
    await acceptMaterialUploadBatch(courseId, prepared._id, actor, claim.owner!, [copied]);
    const receipt = await readMaterialUploadBatch(courseId, prepared._id, actor);
    assert.equal(receipt.items[0]!.disposition, 'reused'); assert.equal(receipt.counts.ready, 1);
    assert.equal((await summarizeModelUsage({ courseId: courseId.toHexString() })).observedCalls, before.observedCalls);
    await assert.rejects(stat(copied.path), (error) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    await assertSourceSelectionReady(courseId, { sourceBatchId: prepared._id.toHexString() });
    await assert.rejects(readMaterialUploadBatch(new ObjectId(), prepared._id, actor));
    checks.push('Receipt replay is course scoped, preserves alias names and performs no extra parsing, job or model work');
    phase = 'failed-retry-invalidation';
    await materialsCol().updateOne({ _id: material._id }, { $set: { status: 'failed', error: 'Synthetic parse failure' } });
    const retried = await retryMaterial(material._id, actor);
    assert.equal(retried.status, 'processing'); assert.equal(retried.sourceManifest, undefined);
    assert.equal((await getMaterialSourceReadiness(courseId, material._id)).ready, false);
    assert.ok(!retried.activeRunId!.equals(material.activeRunId!));
    checks.push('Retry replaces the active run and invalidates its previous source manifest before any chunk mutation');
    await trashMaterial(courseId, material._id, actor);
    const [fresh] = await createMaterials(courseId, [await upload('chapter-one.txt', teachingText)], actor);
    assert.ok(fresh && !fresh._id.equals(material._id));
    assert.ok((await materialsCol().findOne({ _id: material._id }))?.deletedAt);
    checks.push('A new identical upload cannot silently restore a trashed source');
    console.log(JSON.stringify({ outcome: 'passed', checks, budget: budget.snapshot(), usage: await summarizeModelUsage({ courseId: courseId.toHexString() }) }, null, 2));
  } finally {
    await stopJobs();
    const runs = await contentRunsCol().find({ courseId }).project({ _id: 1 }).toArray();
    await db.collection('agendaJobs').deleteMany({ 'data.runId': { $in: runs.map((run) => run._id.toHexString()) } });
    for (const name of ['materialUploadBatches', 'materialChunks', 'materials', 'contentRuns', 'modelCallReceipts', 'modelUsageSessions']) await db.collection(name).deleteMany({ courseId });
    await coursesCol().deleteOne({ _id: courseId });
    await deleteCollectionIfExists(courseCollection(courseId));
    await Promise.all(files.map((file) => rm(file, { force: true })));
    await closeMongo();
  }
}
main().catch((error) => { console.error(JSON.stringify({ outcome: 'failed', phase, errorType: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : 'Unknown error' })); process.exitCode = 1; });
