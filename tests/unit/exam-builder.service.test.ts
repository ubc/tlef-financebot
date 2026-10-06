import { ObjectId, type WithId } from 'mongodb';
import type { BuilderExam, PaperQuestion } from '../../server/src/types/exam-builder';
jest.mock('../../server/src/components/jobs', () => ({ cancelJobsByDataIds: jest.fn(async () => 0) }));
jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries(['builderExamsCol','examCandidatesCol','examBuildRunsCol','examPublicationsCol','assessmentAttemptsCol','coursesCol','losCol','questionsCol','questionVersionsCol'].map(name => [name, jest.fn()])));
import { builderExamsCol, examBuildRunsCol, examPublicationsCol, examCandidatesCol, assessmentAttemptsCol, coursesCol, losCol } from '../../server/src/components/mongodb/collections';
import { assertEditable, examReadiness, publishBuilderExam, validateExamLos, validateSettings, renameBuilderExam, deleteBuilderExam } from '../../server/src/services/exam-builder.service';
import { cancelJobsByDataIds } from '../../server/src/components/jobs';
import { freezeExamQuestion } from '../../server/src/services/question-variant.service';
const courseId = new ObjectId(), examId = new ObjectId(), loId = new ObjectId();
const item: PaperQuestion = { id: '5eae1bc4-b4ab-4414-a0cf-10085511515a', source: 'generated', familyId: 'f', loIds: [loId.toHexString()], type: 'true-false', difficulty: 'easy', stem: 'Market risk can be eliminated through diversification.', options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: '' }, { key: 'B', text: 'False', role: 'correct', explanation: '' }], points: 2, minutes: 1, validated: true, practiceExposure: false, approval: { by: 'teacher', at: new Date().toISOString() } };
let exam: WithId<BuilderExam>;
const publish = jest.fn(), update = jest.fn();
beforeEach(() => {
  exam = { _id: examId, courseId, revision: 2, settings: { title: 'Midterm', kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: new Date().toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(), timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] }, items: [structuredClone(item)], createdAt: new Date(), updatedAt: new Date(), createdBy: 'teacher' };
  jest.mocked(builderExamsCol).mockReturnValue({ findOne: jest.fn(async () => exam), findOneAndUpdate: update } as never);
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => ({ lifecycle: 'published' })) } as never);
  jest.mocked(losCol).mockReturnValue({ countDocuments: jest.fn(async () => 1) } as never);
  jest.mocked(examBuildRunsCol).mockReturnValue({ countDocuments: jest.fn(async () => 0) } as never);
  jest.mocked(assessmentAttemptsCol).mockReturnValue({ countDocuments: jest.fn(async () => 0) } as never);
  jest.mocked(examPublicationsCol).mockReturnValue({ updateOne: publish } as never);
  update.mockResolvedValue({ ...exam, revision: 3 }); publish.mockResolvedValue({});
});
test('publication snapshots content and uses revision plus no-started-at CAS', async () => {
  await publishBuilderExam(courseId, examId, 2, 'teacher');
  expect(publish).toHaveBeenCalledWith(expect.anything(), { $setOnInsert: expect.objectContaining({ items: exam.items, settings: exam.settings, hash: expect.any(String) }) }, { upsert: true });
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, startedAt: { $exists: false } }), expect.objectContaining({ $inc: { revision: 1 } }), { returnDocument: 'after' });
});
test('unreviewed questions, invalid settings and active reservations block publication', async () => {
  delete exam.items[0].approval; expect(examReadiness(exam).blockers.length).toBeGreaterThan(0);
  await expect(publishBuilderExam(courseId, examId, 2, 'teacher')).rejects.toMatchObject({ status: 409 });
  exam.items[0].approval = item.approval; exam.activeRunIds = ['active'];
  await expect(publishBuilderExam(courseId, examId, 2, 'teacher')).rejects.toThrow('active generation'); expect(publish).not.toHaveBeenCalled();
});
test('stale editors and published snapshots are not writable', () => {
  expect(() => assertEditable(exam, 1)).toThrow('another session'); exam.publishedRevision = 2;
  expect(() => assertEditable(exam, 2)).toThrow('locked');
});
test('foreign or deleted objectives are refused', async () => {
  jest.mocked(losCol).mockReturnValue({ countDocuments: jest.fn(async () => 0) } as never);
  await expect(validateExamLos(courseId, [loId.toHexString()])).rejects.toMatchObject({ status: 400 });
});
test('formal feedback cannot be immediate and malformed timezone is rejected', () => {
  expect(() => validateSettings({ ...exam.settings, feedback: 'immediate' })).toThrow('practice');
  expect(() => validateSettings({ ...exam.settings, timeZone: 'not-a-timezone' })).toThrow('timezone');
});
test('frozen question rejects duplicate options and preserves answer/explanation mapping', async () => {
  const frozen = await freezeExamQuestion({ ...item }, 'fixed');
  expect(frozen.stem).toBe(item.stem); expect(frozen.options[1].role).toBe('correct');
  await expect(freezeExamQuestion({ ...item, options: item.options.map(o => ({ ...o, text: 'Same option' })) }, 'fixed')).rejects.toThrow('invalid');
});


describe('exam catalog rename and delete', () => {
  const candidateDelete = jest.fn(), runDelete = jest.fn(), publicationDelete = jest.fn(), headDelete = jest.fn();
  beforeEach(() => {
    jest.mocked(examCandidatesCol).mockReturnValue({ deleteMany: candidateDelete } as never);
    jest.mocked(examBuildRunsCol).mockReturnValue({ countDocuments: jest.fn(async () => 0), find: jest.fn(() => ({ toArray: async () => [{ _id: new ObjectId() }] })), deleteMany: runDelete } as never);
    jest.mocked(examPublicationsCol).mockReturnValue({ deleteMany: publicationDelete } as never);
    jest.mocked(builderExamsCol).mockReturnValue({ findOne: jest.fn(async () => exam), findOneAndUpdate: update, deleteOne: headDelete } as never);
  });
  test('rename is revision-checked and keeps published papers locked', async () => {
    exam.publishedRevision = exam.revision;
    await renameBuilderExam(courseId, examId, 2, '  New exam name  ');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ courseId, revision: 2, deletingAt: { $exists: false } }),
      expect.objectContaining({ $set: expect.objectContaining({ displayTitle: 'New exam name', publishedRevision: 3 }), $inc: { revision: 1 } }), { returnDocument: 'after' });
    await expect(renameBuilderExam(courseId, examId, 1, 'stale')).rejects.toThrow('changed');
  });
  test('delete marks the same course exam, clears only its children, then removes the head', async () => {
    const order: string[] = [];
    update.mockImplementation(async () => { order.push('mark'); return { ...exam, deletingAt: new Date() }; });
    jest.mocked(cancelJobsByDataIds).mockImplementation(async () => { order.push('jobs'); return 1; });
    candidateDelete.mockImplementation(async () => { order.push('candidates'); return { deletedCount: 1 }; });
    runDelete.mockImplementation(async () => { order.push('runs'); return { deletedCount: 1 }; });
    publicationDelete.mockImplementation(async () => { order.push('publications'); return { deletedCount: 1 }; });
    headDelete.mockImplementation(async () => { order.push('head'); return { deletedCount: 1 }; });
    await deleteBuilderExam(courseId, examId, 2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, startedAt: { $exists: false }, 'activeRunIds.0': { $exists: false } }), expect.objectContaining({ $set: expect.objectContaining({ deletingAt: expect.any(Date) }) }), { returnDocument: 'after' });
    expect(candidateDelete).toHaveBeenCalledWith({ courseId, examId });
    expect(runDelete).toHaveBeenCalledWith({ courseId, examId });
    expect(publicationDelete).toHaveBeenCalledWith({ courseId, examId });
    expect(headDelete).toHaveBeenCalledWith({ _id: examId, courseId, deletingAt: { $exists: true } });
    expect(order.at(-1)).toBe('head');
  });
  test('student starts, active jobs and stale editors block deletion before marking', async () => {
    exam.startedAt = new Date(); await expect(deleteBuilderExam(courseId, examId, 2)).rejects.toThrow('Students have started');
    delete exam.startedAt; exam.activeRunIds = ['running']; await expect(deleteBuilderExam(courseId, examId, 2)).rejects.toThrow('Cancel active');
    exam.activeRunIds = []; await expect(deleteBuilderExam(courseId, examId, 1)).rejects.toThrow('changed');
    expect(update).not.toHaveBeenCalled(); expect(headDelete).not.toHaveBeenCalled();
  });
  test('an interrupted cleanup can be safely retried without remarking the exam', async () => {
    exam.deletingAt = new Date(); await deleteBuilderExam(courseId, examId, 2);
    expect(update).not.toHaveBeenCalled(); expect(headDelete).toHaveBeenCalledTimes(1);
  });
});
