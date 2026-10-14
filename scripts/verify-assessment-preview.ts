/** Synthetic local Mongo acceptance. No model calls or real student records. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { builderExamsCol, coursesCol, losCol, previewAssessmentAttemptsCol, themesCol } from '../server/src/components/mongodb/collections';
import { createBuilderExam, publishBuilderExam } from '../server/src/services/exam-builder.service';
import { answerPreviewAssessment, listPreviewAssessments, previewAssessmentResults, previewAssessmentState, startPreviewAssessment, submitPreviewAssessment } from '../server/src/services/assessment-preview.service';
import type { AssessmentPreviewContext } from '../server/src/types/assessment-preview';
import type { PaperQuestion } from '../server/src/types/exam-builder';

async function main(): Promise<void> {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname), 'This smoke test requires local MongoDB.');
  const db = await connectMongo();
  const courseId = new ObjectId(), topicId = new ObjectId(), loId = new ObjectId();
  const context: AssessmentPreviewContext = { instructorPuid: `PREVIEW-SMOKE-${randomUUID()}`, previewSessionId: randomUUID(), access: 'unrestricted' };
  const checks: string[] = [];
  try {
    await previewAssessmentAttemptsCol().createIndex({ courseId: 1, instructorPuid: 1, previewSessionId: 1, access: 1, examId: 1 }, { unique: true });
    await previewAssessmentAttemptsCol().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await coursesCol().insertOne({ _id: courseId, name: 'Assessment Preview · Synthetic local acceptance', courseCode: `PV${courseId.toHexString().slice(-8)}`, term: '2026W1', ownerPuid: context.instructorPuid,
      registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date() });
    await themesCol().insertOne({ _id: topicId, courseId, name: 'Synthetic risk topic', order: 0 });
    await losCol().insertOne({ _id: loId, courseId, themeId: topicId, name: 'Distinguish diversifiable and market risk', order: 0 });
    const before = Date.now();
    const exam = await createBuilderExam(courseId, 'Synthetic preview paper', context.instructorPuid);
    assert.equal(exam.settings.feedback, 'after-close');
    assert.ok(Date.parse(exam.settings.opensAt) >= before && Date.parse(exam.settings.opensAt) <= Date.now());
    checks.push('New exam defaults: opens now and answers after close');
    const item: PaperQuestion = { id: randomUUID(), source: 'generated', familyId: randomUUID(), loIds: [loId.toHexString()], type: 'true-false', difficulty: 'easy', stem: 'Diversification removes all market risk.',
      options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Market risk remains.' }, { key: 'B', text: 'False', role: 'correct', explanation: 'Diversification removes only firm-specific risk.' }], points: 3, minutes: 1, validated: true, approval: { by: context.instructorPuid, at: new Date().toISOString() }, practiceExposure: false };
    await builderExamsCol().updateOne({ _id: exam._id }, { $set: { items: [item] } });
    const starts = await Promise.all([startPreviewAssessment(courseId, exam._id, context), startPreviewAssessment(courseId, exam._id, context)]);
    assert.equal(starts[0].id, starts[1].id);
    assert.equal(await previewAssessmentAttemptsCol().countDocuments({ courseId }), 1);
    assert.doesNotMatch(JSON.stringify(starts[0]), /correct|explanation|score|approval/);
    checks.push('Concurrent draft starts converge; answer keys stay withheld');
    const attemptId = new ObjectId(starts[0].id);
    await answerPreviewAssessment(courseId, attemptId, context, item.id, 'B', 0);
    assert.equal((await previewAssessmentState(courseId, attemptId, context)).questions[0].selectedKey, 'B');
    await assert.rejects(answerPreviewAssessment(courseId, attemptId, context, item.id, 'A', 0));
    await assert.rejects(previewAssessmentState(courseId, attemptId, { ...context, instructorPuid: 'OTHER' }));
    await assert.rejects(previewAssessmentState(courseId, attemptId, { ...context, previewSessionId: randomUUID() }));
    await assert.rejects(previewAssessmentState(courseId, attemptId, { ...context, access: 'restricted' }));
    checks.push('Reload preserves answers; stale writes and foreign preview scopes fail');
    await builderExamsCol().updateOne({ _id: exam._id }, { $set: { displayTitle: 'Changed source title', items: [{ ...item, points: 9 }] }, $inc: { revision: 1 } });
    const row = (await listPreviewAssessments(courseId, context))[0];
    assert.equal(row.title, 'Synthetic preview paper');
    await submitPreviewAssessment(courseId, attemptId, context);
    const result = await previewAssessmentResults(courseId, attemptId, context);
    assert.equal(result.released, true); assert.equal('score' in result && result.score, 3);
    assert.equal('simulatedRelease' in result && result.simulatedRelease, true);
    checks.push('Frozen preview survives source edits and grades its original paper');
    await coursesCol().updateOne({ _id: courseId }, { $set: { published: true, lifecycle: 'published' } });
    const current = (await builderExamsCol().findOne({ _id: exam._id }))!;
    await builderExamsCol().updateOne({ _id: exam._id }, { $set: { 'settings.closesAt': new Date(Date.now() + 3_600_000).toISOString() } });
    const published = await publishBuilderExam(courseId, exam._id, current.revision, context.instructorPuid);
    assert.ok(published.publicationId); assert.equal(published.startedAt, undefined);
    const restricted = { ...context, access: 'restricted' as const };
    const sitting = await startPreviewAssessment(courseId, exam._id, restricted);
    await answerPreviewAssessment(courseId, new ObjectId(sitting.id), restricted, item.id, 'B', 0);
    await submitPreviewAssessment(courseId, new ObjectId(sitting.id), restricted);
    assert.equal((await previewAssessmentResults(courseId, new ObjectId(sitting.id), restricted)).released, false);
    checks.push('Draft rehearsal does not prevent publication; restricted results follow release policy');
    const timedContext = { ...context, previewSessionId: randomUUID() };
    const timed = await startPreviewAssessment(courseId, exam._id, timedContext);
    await previewAssessmentAttemptsCol().updateOne({ _id: new ObjectId(timed.id) }, { $set: { deadline: new Date(Date.now() - 1000) } });
    assert.equal((await previewAssessmentState(courseId, new ObjectId(timed.id), timedContext)).submitted, true);
    await assert.rejects(answerPreviewAssessment(courseId, new ObjectId(timed.id), timedContext, item.id, 'B', 0));
    checks.push('Server expiry submits the isolated attempt and refuses late answers');
    assert.equal((await builderExamsCol().findOne({ _id: exam._id }))!.startedAt, undefined);
    for (const name of ['assessmentAttempts', 'attemptRecords', 'examAttempts', 'masteryProfiles', 'reviewBookEntries', 'sessionSummaries', 'notifications']) {
      assert.equal(await db.collection(name).countDocuments({ courseId }), 0, `Preview wrote live ${name}.`);
    }
    const indexes = await previewAssessmentAttemptsCol().indexes();
    assert.ok(indexes.some(index => index.expireAfterSeconds === 0));
    checks.push('No live learning or assessment records; independent TTL receipts only');
    console.log(JSON.stringify({ outcome: 'passed', checks }, null, 2));
  } finally {
    for (const name of ['previewAssessmentAttempts', 'examPublications', 'builderExams', 'learningObjectives', 'themes', 'courses']) await db.collection(name).deleteMany({ ...(name === 'courses' ? { _id: courseId } : { courseId }) });
    await closeMongo();
  }
}
main().catch(error => { console.error(JSON.stringify({ outcome: 'failed', errorType: error instanceof Error ? error.name : 'UnknownError', code: error?.code, codeName: error?.codeName })); process.exitCode = 1; });
