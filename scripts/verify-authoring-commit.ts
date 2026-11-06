import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { connectMongo, closeMongo, getDb } from '../server/src/components/mongodb';
import { env } from '../server/src/config/env';
import { initializeAuthoringCommitSupport, withCourseAuthoringWrite, withCourseAuthoringFirstWrite, authoringCollection } from '../server/src/services/authoring-commit.service';
import { buildAuthoringContext, fenceAuthoringContext } from '../server/src/services/authoring-context.service';
import { createQuestion } from '../server/src/services/questions.service';
import { hashSourceChunks } from '../server/src/services/source-readiness.service';

/** Local disposable replica-set acceptance; no model or embedding calls. */
async function main() {
  assert.match(env.mongodbUri, /127\.0\.0\.1|localhost/);
  assert.match(env.mongodbDbName, /^financebot_quality_smoke_/);
  await connectMongo(); const db = getDb();
  assert.equal((await initializeAuthoringCommitSupport()).available, true, 'A replica set is required for the atomicity test.');
  const courseId = new ObjectId(); const loId = new ObjectId(); const themeId = new ObjectId(); const materialId = new ObjectId();
  const text = 'Systematic risk is measured by beta. Total volatility is not beta.';
  await db.collection('courses').insertOne({ _id: courseId, name: 'Atomic authoring acceptance', ownerPuid: 'local-fixture', lifecycle: 'draft', published: false });
  await db.collection('learningObjectives').insertOne({ _id: loId, courseId, themeId, name: 'Distinguish systematic risk', order: 1 });
  await db.collection('materials').insertOne({ _id: materialId, courseId, name: 'Chapter 1', status: 'ready', format: 'txt', revision: 1,
    assignments: [{ loId, themeId }], sourceManifest: { version: 1, chunkCount: 1, indexedCount: 1, characterCount: text.length, sourceTextHash: hashSourceChunks([{ index: 0, text }]), parserVersion: 'fixture-parser', chunkerVersion: 'fixture-chunker' } });
  await db.collection('materialChunks').insertOne({ _id: new ObjectId(), courseId, materialId, index: 0, text, characterCount: text.length });
  const context = await buildAuthoringContext({ courseId, loIds: [loId], allowedMaterials: [{ materialId: materialId.toHexString(), role: 'primary', loId: loId.toHexString(), loName: 'Distinguish systematic risk' }], seeds: [{ materialId: materialId.toHexString(), chunkIndex: 0, text }], policyVersion: 'grounded-memory-v2', requirements: { intent: 'create-independent-task', requiredChanges: ['Distinguish beta from volatility.'], preserve: [] } });
  const question = { courseId, loIds: [loId], themeIds: [themeId], type: 'mcq' as const, stem: 'Which quantity measures systematic risk?', difficulty: 'easy' as const,
    options: [ { key: 'A', text: 'Beta', role: 'correct' as const, explanation: 'Beta measures systematic risk.' }, { key: 'B', text: 'Total volatility', role: 'common-misconception' as const, explanation: 'Total volatility is not beta.' },
      { key: 'C', text: 'Beta and total volatility', role: 'partially-correct' as const, explanation: 'Only beta measures systematic risk.' }, { key: 'D', text: 'Firm name', role: 'clearly-wrong' as const, explanation: 'A name is irrelevant.' } ], createdBy: 'local-fixture' };
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const first = withCourseAuthoringWrite(courseId, async session => {
      await fenceAuthoringContext(context, { courseId, loIds: [loId], session: session! }); entered(); await gate; return createQuestion(question);
    }, { required: true });
    await started;
    const second = withCourseAuthoringWrite(courseId, async session => {
      await fenceAuthoringContext(context, { courseId, loIds: [loId], session: session! }); return createQuestion(question);
    }, { required: true });
    setTimeout(release, 100);
    const race = await Promise.allSettled([first, second]);
    assert.equal(race[0].status, 'fulfilled'); assert.equal(race[1].status, 'rejected');
    assert.match((race[1] as PromiseRejectedResult).reason.message, /authoring-memory-changed/);
    assert.equal(await db.collection('questions').countDocuments({ courseId }), 1);
    const saved = await db.collection('questions').findOne({ courseId }); assert(saved);
    assert.equal(await db.collection('questionVersions').countDocuments({ questionId: saved._id }), 1);
    // A source revision change rejects a prepared candidate before persistence.
    const changed = await buildAuthoringContext({ courseId, loIds: [loId], allowedMaterials: [{ materialId: materialId.toHexString(), role: 'primary', loId: loId.toHexString(), loName: 'Distinguish systematic risk' }], seeds: [{ materialId: materialId.toHexString(), chunkIndex: 0, text }], policyVersion: 'grounded-memory-v2', requirements: context.requirements });
    await withCourseAuthoringWrite(courseId, session => db.collection('materials').updateOne({ _id: materialId }, { $inc: { revision: 1 } }, { session }));
    await assert.rejects(withCourseAuthoringWrite(courseId, session => fenceAuthoringContext(changed, { courseId, loIds: [loId], session: session! }), { required: true }), /generation-evidence-source-changed/);
    // Deletion tombstones stop both baseline and v2 writes, without recreating records.
    await withCourseAuthoringWrite(courseId, session => db.collection('courses').updateOne({ _id: courseId }, { $set: { authoringDeletionStartedAt: new Date() } }, { session }));
    await assert.rejects(createQuestion(question), /course-not-found/);
    for (const name of ['authoringTaskPlans', 'regenerationCandidates']) {
      const id = new ObjectId();
      await assert.rejects(withCourseAuthoringFirstWrite(courseId,
        () => authoringCollection(db.collection(name)).insertOne({ _id: id, courseId }),
        () => db.collection(name).deleteOne({ _id: id })), /course-not-found/);
      assert.equal(await db.collection(name).countDocuments({ courseId }), 0);
    }
    console.log(JSON.stringify({ passed: true, checks: ['same-LO empty-Bank race: only one commit', 'immutable head/version pair committed atomically', 'changed source rejects stale commit', 'course deletion tombstone rejects head and diagnostic-record recreation'], modelCalls: 0, embeddingCalls: 0 }));
  } finally {
    release?.();
    const heads = await db.collection('questions').find({ courseId }).toArray();
    await db.collection('questionVersions').deleteMany({ questionId: { $in: heads.map(head => head._id) } });
    for (const name of ['questions', 'materials', 'materialChunks', 'learningObjectives', 'authoringTaskPlans', 'regenerationCandidates']) await db.collection(name).deleteMany({ courseId });
    await db.collection('courses').deleteOne({ _id: courseId }); await closeMongo();
  }
}
void main().catch(async error => { console.error(error instanceof Error ? error.message : 'authoring-commit-verification-failed'); await closeMongo(); process.exitCode = 1; });
