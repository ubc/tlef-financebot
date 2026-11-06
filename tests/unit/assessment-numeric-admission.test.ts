import { ObjectId } from 'mongodb';
jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries([
  'assessmentAttemptsCol', 'previewAssessmentAttemptsCol', 'examPublicationsCol', 'builderExamsCol', 'coursesCol',
  'questionVersionsCol', 'losCol', 'examBuildRunsCol',
].map(name => [name, jest.fn()])));
import { assessmentAttemptsCol, previewAssessmentAttemptsCol, examPublicationsCol, builderExamsCol, coursesCol, questionVersionsCol } from '../../server/src/components/mongodb/collections';
import { frozenNumericalPaperProblem } from '../../server/src/services/assessment-numeric-admission.service';
import { startAssessment, gradeAssessment } from '../../server/src/services/assessment-attempts.service';
import { startPreviewAssessment } from '../../server/src/services/assessment-preview.service';
import { resolveSlotsAndDerived, substituteParams } from '../../server/src/services/params.service';
import type { PaperQuestion } from '../../server/src/types/exam-builder';

const courseId = new ObjectId(), examId = new ObjectId(), publicationId = new ObjectId(), attemptId = new ObjectId();
const context = { instructorPuid: 'teacher', previewSessionId: 'ea30139b-a098-4e25-b230-bee24e6c181d', access: 'restricted' as const };
const definition = { stem: 'Rate {{RF}}%, beta {{BETA}}, premium {{RP}} as a fraction.', paramSlots: [
  { name: 'RF', values: [2.75] }, { name: 'BETA', values: [1.0013] }, { name: 'RP', values: [0.0576] },
], derivedValues: [{ name: 'A', formula: 'RF+BETA*RP*100' }, { name: 'B', formula: 'RF+RP*100' }],
options: [{ key: 'A', text: '{{A}}%' }, { key: 'B', text: '{{B}}%' }] };
function frozen(beta = 1.0013): PaperQuestion {
  const paramSlots = definition.paramSlots.map(slot => slot.name === 'BETA' ? { ...slot, values: [beta] } : slot);
  const paramValues = resolveSlotsAndDerived(paramSlots, definition.derivedValues, 1);
  return { id: '5eae1bc4-b4ab-4414-a0cf-10085511515a', source: 'generated', familyId: 'family', loIds: [new ObjectId().toHexString()], type: 'true-false', difficulty: 'easy',
    stem: substituteParams(definition.stem, paramValues), options: definition.options.map((option, index) => ({ ...option, text: substituteParams(option.text, paramValues), role: index ? 'clearly-wrong' : 'correct', explanation: 'Frozen explanation' })),
    numericDefinition: { ...definition, paramSlots }, paramValues, points: 1, minutes: 1, validated: true, practiceExposure: false, approval: { by: 'teacher', at: new Date().toISOString() } };
}
const insert = jest.fn(), writeHead = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: jest.fn(async () => null) } as never);
});
function backing(existing = false, submitted = false) {
  const settings = { title: 'Historical numerical paper', kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3_600_000).toISOString(), timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] };
  const item = frozen(), publication = { _id: publicationId, courseId, examId, revision: 1, settings, items: [item] };
  const attempt = { _id: attemptId, courseId, examId, publicationId, puid: 'student', answerRevision: 0, revision: 1, order: [item.id], answers: { [item.id]: 'A' }, startedAt: new Date(), deadline: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 86_400_000),
    snapshot: { title: settings.title, settings, items: [item] }, ...(submitted ? { submittedAt: new Date(), score: 1 } : {}) };
  jest.mocked(coursesCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: courseId, lifecycle: 'published', published: true })) } as never);
  jest.mocked(builderExamsCol).mockReturnValue({ findOne: jest.fn(async () => ({ _id: examId, courseId, revision: 1, publishedRevision: 1, publicationId, settings, items: [item] })), updateOne: writeHead } as never);
  jest.mocked(examPublicationsCol).mockReturnValue({ findOne: jest.fn(async () => publication) } as never);
  jest.mocked(assessmentAttemptsCol).mockReturnValue({ findOne: jest.fn(async () => existing ? attempt : null), insertOne: insert } as never);
  jest.mocked(previewAssessmentAttemptsCol).mockReturnValue({ findOne: jest.fn(async () => existing ? attempt : null), insertOne: insert, deleteOne: jest.fn() } as never);
  return { publication, attempt };
}

test('a safe exact frozen instance is admitted without changing its text or raw values', async () => {
  const safe = frozen(1.2), before = JSON.stringify(safe);
  expect(await frozenNumericalPaperProblem([safe])).toBeUndefined();
  expect(JSON.stringify(safe)).toBe(before);
});
test('historical pinned Bank content is checked against exact frozen values rather than a new draw', async () => {
  const historical = { ...frozen(), source: 'bank' as const, questionId: new ObjectId().toHexString(), versionId: new ObjectId().toHexString() };
  delete historical.numericDefinition;
  const findOne = jest.fn(async () => ({ ...definition, options: definition.options, paramSlots: definition.paramSlots }));
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne } as never);
  expect(await frozenNumericalPaperProblem([historical])).toContain('displayed inputs do not reproduce');
  expect(findOne).toHaveBeenCalledWith({ _id: new ObjectId(historical.versionId), questionId: new ObjectId(historical.questionId) });
});
test('an old unpinned numeric paper without reproducible definitions is refused with a recreation reason', async () => {
  const historical = frozen(); delete historical.numericDefinition;
  expect(await frozenNumericalPaperProblem([historical])).toContain('recreate this paper');
});
test('a template of an old context variant cannot silently stand in for its actual frozen formula', async () => {
  const inconsistent = frozen(1.2); inconsistent.stem = 'Different generated context';
  expect(await frozenNumericalPaperProblem([inconsistent])).toContain('recreate this paper');
});
test('a new live sitting refuses the unsafe published instance before taking the first-start lock', async () => {
  backing();
  await expect(startAssessment(courseId, examId, 'student')).rejects.toThrow('displayed inputs do not reproduce');
  expect(insert).not.toHaveBeenCalled(); expect(writeHead).not.toHaveBeenCalled();
});
test('a new isolated rehearsal refuses the same unsafe frozen instance', async () => {
  backing();
  await expect(startPreviewAssessment(courseId, examId, context)).rejects.toThrow('displayed inputs do not reproduce');
  expect(insert).not.toHaveBeenCalled(); expect(writeHead).not.toHaveBeenCalled();
});
test.each([false, true])('existing active/submitted sitting (%s) resumes and retains frozen grading', async submitted => {
  const { publication, attempt } = backing(true, submitted);
  const old = JSON.stringify(publication.items);
  const liveState = await startAssessment(courseId, examId, 'student');
  const previewState = await startPreviewAssessment(courseId, examId, context);
  expect(liveState.id).toBe(attemptId.toHexString());
  expect(previewState.id).toBe(attemptId.toHexString());
  expect(JSON.stringify([liveState, previewState])).not.toMatch(/numericDefinition|formula|derivedValues|paramSlots|paramValues|RF\+BETA|role|correct|explanation/);
  expect(gradeAssessment(attempt, publication as never)).toBe(1);
  expect(JSON.stringify(publication.items)).toBe(old);
  expect(insert).not.toHaveBeenCalled(); expect(writeHead).not.toHaveBeenCalled();
});
