import { ObjectId, type WithId } from 'mongodb';
import type { AssessmentAttempt, ExamPublication, PaperQuestion } from '../../server/src/types/exam-builder';
jest.mock('../../server/src/components/mongodb/collections', () => ({ assessmentAttemptsCol: jest.fn(), examPublicationsCol: jest.fn(), builderExamsCol: jest.fn(), coursesCol: jest.fn() }));
import { assessmentAttemptsCol, examPublicationsCol, builderExamsCol, coursesCol } from '../../server/src/components/mongodb/collections';
import { assessmentState, assessmentResults, answerAssessment, submitAssessment, answersReleased, gradeAssessment, startAssessment, bindAssessmentWindow, heartbeatAssessmentWindow, closeAssessmentWindow, expireAssessmentWindow } from '../../server/src/services/assessment-attempts.service';
const courseId = new ObjectId(), examId = new ObjectId(), publicationId = new ObjectId(), attemptId = new ObjectId();
const item: PaperQuestion = { id: '5eae1bc4-b4ab-4414-a0cf-10085511515a', source: 'generated', familyId: 'family', loIds: [new ObjectId().toHexString()], type: 'true-false', difficulty: 'easy', stem: 'Diversification eliminates all market risk.', options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Wrong explanation' }, { key: 'B', text: 'False', role: 'correct', explanation: 'SECRET ANSWER RATIONALE' }], points: 7, minutes: 1, validated: true, practiceExposure: false, approval: { by: 'teacher', at: new Date().toISOString() } };
let attempt: WithId<AssessmentAttempt>, publication: WithId<ExamPublication>;
const updateOne = jest.fn();
beforeEach(() => {
  attempt = { _id: attemptId, courseId, examId, publicationId, puid: 'learner', revision: 3, answerRevision: 0, order: [item.id], answers: { [item.id]: 'B' }, startedAt: new Date(), deadline: new Date(Date.now() + 60000), maxScore: 7 };
  publication = { _id: publicationId, courseId, examId, revision: 3, items: [item], settings: { title: 'Midterm', kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: new Date().toISOString(), closesAt: new Date(Date.now() + 60000).toISOString(), timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] }, publishedBy: 'teacher', publishedAt: new Date(), hash: 'hash' };
  jest.mocked(assessmentAttemptsCol).mockReturnValue({ findOne: jest.fn(async (filter: { puid: string }) => filter.puid === attempt.puid ? attempt : null), updateOne } as never);
  jest.mocked(examPublicationsCol).mockReturnValue({ findOne: jest.fn(async () => publication) } as never);
  jest.mocked(builderExamsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: examId, displayTitle: undefined })) } as never);
  updateOne.mockImplementation(async (filter, update) => {
    if (!matches(attempt, filter)) return { matchedCount: 0 };
    for (const [key, value] of Object.entries(update.$set ?? {})) {
      if (key.startsWith('answers.')) attempt.answers[key.slice(8)] = value as string;
      else (attempt as unknown as Record<string, unknown>)[key] = value;
    }
    if (update.$inc?.answerRevision) attempt.answerRevision += update.$inc.answerRevision;
    return { matchedCount: 1 };
  });
});
test('live and submitted-but-withheld payloads never contain answer keys or explanations', async () => {
  const state = await assessmentState(courseId, attemptId, 'learner');
  expect(state.questions[0].options).toEqual([{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }]);
  expect(JSON.stringify(state)).not.toMatch(/SECRET|explanation|correct|score|sourceRefs/);
  attempt.submittedAt = new Date(); attempt.score = 7;
  const results = await assessmentResults(courseId, attemptId, 'learner');
  expect(results).toEqual({ released: false, title: 'Midterm', message: 'Your Instructor will release the results.' });
});
test('attempt ownership is checked even after course authorization', async () => {
  await expect(assessmentState(courseId, attemptId, 'another-student')).rejects.toMatchObject({ status: 404 });
});
test('grading uses frozen publication keys and submission CAS protects concurrent answers', async () => {
  expect(gradeAssessment(attempt, publication)).toBe(7);
  await submitAssessment(courseId, attemptId, 'learner');
  expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({ answerRevision: 0, submittedAt: { $exists: false } }), expect.objectContaining({ $set: expect.objectContaining({ score: 7 }) }));
  const count = updateOne.mock.calls.length; await submitAssessment(courseId, attemptId, 'learner'); expect(updateOne).toHaveBeenCalledTimes(count);
});
test('answer writes require version, ownership, open state and a server deadline', async () => {
  await answerAssessment(courseId, attemptId, 'learner', item.id, 'A', 0);
  expect(updateOne).toHaveBeenCalledWith(expect.objectContaining({ puid: 'learner', answerRevision: 0, deadline: { $gt: expect.any(Date) }, submittedAt: { $exists: false } }), expect.objectContaining({ $inc: { answerRevision: 1 } }));
  await expect(answerAssessment(courseId, attemptId, 'learner', item.id, 'forged', 1)).rejects.toMatchObject({ status: 400 });
});
test('expired state submits on the server before responding', async () => {
  attempt.deadline = new Date(Date.now() - 1000);
  const state = await assessmentState(courseId, attemptId, 'learner');
  expect(state.submitted).toBe(true); expect(attempt.score).toBe(7);
});
test('formal immediate feedback cannot bypass release; scheduled and manual release work', async () => {
  publication.settings.feedback = 'immediate'; expect(answersReleased(publication)).toBe(false);
  publication.settings.purpose = 'practice'; expect(answersReleased(publication)).toBe(true);
  publication.settings.purpose = 'formal'; publication.settings.feedback = 'after-close'; expect(answersReleased(publication)).toBe(false);
  publication.settings.closesAt = new Date(Date.now() - 1000).toISOString(); expect(answersReleased(publication)).toBe(true);
  publication.settings.feedback = 'instructor'; publication.releasedAt = new Date(); expect(answersReleased(publication)).toBe(true);
});


test('student sitting and withheld results use the renamed exam title', async () => {
  jest.mocked(builderExamsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: examId, displayTitle: 'Updated midterm' })) } as never);
  expect((await assessmentState(courseId, attemptId, 'learner')).title).toBe('Updated midterm');
  attempt.submittedAt = new Date();
  expect((await assessmentResults(courseId, attemptId, 'learner')).title).toBe('Updated midterm');
});

function matches(record: object, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, record);
    if (expected instanceof ObjectId) return actual instanceof ObjectId && actual.equals(expected);
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object') {
      const rule = expected as Record<string, unknown>;
      if ('$exists' in rule && (actual !== undefined) !== rule.$exists) return false;
      if ('$gt' in rule && !(Number(actual) > Number(rule.$gt))) return false;
      if ('$eq' in rule && Number(actual) !== Number(rule.$eq)) return false;
      return true;
    }
    return actual === expected;
  });
}
const windowId = 'e7083c96-bd92-4a88-94cb-ff3e378af7d8', otherWindow = 'd3e6dd02-81ad-4b7b-9567-e0decd985d2c';
test('live legacy attempts acquire a window once; active foreign windows and missing bound ownership are denied', async () => {
  const receipt = await bindAssessmentWindow(courseId, attemptId, 'learner', windowId);
  expect(receipt).toMatchObject({ submitted: false, windowExpiresAt: expect.any(String) });
  expect(attempt.window?.id).toBe(windowId);
  await expect(bindAssessmentWindow(courseId, attemptId, 'learner', otherWindow)).rejects.toMatchObject({ status: 409 });
  for (const owner of [undefined, otherWindow]) {
    await expect(answerAssessment(courseId, attemptId, 'learner', item.id, 'A', 0, owner)).rejects.toMatchObject({ status: 409 });
    await expect(submitAssessment(courseId, attemptId, 'learner', owner)).rejects.toMatchObject({ status: 409 });
  }
  await answerAssessment(courseId, attemptId, 'learner', item.id, 'A', 0, windowId);
  expect(attempt.answers[item.id]).toBe('A');
});
test('matching window close submits saved answers once, denies foreign terminal operations and cannot be reopened', async () => {
  await bindAssessmentWindow(courseId, attemptId, 'learner', windowId);
  await closeAssessmentWindow(courseId, attemptId, 'learner', windowId);
  expect(attempt).toMatchObject({ score: 7, submissionReason: 'window-closed' });
  const count = updateOne.mock.calls.length; await closeAssessmentWindow(courseId, attemptId, 'learner', windowId); expect(updateOne).toHaveBeenCalledTimes(count);
  expect((await heartbeatAssessmentWindow(courseId, attemptId, 'learner', windowId)).submitted).toBe(true);
  await expect(closeAssessmentWindow(courseId, attemptId, 'learner', otherWindow)).rejects.toMatchObject({ status: 409 });
  expect((await assessmentState(courseId, attemptId, 'learner')).submissionReason).toBe('window-closed');
});
test('expired connection lease auto-submits and heartbeat cannot revive it; deadline takes precedence', async () => {
  attempt.window = { id: windowId, expiresAt: new Date(Date.now() - 1) };
  expect((await heartbeatAssessmentWindow(courseId, attemptId, 'learner', windowId)).submissionReason).toBe('connection-lost');
  expect(attempt.submittedAt).toBeDefined();
  delete attempt.submittedAt; delete attempt.submissionReason; attempt.deadline = new Date(Date.now() - 1);
  expect(await expireAssessmentWindow(courseId, attemptId, 'learner')).toBe(true);
  expect(attempt.submissionReason).toBe('deadline');
});
test('lazy live state expiry and ownership-free sweeper do not reveal answers or override release policy', async () => {
  attempt.window = { id: windowId, expiresAt: new Date(Date.now() - 1) };
  const state = await assessmentState(courseId, attemptId, 'learner');
  expect(state.submitted).toBe(true); expect(state.submissionReason).toBe('connection-lost');
  expect(JSON.stringify(state)).not.toMatch(/SECRET|score|windowId|explanation/);
  expect(await assessmentResults(courseId, attemptId, 'learner')).toMatchObject({ released: false });
});
test('sweep loses CAS to a renewed heartbeat and leaves the sitting open', async () => {
  attempt.window = { id: windowId, expiresAt: new Date(Date.now() - 1) };
  updateOne.mockImplementationOnce(async () => { attempt.window!.expiresAt = new Date(Date.now() + 120_000); return { matchedCount: 0 }; });
  expect(await expireAssessmentWindow(courseId, attemptId, 'learner')).toBe(false);
  expect(attempt.submittedAt).toBeUndefined();
});
test('close/answer race grades the winning saved revision; terminal answer CAS is rejected', async () => {
  await bindAssessmentWindow(courseId, attemptId, 'learner', windowId);
  updateOne.mockImplementationOnce(async () => { attempt.answers[item.id] = 'A'; attempt.answerRevision++; return { matchedCount: 0 }; });
  await closeAssessmentWindow(courseId, attemptId, 'learner', windowId);
  expect(attempt.score).toBe(0);
  await expect(answerAssessment(courseId, attemptId, 'learner', item.id, 'B', attempt.answerRevision, windowId)).rejects.toMatchObject({ status: 409 });
});
test('new live starts bind lease in initial insert and preserve publication first-start locking', async () => {
  let stored: WithId<AssessmentAttempt> | null = null;
  const insertOne = jest.fn(async (data: AssessmentAttempt) => { stored = { ...data, _id: attemptId }; attempt = stored; return { insertedId: attemptId }; });
  jest.mocked(assessmentAttemptsCol).mockReturnValue({ findOne: jest.fn(async () => stored), insertOne, updateOne } as never);
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => ({ lifecycle: 'published' })) } as never);
  const pinned = jest.fn(async () => ({ matchedCount: 1 }));
  jest.mocked(builderExamsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: examId, courseId, publicationId })), updateOne: pinned } as never);
  const state = await startAssessment(courseId, examId, 'learner', windowId);
  expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ window: { id: windowId, expiresAt: expect.any(Date) } }));
  expect(pinned).toHaveBeenCalledTimes(1); expect(state.windowExpiresAt).toBeDefined(); expect(JSON.stringify(state)).not.toContain(windowId);
  await expect(startAssessment(courseId, examId, 'learner', otherWindow)).rejects.toMatchObject({ status: 409 });
  expect(insertOne).toHaveBeenCalledTimes(1);
});

test('same-owner live heartbeat renews the grace period without changing answers or answer revision', async () => {
  attempt.window = { id: windowId, expiresAt: new Date(Date.now() + 1000) };
  const revision = attempt.answerRevision, answers = { ...attempt.answers };
  const receipt = await heartbeatAssessmentWindow(courseId, attemptId, 'learner', windowId);
  expect(receipt.submitted).toBe(false);
  expect(attempt.window.expiresAt.getTime()).toBeGreaterThan(Date.now() + 119_000);
  expect(attempt.answerRevision).toBe(revision); expect(attempt.answers).toEqual(answers);
  await expect(heartbeatAssessmentWindow(courseId, attemptId, 'learner', otherWindow)).rejects.toMatchObject({ status: 409 });
});

test('explicit owned submission records its terminal reason and returns no score before release', async () => {
  await bindAssessmentWindow(courseId, attemptId, 'learner', windowId);
  expect(await submitAssessment(courseId, attemptId, 'learner', windowId)).toEqual({ submitted: true, submissionReason: 'submitted' });
  const state = await assessmentState(courseId, attemptId, 'learner');
  expect(state.submissionReason).toBe('submitted'); expect(state).not.toHaveProperty('score');
});
