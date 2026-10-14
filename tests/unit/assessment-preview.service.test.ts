import { ObjectId, type WithId } from 'mongodb';
import type { AssessmentPreviewContext, PreviewAssessmentAttempt } from '../../server/src/types/assessment-preview';
import type { BuilderExam, ExamPublication, PaperQuestion } from '../../server/src/types/exam-builder';

jest.mock('../../server/src/components/mongodb/collections', () => ({ previewAssessmentAttemptsCol: jest.fn(), examPublicationsCol: jest.fn(), builderExamsCol: jest.fn(), coursesCol: jest.fn(), losCol: jest.fn(), examBuildRunsCol: jest.fn(), assessmentAttemptsCol: jest.fn() }));
import { previewAssessmentAttemptsCol, examPublicationsCol, builderExamsCol, coursesCol, losCol, examBuildRunsCol, assessmentAttemptsCol } from '../../server/src/components/mongodb/collections';
import { listPreviewAssessments, startPreviewAssessment, previewAssessmentState, answerPreviewAssessment, submitPreviewAssessment, previewAssessmentResults, bindPreviewAssessmentWindow, heartbeatPreviewAssessmentWindow, closePreviewAssessmentWindow, expirePreviewAssessmentWindow } from '../../server/src/services/assessment-preview.service';

const courseId = new ObjectId(), examId = new ObjectId(), publicationId = new ObjectId(), loId = new ObjectId();
const context: AssessmentPreviewContext = { instructorPuid: 'teacher', previewSessionId: 'ea30139b-a098-4e25-b230-bee24e6c181d', access: 'unrestricted' };
const restricted = { ...context, access: 'restricted' as const };
const question: PaperQuestion = { id: '5eae1bc4-b4ab-4414-a0cf-10085511515a', source: 'generated', familyId: 'family', loIds: [loId.toHexString()], type: 'true-false', difficulty: 'easy', stem: 'Diversification eliminates all market risk.', options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'WRONG RATIONALE' }, { key: 'B', text: 'False', role: 'correct', explanation: 'SECRET ANSWER RATIONALE' }], points: 7, minutes: 1, validated: true, practiceExposure: false, approval: { by: 'teacher', at: new Date().toISOString() } };
let exam: WithId<BuilderExam>, publication: WithId<ExamPublication> | null, course: { _id: ObjectId; lifecycle: 'draft' | 'published'; published: boolean; archivedAt?: Date };
let receipts: Array<WithId<PreviewAssessmentAttempt>>;
let headWrites: jest.Mock, publicationWrites: jest.Mock, receiptUpdate: jest.Mock, insert: jest.Mock;
type Query = Record<string, unknown>;
function equal(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}
function match(record: object, filter: Query): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Query)[part] : undefined, record);
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
      const operators = expected as Query;
      if ('$eq' in operators && !equal(actual, operators.$eq)) return false;
      if ('$exists' in operators && (actual !== undefined) !== operators.$exists) return false;
      if ('$in' in operators && !(operators.$in as unknown[]).some(value => equal(actual, value))) return false;
      if ('$gt' in operators && !(Number(actual) > Number(operators.$gt))) return false;
      if ('$lte' in operators && !(Number(actual) <= Number(operators.$lte))) return false;
      return true;
    }
    return equal(actual, expected);
  });
}
function cursor(records: object[], filter: Query) { return { toArray: async () => records.filter(record => match(record, filter)) }; }
beforeEach(() => {
  course = { _id: courseId, lifecycle: 'draft', published: false };
  exam = { _id: examId, courseId, revision: 1, settings: { title: 'Midterm', kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: '', closesAt: '', timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] }, items: structuredClone([question]), createdBy: 'teacher', createdAt: new Date(), updatedAt: new Date() };
  publication = null; receipts = [];
  headWrites = jest.fn(); publicationWrites = jest.fn();
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async (filter: Query) => match(course, filter) ? course : null) } as never);
  jest.mocked(builderExamsCol).mockReturnValue({ find: jest.fn((filter: Query) => cursor([exam], filter)), findOne: jest.fn(async (filter: Query) => match(exam, filter) ? exam : null), updateOne: headWrites, findOneAndUpdate: headWrites } as never);
  jest.mocked(examPublicationsCol).mockReturnValue({ find: jest.fn((filter: Query) => cursor(publication ? [publication] : [], filter)), findOne: jest.fn(async (filter: Query) => publication && match(publication, filter) ? publication : null), updateOne: publicationWrites } as never);
  jest.mocked(losCol).mockReturnValue({ countDocuments: jest.fn(async (filter: Query) => match({ _id: loId, courseId }, filter) ? 1 : 0) } as never);
  jest.mocked(examBuildRunsCol).mockReturnValue({ countDocuments: jest.fn(async () => 0) } as never);
  receiptUpdate = jest.fn(async (filter: Query, update: { $set?: Query; $inc?: Query }) => {
    const receipt = receipts.find(record => match(record, filter)); if (!receipt) return { matchedCount: 0 };
    for (const [key, value] of Object.entries(update.$set ?? {})) { if (key.startsWith('answers.')) receipt.answers[key.slice(8)] = value as string; else (receipt as unknown as Query)[key] = value; }
    for (const [key, value] of Object.entries(update.$inc ?? {})) (receipt as unknown as Query)[key] = Number((receipt as unknown as Query)[key]) + Number(value);
    return { matchedCount: 1 };
  });
  insert = jest.fn(async (record: PreviewAssessmentAttempt) => { const _id = new ObjectId(); receipts.push({ ...record, _id }); return { insertedId: _id }; });
  jest.mocked(previewAssessmentAttemptsCol).mockReturnValue({ find: jest.fn((filter: Query) => cursor(receipts, filter)), findOne: jest.fn(async (filter: Query) => receipts.find(record => match(record, filter)) ?? null), insertOne: insert, updateOne: receiptUpdate, deleteOne: jest.fn(async (filter: Query) => { receipts = receipts.filter(record => !match(record, filter)); return { deletedCount: 1 }; }) } as never);
});
function publish() {
  course.lifecycle = 'published'; course.published = true;
  const now = Date.now();
  exam.settings.opensAt = new Date(now - 60_000).toISOString(); exam.settings.closesAt = new Date(now + 3_600_000).toISOString();
  exam.publicationId = publicationId; exam.publishedRevision = exam.revision;
  publication = { _id: publicationId, courseId, examId, revision: 0, settings: structuredClone(exam.settings), items: structuredClone(exam.items), publishedBy: 'teacher', publishedAt: new Date(), hash: 'hash' };
}
async function start(ctx = context) { return startPreviewAssessment(courseId, examId, ctx); }
function receipt() { return receipts[0]; }
afterEach(() => { expect(headWrites).not.toHaveBeenCalled(); expect(publicationWrites).not.toHaveBeenCalled(); expect(assessmentAttemptsCol).not.toHaveBeenCalled(); });

test('ready draft preview ignores missing availability, freezes content and never takes the live start lock', async () => {
  const rows = await listPreviewAssessments(courseId, context);
  expect(rows).toMatchObject([{ source: 'draft', canStart: true, questionCount: 1 }]);
  expect(JSON.stringify(rows)).not.toMatch(/SECRET|WRONG|options|accommodations/);
  const state = await start();
  expect(receipt()).toMatchObject({ instructorPuid: 'teacher', previewSessionId: context.previewSessionId, access: 'unrestricted', sourceStatus: 'draft', sourceRevision: 1 });
  expect(receipt().deadline.getTime() - receipt().startedAt.getTime()).toBe(3_600_000);
  expect(receipt().expiresAt.getTime() - receipt().startedAt.getTime()).toBe(86_400_000);
  expect(state.questions[0].options).toEqual([{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }]);
  expect(JSON.stringify(state)).not.toMatch(/SECRET|WRONG|explanation|correct|score|sourceRefs|approval/);
  exam.items[0].stem = 'CHANGED HEAD'; exam.settings.durationMinutes = 2; exam.settings.title = 'CHANGED TITLE'; exam.revision++;
  expect((await start()).id).toBe(state.id); expect(insert).toHaveBeenCalledTimes(1);
  expect((await listPreviewAssessments(courseId, context))[0]).toMatchObject({ title: 'Midterm', durationMinutes: 60, source: 'draft', attemptId: state.id });
  expect((await previewAssessmentState(courseId, new ObjectId(state.id), context)).questions[0].stem).toBe(question.stem);
});
test.each(['approval', 'validation', 'points', 'duplicate', 'active', 'foreign-lo'] as const)('unready draft %s is disabled and cannot be started', async problem => {
  if (problem === 'approval') delete exam.items[0].approval;
  if (problem === 'validation') exam.items[0].validated = false;
  if (problem === 'points') exam.items[0].points = 0;
  if (problem === 'duplicate') exam.items.push(exam.items[0]);
  if (problem === 'active') exam.activeRunIds = [new ObjectId().toHexString()];
  if (problem === 'foreign-lo') exam.items[0].loIds = [new ObjectId().toHexString()];
  expect((await listPreviewAssessments(courseId, context))[0]).toMatchObject({ canStart: false, unavailableReason: expect.any(String) });
  await expect(start()).rejects.toMatchObject({ status: 409 }); expect(receipts).toHaveLength(0);
});
test('restricted preview requires a published course and cannot see unpublished papers', async () => {
  await expect(listPreviewAssessments(courseId, restricted)).rejects.toMatchObject({ status: 404 });
  course.lifecycle = 'published';
  expect(await listPreviewAssessments(courseId, restricted)).toEqual([]);
  await expect(start(restricted)).rejects.toMatchObject({ status: 404 });
});
test.each(['future', 'closed'] as const)('restricted %s publications cannot start; unrestricted can rehearse them', async window => {
  publish();
  if (window === 'future') publication!.settings.opensAt = new Date(Date.now() + 60_000).toISOString();
  else publication!.settings.closesAt = new Date(Date.now() - 1000).toISOString();
  expect((await listPreviewAssessments(courseId, restricted))[0]).toMatchObject({ canStart: false, source: 'published' });
  await expect(start(restricted)).rejects.toMatchObject({ status: 409 });
  expect((await start()).submitted).toBe(false); expect(receipt().sourceStatus).toBe('published');
});
test('restriction uses the immutable published paper while unrestricted revised drafts use the current head', async () => {
  publish(); exam.revision++; exam.items[0].stem = 'Revised draft question';
  const restrictedState = await start(restricted);
  const unrestrictedState = await start();
  expect(restrictedState.questions[0].stem).toBe(question.stem);
  expect(unrestrictedState.questions[0].stem).toBe('Revised draft question');
  expect(receipts).toHaveLength(2);
});
test.each(['actor', 'session', 'course', 'mode'] as const)('attempt state and mutations reject different %s', async field => {
  publish(); const state = await start();
  const other = { ...context }, targetCourse = field === 'course' ? new ObjectId() : courseId;
  if (field === 'actor') other.instructorPuid = 'another-teacher';
  if (field === 'session') other.previewSessionId = '4bc7b578-c9d0-40c5-9266-40fef6b670be';
  if (field === 'mode') other.access = 'restricted';
  for (const action of [() => previewAssessmentState(targetCourse, new ObjectId(state.id), other), () => answerPreviewAssessment(targetCourse, new ObjectId(state.id), other, question.id, 'B', 0), () => submitPreviewAssessment(targetCourse, new ObjectId(state.id), other), () => previewAssessmentResults(targetCourse, new ObjectId(state.id), other), () => bindPreviewAssessmentWindow(targetCourse, new ObjectId(state.id), other, windowId), () => heartbeatPreviewAssessmentWindow(targetCourse, new ObjectId(state.id), other, windowId), () => closePreviewAssessmentWindow(targetCourse, new ObjectId(state.id), other, windowId)]) await expect(action()).rejects.toMatchObject({ status: 404 });
  expect(receiptUpdate).not.toHaveBeenCalled();
});
test('answer CAS and allowed options reject stale, forged and submitted changes', async () => {
  const state = await start(), attemptId = new ObjectId(state.id);
  expect(await answerPreviewAssessment(courseId, attemptId, context, question.id, 'B', 0)).toEqual({ answerRevision: 1 });
  await expect(answerPreviewAssessment(courseId, attemptId, context, question.id, 'A', 0)).rejects.toMatchObject({ status: 409 });
  await expect(answerPreviewAssessment(courseId, attemptId, context, question.id, 'forged', 1)).rejects.toMatchObject({ status: 400 });
  await submitPreviewAssessment(courseId, attemptId, context);
  expect(receipt().score).toBe(7);
  await expect(answerPreviewAssessment(courseId, attemptId, context, question.id, 'A', 1)).rejects.toMatchObject({ status: 409 });
  const count = receiptUpdate.mock.calls.length; await submitPreviewAssessment(courseId, attemptId, context); expect(receiptUpdate).toHaveBeenCalledTimes(count);
});
test('submission retries after concurrent answer save and grades the winning revision', async () => {
  const state = await start(), attemptId = new ObjectId(state.id);
  receiptUpdate.mockImplementationOnce(async () => { receipt().answers[question.id] = 'B'; receipt().answerRevision++; return { matchedCount: 0 }; });
  await submitPreviewAssessment(courseId, attemptId, context);
  expect(receipt().score).toBe(7);
  expect(receiptUpdate.mock.calls[1][0]).toMatchObject({ answerRevision: 1 });
});
test('unrestricted results require submission before simulating full release', async () => {
  const state = await start(), attemptId = new ObjectId(state.id);
  await expect(previewAssessmentResults(courseId, attemptId, context)).rejects.toMatchObject({ status: 409 });
  await answerPreviewAssessment(courseId, attemptId, context, question.id, 'B', 0); await submitPreviewAssessment(courseId, attemptId, context);
  expect(await previewAssessmentResults(courseId, attemptId, context)).toMatchObject({ released: true, score: 7, maxScore: 7, simulatedRelease: true, message: expect.stringContaining('Preview only'), questions: [{ options: [{ correct: false }, { correct: true, explanation: 'SECRET ANSWER RATIONALE' }] }] });
});
test('restricted results follow manual release of the exact pinned publication', async () => {
  publish(); const state = await start(restricted), attemptId = new ObjectId(state.id); await submitPreviewAssessment(courseId, attemptId, restricted);
  const withheld = await previewAssessmentResults(courseId, attemptId, restricted);
  expect(withheld).toMatchObject({ released: false, message: 'Your Instructor will release the results.' }); expect(JSON.stringify(withheld)).not.toMatch(/score|SECRET|questions/);
  publication!._id = new ObjectId(); publication!.releasedAt = new Date();
  expect((await previewAssessmentResults(courseId, attemptId, restricted)).released).toBe(false);
  publication!._id = publicationId;
  const results = await previewAssessmentResults(courseId, attemptId, restricted);
  expect(results).toMatchObject({ released: true, score: 0 }); expect(results).not.toHaveProperty('simulatedRelease');
});
test('restricted after-close results release on frozen closing time and server expiry submits without a client timer', async () => {
  publish(); publication!.settings.feedback = 'after-close'; publication!.settings.closesAt = new Date(Date.now() + 30_000).toISOString();
  const state = await start(restricted), attemptId = new ObjectId(state.id);
  expect(receipt().deadline.toISOString()).toBe(publication!.settings.closesAt);
  receipt().answers[question.id] = 'B'; receipt().deadline = new Date(Date.now() - 1000);
  expect((await previewAssessmentState(courseId, attemptId, restricted)).submitted).toBe(true); expect(receipt().score).toBe(7);
  expect((await previewAssessmentResults(courseId, attemptId, restricted)).released).toBe(false);
  receipt().snapshot.settings.closesAt = new Date(Date.now() - 1000).toISOString();
  expect((await previewAssessmentResults(courseId, attemptId, restricted)).released).toBe(true);
});
test('expired TTL receipt is inaccessible before Mongo cleanup and a new start replaces only that expired receipt', async () => {
  const state = await start(); receipt().expiresAt = new Date(Date.now() - 1);
  await expect(previewAssessmentState(courseId, new ObjectId(state.id), context)).rejects.toMatchObject({ status: 404 });
  const replacement = await start(); expect(replacement.id).not.toBe(state.id); expect(receipts).toHaveLength(1);
});
test('concurrent first starts recover the unique-index winner rather than creating another sitting', async () => {
  insert.mockImplementationOnce(async (record: PreviewAssessmentAttempt) => { receipts.push({ ...record, _id: new ObjectId() }); throw Object.assign(new Error('duplicate'), { code: 11000 }); });
  const state = await start(); expect(state.id).toBe(receipt()._id.toHexString()); expect(receipts).toHaveLength(1);
});
test('archived and malformed preview contexts are rejected before touching receipt data', async () => {
  course.archivedAt = new Date(); course.lifecycle = 'published';
  await expect(start()).rejects.toMatchObject({ status: 404 });
  delete course.archivedAt;
  await expect(startPreviewAssessment(courseId, examId, { ...context, previewSessionId: 'forged' })).rejects.toMatchObject({ status: 400 });
  expect(insert).not.toHaveBeenCalled();
});

const windowId = 'e7083c96-bd92-4a88-94cb-ff3e378af7d8', anotherWindow = 'd3e6dd02-81ad-4b7b-9567-e0decd985d2c';
test('new Preview start binds an isolated 120-second window lease and never returns its identifier', async () => {
  const state = await startPreviewAssessment(courseId, examId, context, windowId);
  expect(receipt().window?.id).toBe(windowId);
  expect(receipt().window!.expiresAt.getTime() - receipt().startedAt.getTime()).toBeGreaterThanOrEqual(120_000);
  expect(state.windowExpiresAt).toBe(receipt().window!.expiresAt.toISOString());
  expect(JSON.stringify(state)).not.toContain(windowId);
  await expect(bindPreviewAssessmentWindow(courseId, new ObjectId(state.id), context, anotherWindow)).rejects.toMatchObject({ status: 409 });
});
test('Preview legacy sitting binds once; bound answer/submit/close reject missing or foreign window ownership', async () => {
  const state = await start(), id = new ObjectId(state.id);
  await bindPreviewAssessmentWindow(courseId, id, context, windowId);
  for (const owner of [undefined, anotherWindow]) {
    await expect(answerPreviewAssessment(courseId, id, context, question.id, 'B', 0, owner)).rejects.toMatchObject({ status: 409 });
    await expect(submitPreviewAssessment(courseId, id, context, owner)).rejects.toMatchObject({ status: 409 });
  }
  await expect(closePreviewAssessmentWindow(courseId, id, context, anotherWindow)).rejects.toMatchObject({ status: 409 });
  await answerPreviewAssessment(courseId, id, context, question.id, 'B', 0, windowId);
  await closePreviewAssessmentWindow(courseId, id, context, windowId);
  expect(receipt()).toMatchObject({ score: 7, submissionReason: 'window-closed' });
  const count = receiptUpdate.mock.calls.length; await closePreviewAssessmentWindow(courseId, id, context, windowId); expect(receiptUpdate).toHaveBeenCalledTimes(count);
  await expect(closePreviewAssessmentWindow(courseId, id, context, anotherWindow)).rejects.toMatchObject({ status: 409 });
});
test('Preview expired lease cannot be revived by heartbeat or rebinding', async () => {
  const state = await startPreviewAssessment(courseId, examId, context, windowId), id = new ObjectId(state.id);
  receipt().window!.expiresAt = new Date(Date.now() - 1);
  const renewed = await heartbeatPreviewAssessmentWindow(courseId, id, context, windowId);
  expect(renewed).toMatchObject({ submitted: true, submissionReason: 'connection-lost' });
  expect((await bindPreviewAssessmentWindow(courseId, id, context, windowId)).submitted).toBe(true);
  await expect(answerPreviewAssessment(courseId, id, context, question.id, 'B', 0, windowId)).rejects.toMatchObject({ status: 409 });
});
test('Preview due-only sweep respects renewed lease CAS and runs after course unpublication', async () => {
  const state = await startPreviewAssessment(courseId, examId, context, windowId), id = new ObjectId(state.id);
  receipt().window!.expiresAt = new Date(Date.now() - 1);
  receiptUpdate.mockImplementationOnce(async () => { receipt().window!.expiresAt = new Date(Date.now() + 120_000); return { matchedCount: 0 }; });
  expect(await expirePreviewAssessmentWindow(courseId, id, context)).toBe(false);
  expect(receipt().submittedAt).toBeUndefined();
  receipt().window!.expiresAt = new Date(Date.now() - 1); course.archivedAt = new Date();
  expect(await expirePreviewAssessmentWindow(courseId, id, context)).toBe(true);
  expect(receipt().submissionReason).toBe('connection-lost');
});
test('Preview state/list lazily finalizes lease expiry and preserves restricted answer withholding', async () => {
  publish(); const state = await startPreviewAssessment(courseId, examId, restricted, windowId), id = new ObjectId(state.id);
  receipt().window!.expiresAt = new Date(Date.now() - 1);
  expect((await listPreviewAssessments(courseId, restricted))[0].submitted).toBe(true);
  expect((await previewAssessmentState(courseId, id, restricted)).submissionReason).toBe('connection-lost');
  expect(await previewAssessmentResults(courseId, id, restricted)).toMatchObject({ released: false });
});

test('Preview heartbeat extends only its own lease while preserving saved answers/revision', async () => {
  const state = await startPreviewAssessment(courseId, examId, context, windowId), id = new ObjectId(state.id);
  await answerPreviewAssessment(courseId, id, context, question.id, 'B', 0, windowId);
  receipt().window!.expiresAt = new Date(Date.now() + 1000);
  expect((await heartbeatPreviewAssessmentWindow(courseId, id, context, windowId)).submitted).toBe(false);
  expect(receipt().window!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 119_000);
  expect(receipt().answers[question.id]).toBe('B'); expect(receipt().answerRevision).toBe(1);
  await expect(heartbeatPreviewAssessmentWindow(courseId, id, { ...context, instructorPuid: 'other' }, windowId)).rejects.toMatchObject({ status: 404 });
});
