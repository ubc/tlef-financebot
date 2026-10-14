/** Opt-in physical Mongo acceptance for strict exam-window lifecycle.
 * Only a disposable local database and synthetic course/PUID/session fixtures
 * are allowed. No models, real enrollments, or global expiry sweep are invoked.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { assessmentAttemptsCol, builderExamsCol, coursesCol, examPublicationsCol, losCol, previewAssessmentAttemptsCol, themesCol } from '../server/src/components/mongodb/collections';
import { createBuilderExam, publishBuilderExam } from '../server/src/services/exam-builder.service';
import { answerAssessment, assessmentResults, assessmentState, bindAssessmentWindow, closeAssessmentWindow, expireAssessmentWindow, gradeAssessment, heartbeatAssessmentWindow, startAssessment, submitAssessment } from '../server/src/services/assessment-attempts.service';
import { answerPreviewAssessment, bindPreviewAssessmentWindow, closePreviewAssessmentWindow, expirePreviewAssessmentWindow, heartbeatPreviewAssessmentWindow, previewAssessmentResults, previewAssessmentState, startPreviewAssessment } from '../server/src/services/assessment-preview.service';
import type { AssessmentPreviewContext } from '../server/src/types/assessment-preview';
import type { PaperQuestion } from '../server/src/types/exam-builder';

let phase = 'configuration';
const localHosts = ['localhost', '127.0.0.1', '[::1]'];
const rejectStatus = async (action: Promise<unknown>, status: number) => assert.rejects(action, error => error instanceof Error && (error as Error & { status?: number }).status === status);
const privatePayload = (value: unknown, windowId?: string) => {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /SECRET ANSWER|explanation|"correct"|"score"|"approval"|"sourceRefs"/);
  if (windowId) assert.ok(!serialized.includes(windowId));
};

async function main(): Promise<void> {
  assert.ok(localHosts.includes(new URL(env.mongodbUri).hostname), 'Local MongoDB is required.');
  assert.match(env.mongodbDbName, /^financebot_window_smoke_[a-z0-9_-]+$/, 'Use a disposable database named financebot_window_smoke_<unique>.');
  phase = 'local-mongo-connection';
  const db = await connectMongo();
  const courseId = new ObjectId(), topicId = new ObjectId(), loId = new ObjectId(), runId = randomUUID();
  const actor = `WINDOW-SMOKE-TEACHER-${runId}`;
  const context: AssessmentPreviewContext = { instructorPuid: actor, previewSessionId: randomUUID(), access: 'unrestricted' };
  const checks: string[] = [];
  let cleanupFailed = false;
  const newPuid = (label: string) => `WINDOW-SMOKE-${label}-${runId}`;
  const item: PaperQuestion = { id: randomUUID(), source: 'generated', familyId: randomUUID(), loIds: [loId.toHexString()], type: 'true-false', difficulty: 'easy', stem: 'Diversification eliminates all market risk.',
    options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Diversification does not eliminate market risk.' }, { key: 'B', text: 'False', role: 'correct', explanation: 'SECRET ANSWER: market risk remains.' }],
    points: 7, minutes: 1, validated: true, approval: { by: actor, at: new Date().toISOString() }, practiceExposure: false };
  async function paper(title: string, feedback: 'instructor' | 'after-close' = 'instructor', closesAt = new Date(Date.now() + 3_600_000).toISOString()) {
    const draft = await createBuilderExam(courseId, title, actor);
    await builderExamsCol().updateOne({ _id: draft._id, courseId }, { $set: { items: [item], settings: { ...draft.settings, opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt, feedback } } });
    return publishBuilderExam(courseId, draft._id, draft.revision, actor);
  }
  // Expiry queries always include this exact synthetic course. A student's
  // existing sitting in the configured database can never be selected here.
  async function scopedSweep() {
    const now = new Date();
    const due = { courseId, submittedAt: { $exists: false }, $or: [{ deadline: { $lte: now } }, { 'window.expiresAt': { $lte: now } }] };
    let submitted = 0;
    for (const attempt of await assessmentAttemptsCol().find(due).limit(100).toArray()) {
      if (await expireAssessmentWindow(courseId, attempt._id, attempt.puid)) submitted++;
    }
    for (const attempt of await previewAssessmentAttemptsCol().find({ ...due, expiresAt: { $gt: now } }).limit(100).toArray()) {
      if (await expirePreviewAssessmentWindow(courseId, attempt._id, { instructorPuid: attempt.instructorPuid, previewSessionId: attempt.previewSessionId, access: attempt.access })) submitted++;
    }
    return submitted;
  }
  try {
    phase = 'synthetic-fixture-setup';
    await assessmentAttemptsCol().createIndex({ examId: 1, puid: 1 }, { unique: true });
    await previewAssessmentAttemptsCol().createIndex({ courseId: 1, instructorPuid: 1, previewSessionId: 1, access: 1, examId: 1 }, { unique: true });
    await previewAssessmentAttemptsCol().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await coursesCol().insertOne({ _id: courseId, name: 'Strict Assessment Windows · Synthetic local acceptance', courseCode: `WIN${courseId.toHexString().slice(-8)}`, term: '2026W1', ownerPuid: actor,
      registrationCode: randomUUID(), published: true, lifecycle: 'published', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date() });
    await themesCol().insertOne({ _id: topicId, courseId, name: 'Synthetic risk topic', order: 0 });
    await losCol().insertOne({ _id: loId, courseId, themeId: topicId, name: 'Distinguish diversifiable and market risk', order: 0 });
    const published = await paper('Synthetic leased paper');
    assert.ok(published.publicationId);
    const publication = await examPublicationsCol().findOne({ _id: published.publicationId, courseId });
    assert.ok(publication);

    // Preview uses its frozen isolated receipt and cannot take the live exam's
    // first-start lock, write student attempts, or change publication release.
    phase = 'isolated-preview-close';
    const previewWindow = randomUUID();
    const preview = await startPreviewAssessment(courseId, published._id, context, previewWindow), previewId = new ObjectId(preview.id);
    privatePayload(preview, previewWindow);
    await answerPreviewAssessment(courseId, previewId, context, item.id, 'B', 0, previewWindow);
    await previewAssessmentAttemptsCol().updateOne({ _id: previewId, courseId }, { $set: { 'window.expiresAt': new Date(Date.now() + 1000) } });
    const renewedPreview = await heartbeatPreviewAssessmentWindow(courseId, previewId, context, previewWindow);
    assert.equal(renewedPreview.submitted, false);
    assert.ok(Date.parse(renewedPreview.windowExpiresAt!) > Date.now() + 119_000);
    await rejectStatus(bindPreviewAssessmentWindow(courseId, previewId, context, randomUUID()), 409);
    await rejectStatus(closePreviewAssessmentWindow(courseId, previewId, { ...context, instructorPuid: newPuid('foreign-actor') }, previewWindow), 404);
    await rejectStatus(closePreviewAssessmentWindow(courseId, previewId, { ...context, previewSessionId: randomUUID() }, previewWindow), 404);
    await rejectStatus(closePreviewAssessmentWindow(courseId, previewId, { ...context, access: 'restricted' }, previewWindow), 404);
    await closePreviewAssessmentWindow(courseId, previewId, context, previewWindow);
    await closePreviewAssessmentWindow(courseId, previewId, context, previewWindow);
    const previewStored = await previewAssessmentAttemptsCol().findOne({ _id: previewId, courseId });
    assert.equal(previewStored?.submissionReason, 'window-closed'); assert.equal(previewStored.score, 7);
    assert.equal((await previewAssessmentResults(courseId, previewId, context)).released, true);
    assert.equal((await builderExamsCol().findOne({ _id: published._id, courseId }))?.startedAt, undefined);
    assert.equal(await assessmentAttemptsCol().countDocuments({ courseId }), 0);
    assert.equal((await examPublicationsCol().findOne({ _id: publication._id }))?.releasedAt, undefined);
    checks.push('Preview owner/session/mode isolation, close idempotency, no live attempts or first-start lock');

    phase = 'restricted-preview-release';
    const restricted = { ...context, previewSessionId: randomUUID(), access: 'restricted' as const }, restrictedWindow = randomUUID();
    const restrictedState = await startPreviewAssessment(courseId, published._id, restricted, restrictedWindow), restrictedId = new ObjectId(restrictedState.id);
    await answerPreviewAssessment(courseId, restrictedId, restricted, item.id, 'B', 0, restrictedWindow);
    await closePreviewAssessmentWindow(courseId, restrictedId, restricted, restrictedWindow);
    const withheldPreview = await previewAssessmentResults(courseId, restrictedId, restricted);
    assert.equal(withheldPreview.released, false); privatePayload(withheldPreview);
    checks.push('Restricted Preview close preserves Instructor-controlled answer release');

    phase = 'live-window-frozen-grading';
    const student = newPuid('frozen'), windowId = randomUUID();
    const starts = await Promise.all([startAssessment(courseId, published._id, student, windowId), startAssessment(courseId, published._id, student, windowId)]);
    assert.equal(starts[0].id, starts[1].id);
    const attemptId = new ObjectId(starts[0].id);
    assert.equal(await assessmentAttemptsCol().countDocuments({ courseId, puid: student }), 1);
    privatePayload(starts[0], windowId);
    await bindAssessmentWindow(courseId, attemptId, student, windowId);
    await rejectStatus(bindAssessmentWindow(courseId, attemptId, student, randomUUID()), 409);
    await rejectStatus(assessmentState(courseId, attemptId, newPuid('foreign-student')), 404);
    await rejectStatus(answerAssessment(courseId, attemptId, student, item.id, 'B', 0), 409);
    await answerAssessment(courseId, attemptId, student, item.id, 'B', 0, windowId);
    await assessmentAttemptsCol().updateOne({ _id: attemptId, courseId }, { $set: { 'window.expiresAt': new Date(Date.now() + 1000) } });
    const renewed = await heartbeatAssessmentWindow(courseId, attemptId, student, windowId);
    assert.equal(renewed.submitted, false); assert.ok(Date.parse(renewed.windowExpiresAt!) > Date.now() + 119_000);
    // Editing the mutable head must never change an existing attempt's frozen
    // published answer keys or points. The immutable publication is untouched.
    await builderExamsCol().updateOne({ _id: published._id, courseId }, { $set: { items: [{ ...item, points: 99, options: item.options.map(option => ({ ...option, role: option.key === 'A' ? 'correct' : 'common-misconception' })) }] } });
    await submitAssessment(courseId, attemptId, student, windowId);
    const stored = await assessmentAttemptsCol().findOne({ _id: attemptId, courseId });
    assert.ok(stored?.submittedAt); assert.equal(stored.submissionReason, 'submitted'); assert.equal(stored.score, 7);
    assert.equal(stored.score, gradeAssessment(stored, publication));
    const withheld = await assessmentResults(courseId, attemptId, student);
    assert.equal(withheld.released, false); privatePayload(withheld);
    checks.push('Atomic concurrent live start, same-owner bind/heartbeat, foreign-window rejection and frozen-publication grading');

    phase = 'concurrent-close-answer';
    const racingStudent = newPuid('answer-race'), racingWindow = randomUUID();
    const racing = await startAssessment(courseId, published._id, racingStudent, racingWindow), racingId = new ObjectId(racing.id);
    await answerAssessment(courseId, racingId, racingStudent, item.id, 'B', 0, racingWindow);
    const answerRace = await Promise.allSettled([closeAssessmentWindow(courseId, racingId, racingStudent, racingWindow), answerAssessment(courseId, racingId, racingStudent, item.id, 'A', 1, racingWindow)]);
    assert.equal(answerRace[0].status, 'fulfilled');
    const raced = await assessmentAttemptsCol().findOne({ _id: racingId, courseId });
    assert.ok(raced?.submittedAt); assert.equal(raced.submissionReason, 'window-closed'); assert.equal(raced.score, gradeAssessment(raced, publication));
    assert.ok(raced.answers[item.id] === 'A' || raced.answers[item.id] === 'B');
    await rejectStatus(answerAssessment(courseId, racingId, racingStudent, item.id, 'B', raced.answerRevision, racingWindow), 409);
    await rejectStatus(closeAssessmentWindow(courseId, racingId, racingStudent, randomUUID()), 409);
    checks.push('Concurrent close/answer grades the winning saved revision and rejects terminal writes');

    phase = 'concurrent-close-heartbeat';
    const heartbeatStudent = newPuid('heartbeat-race'), heartbeatWindow = randomUUID();
    const heartbeat = await startAssessment(courseId, published._id, heartbeatStudent, heartbeatWindow), heartbeatId = new ObjectId(heartbeat.id);
    const heartbeatRace = await Promise.allSettled([closeAssessmentWindow(courseId, heartbeatId, heartbeatStudent, heartbeatWindow), heartbeatAssessmentWindow(courseId, heartbeatId, heartbeatStudent, heartbeatWindow)]);
    assert.equal(heartbeatRace[0].status, 'fulfilled');
    const terminal = await assessmentAttemptsCol().findOne({ _id: heartbeatId, courseId });
    assert.ok(terminal?.submittedAt);
    assert.equal((await heartbeatAssessmentWindow(courseId, heartbeatId, heartbeatStudent, heartbeatWindow)).submitted, true);
    assert.equal((await bindAssessmentWindow(courseId, heartbeatId, heartbeatStudent, heartbeatWindow)).submitted, true);
    assert.equal((await assessmentAttemptsCol().findOne({ _id: heartbeatId, courseId }))?.submittedAt?.getTime(), terminal.submittedAt.getTime());
    checks.push('Concurrent close/heartbeat remains terminal; a closed window cannot be rebound');

    phase = 'missing-beacon-sweep';
    const silentStudent = newPuid('missing-beacon'), silentWindow = randomUUID();
    const silent = await startAssessment(courseId, published._id, silentStudent, silentWindow), silentId = new ObjectId(silent.id);
    await answerAssessment(courseId, silentId, silentStudent, item.id, 'B', 0, silentWindow);
    await assessmentAttemptsCol().updateOne({ _id: silentId, courseId }, { $set: { 'window.expiresAt': new Date(Date.now() - 1) } });
    assert.ok(await scopedSweep() >= 1);
    const disconnected = await assessmentAttemptsCol().findOne({ _id: silentId, courseId });
    assert.ok(disconnected?.submittedAt); assert.equal(disconnected.submissionReason, 'connection-lost'); assert.equal(disconnected.score, 7);
    assert.equal((await heartbeatAssessmentWindow(courseId, silentId, silentStudent, silentWindow)).submitted, true);
    checks.push('Missing close beacon is finalized by scoped lease sweep without any state GET');

    phase = 'deadline-preview-sweep';
    const deadlineStudent = newPuid('deadline'), deadlineWindow = randomUUID();
    const timed = await startAssessment(courseId, published._id, deadlineStudent, deadlineWindow), timedId = new ObjectId(timed.id);
    await assessmentAttemptsCol().updateOne({ _id: timedId, courseId }, { $set: { deadline: new Date(Date.now() - 1) } });
    assert.ok(await scopedSweep() >= 1);
    assert.equal((await assessmentAttemptsCol().findOne({ _id: timedId, courseId }))?.submissionReason, 'deadline');
    const lostContext = { ...context, previewSessionId: randomUUID() }, lostWindow = randomUUID();
    const lostPreview = await startPreviewAssessment(courseId, published._id, lostContext, lostWindow), lostId = new ObjectId(lostPreview.id);
    await previewAssessmentAttemptsCol().updateOne({ _id: lostId, courseId }, { $set: { 'window.expiresAt': new Date(Date.now() - 1) } });
    assert.ok(await scopedSweep() >= 1);
    assert.equal((await previewAssessmentAttemptsCol().findOne({ _id: lostId, courseId }))?.submissionReason, 'connection-lost');
    assert.equal((await previewAssessmentState(courseId, lostId, lostContext)).submitted, true);
    checks.push('Server deadline and isolated Preview lease sweeps finalize independently');

    // A fixture-only manual release verifies the exact immutable publication
    // observed by both live and restricted Preview result readers.
    phase = 'manual-publication-release';
    await examPublicationsCol().updateOne({ _id: publication._id, courseId }, { $set: { releasedAt: new Date() } });
    const released = await assessmentResults(courseId, attemptId, student), releasedPreview = await previewAssessmentResults(courseId, restrictedId, restricted);
    assert.equal(released.released, true); assert.equal('score' in released && released.score, 7);
    assert.equal(releasedPreview.released, true); assert.equal('score' in releasedPreview && releasedPreview.score, 7);
    assert.ok(JSON.stringify(released).includes('SECRET ANSWER'));
    checks.push('Answer keys remain withheld until the exact publication is released');

    phase = 'scheduled-after-close-release';
    const closeAt = new Date(Date.now() + 2500).toISOString();
    const scheduled = await paper('Synthetic after-close release', 'after-close', closeAt), scheduledWindow = randomUUID(), scheduledStudent = newPuid('scheduled');
    const scheduledState = await startAssessment(courseId, scheduled._id, scheduledStudent, scheduledWindow), scheduledId = new ObjectId(scheduledState.id);
    await answerAssessment(courseId, scheduledId, scheduledStudent, item.id, 'B', 0, scheduledWindow);
    await closeAssessmentWindow(courseId, scheduledId, scheduledStudent, scheduledWindow);
    assert.equal((await assessmentResults(courseId, scheduledId, scheduledStudent)).released, false);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(closeAt) - Date.now() + 50)));
    assert.equal((await assessmentResults(courseId, scheduledId, scheduledStudent)).released, true);
    checks.push('After-close release stays withheld before closing time and releases afterward');

    phase = 'zero-learning-writes';
    for (const name of ['attemptRecords', 'examAttempts', 'masteryProfiles', 'reviewBookEntries', 'sessionSummaries', 'notifications', 'learningSessions', 'reviewMetadata', 'discussionPosts', 'previewAttemptRecords', 'previewStudentSessions']) assert.equal(await db.collection(name).countDocuments({ courseId }), 0);
    checks.push('No practice, mastery, Review Book, summary or notification writes');
  } finally {
    for (const name of ['previewAssessmentAttempts', 'assessmentAttempts', 'examPublications', 'builderExams', 'learningObjectives', 'themes', 'courses']) {
      try { await db.collection(name).deleteMany(name === 'courses' ? { _id: courseId } : { courseId }); }
      catch { cleanupFailed = true; }
    }
    await closeMongo();
  }
  if (cleanupFailed) { phase = 'synthetic-fixture-cleanup'; throw new Error('Synthetic fixture cleanup failed.'); }
  console.log(JSON.stringify({ outcome: 'passed', checks }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ outcome: 'failed', phase, errorType: error instanceof Error ? error.name : 'UnknownError' })); process.exitCode = 1; });
