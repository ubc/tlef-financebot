import { ObjectId, type WithId } from 'mongodb';
import type { AssessmentAttempt, ExamPublication, PaperQuestion } from '../../server/src/types/exam-builder';
jest.mock('../../server/src/components/mongodb/collections', () => ({ assessmentAttemptsCol: jest.fn(), examPublicationsCol: jest.fn(), builderExamsCol: jest.fn(), coursesCol: jest.fn() }));
import { assessmentAttemptsCol, examPublicationsCol, builderExamsCol } from '../../server/src/components/mongodb/collections';
import { assessmentState, assessmentResults, answerAssessment, submitAssessment, answersReleased, gradeAssessment } from '../../server/src/services/assessment-attempts.service';
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
  updateOne.mockImplementation(async (_filter, update) => { Object.assign(attempt, update.$set); return { matchedCount: 1 }; });
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
