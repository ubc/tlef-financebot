import { ObjectId, type WithId } from 'mongodb';
import type { QuestionVersion } from '../../server/src/types/domain';
jest.mock('../../server/src/components/jobs', () => ({ cancelJobsByDataIds: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries(['coursesCol', 'losCol', 'themesCol', 'questionsCol', 'questionVersionsCol', 'builderExamsCol', 'examPublicationsCol', 'examBuildRunsCol', 'assessmentAttemptsCol'].map(name => [name, jest.fn()])));
import { coursesCol, losCol, themesCol, questionsCol, questionVersionsCol, builderExamsCol, examPublicationsCol, examBuildRunsCol, assessmentAttemptsCol } from '../../server/src/components/mongodb/collections';
import { examBankCatalog, pickTopicSample, sampleExamBank, type ExamSampleRequest } from '../../server/src/services/exam-bank.service';
import { addBankItems, publishBuilderExam } from '../../server/src/services/exam-builder.service';
import { formatParamValue } from '../../server/src/services/params.service';
import { freezeExamQuestion, prepareExamVersion } from '../../server/src/services/question-variant.service';
const courseId = new ObjectId(), examId = new ObjectId(), topicId = new ObjectId(), loId = new ObjectId();
const questionId = new ObjectId(), versionId = new ObjectId();
const conceptual = { _id: versionId, questionId, version: 1, sourceRefs: [], createdAt: new Date(), createdBy: 'teacher', type: 'true-false', difficulty: 'easy', stem: 'Diversification eliminates systematic risk.', options: [{ key: 'A', text: 'True', explanation: 'Systematic risk remains.', role: 'common-misconception' }, { key: 'B', text: 'False', explanation: 'Correct.', role: 'correct' }] } as WithId<QuestionVersion>;
const numeric = { ...conceptual, type: 'mcq', numericKind: 'numeric', stem: 'A cash flow of ${{CF}} has a discount rate of {{RATE}}%. What is its present value?', paramSlots: [{ name: 'CF', min: 100, max: 900, step: 10 }, { name: 'RATE', min: 1, max: 9, step: 1 }], derivedValues: [{ name: 'PV', formula: 'CF/(1+RATE/100)' }, { name: 'D1', formula: 'CF' }, { name: 'D2', formula: 'CF*(1+RATE/100)' }, { name: 'D3', formula: 'CF/2' }], options: ['PV', 'D1', 'D2', 'D3'].map((name, i) => ({ key: String(i), text: `$ {{${name}}}`, role: i === 0 ? 'correct' : 'clearly-wrong', explanation: 'Discount ${{CF}} consistently.' })) } as WithId<QuestionVersion>;
let versions: WithId<QuestionVersion>[], heads: Array<Record<string, unknown>>, exam: Record<string, unknown>;
const update = jest.fn(), findHeads = jest.fn(), findVersions = jest.fn();
const cursor = (read: () => unknown[]) => ({ sort: () => cursor(read), toArray: async () => read() });
beforeEach(() => {
  versions = [conceptual];
  heads = [{ _id: questionId, currentVersionId: versionId, courseId, state: 'approved', labels: [], loIds: [loId], themeIds: [topicId] }];
  exam = { _id: examId, courseId, revision: 2, settings: {}, items: [] };
  findHeads.mockImplementation(() => cursor(() => heads)); findVersions.mockImplementation(() => cursor(() => versions));
  jest.mocked(coursesCol).mockReturnValue({ findOne: async () => ({ lifecycle: 'published' }) } as never);
  jest.mocked(themesCol).mockReturnValue({ find: () => cursor(() => [{ _id: topicId, courseId }]) } as never);
  jest.mocked(losCol).mockReturnValue({ find: () => cursor(() => [{ _id: loId, courseId, themeId: topicId }]), countDocuments: async () => 1 } as never);
  jest.mocked(questionsCol).mockReturnValue({ find: findHeads, findOne: async () => heads[0] } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: findVersions, findOne: async () => versions[0] } as never);
  jest.mocked(builderExamsCol).mockReturnValue({ findOne: async () => exam, findOneAndUpdate: update } as never);
  update.mockImplementation(async (_filter, patch) => ({ ...exam, ...patch.$set, revision: 3 }));
});
const input: ExamSampleRequest = { mode: 'total', topics: [{ topicId: topicId.toHexString(), count: 1 }], count: 1 };
test('catalog contains exact current approved versions, topic labels and the checked fixed sample', async () => {
  const result = await examBankCatalog(courseId);
  expect(findHeads).toHaveBeenCalledWith({ courseId, state: 'approved' });
  expect(findVersions).toHaveBeenCalledWith({ _id: { $in: [versionId] } });
  expect(result.questions[0]).toMatchObject({ themeIds: [topicId.toHexString()], contentReady: true, sample: { stem: conceptual.stem } });
  expect(update).not.toHaveBeenCalled();
});
test('preview is read-only, pins the displayed version and filters type/difficulty', async () => {
  const sample = await sampleExamBank(courseId, examId, 2, input);
  expect(sample).toMatchObject({ revision: 2, questions: [{ questionId: questionId.toHexString(), versionId: versionId.toHexString(), stem: conceptual.stem }] });
  expect(update).not.toHaveBeenCalled();
  await expect(sampleExamBank(courseId, examId, 2, { ...input, type: 'mcq' })).rejects.toThrow('Not enough');
  await expect(sampleExamBank(courseId, examId, 2, { ...input, difficulty: 'hard' })).rejects.toThrow('Not enough');
});
test('old numerical proofs are rechecked without changing the public version; missing definitions remain blocked', async () => {
  const checked = prepareExamVersion(numeric);
  expect(checked.verification?.sampleSeeds).toHaveLength(100);
  expect(numeric.verification).toBeUndefined();
  const frozen = await freezeExamQuestion(numeric, 'numeric-sample');
  expect(frozen.validated).toBe(true); expect(frozen.stem).not.toContain('{{');
  versions = [{ ...numeric, paramSlots: undefined, derivedValues: undefined, stem: 'What is the PV of $100?', options: conceptual.options }];
  const catalog = await examBankCatalog(courseId);
  expect(catalog.questions[0]).toMatchObject({ contentReady: false, blockedReason: expect.stringContaining('numerical proof') });
  await expect(sampleExamBank(courseId, examId, 2, input)).rejects.toThrow('Not enough');
});
test('broken formulas, duplicate answers and unresolved placeholders never become eligible', () => {
  expect(() => prepareExamVersion({ ...numeric, derivedValues: numeric.derivedValues!.map(v => ({ ...v, formula: '1' })) })).toThrow('Numerical check failed');
  expect(() => prepareExamVersion({ ...numeric, stem: 'Calculate {{MISSING}}' })).toThrow('Unresolved');
  expect(() => prepareExamVersion({ ...numeric, derivedValues: numeric.derivedValues!.map(v => ({ ...v, formula: 'UNKNOWN(CF)' })) })).toThrow('Numerical check failed');
});
test('per-topic matching handles overlapping pools without duplicates or false greedy shortages', () => {
  for (let i = 0; i < 20; i++) {
    const picked = pickTopicSample([{ topicId: 'A', count: 1, ids: ['shared', 'A-only'] }, { topicId: 'B', count: 1, ids: ['shared'] }]);
    expect(picked).toEqual([{ questionId: 'A-only', topicId: 'A' }, { questionId: 'shared', topicId: 'B' }]);
  }
  expect(() => pickTopicSample([{ topicId: 'A', count: 2, ids: ['shared'] }])).toThrow('distinct');
});
test('sampling excludes existing variants, stale papers, foreign topics and over-capacity requests', async () => {
  exam.items = [{ source: 'variant', questionId: questionId.toHexString() }];
  await expect(sampleExamBank(courseId, examId, 2, input)).rejects.toThrow('Not enough');
  await expect(sampleExamBank(courseId, examId, 1, input)).rejects.toThrow('another session');
  jest.mocked(themesCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  await expect(sampleExamBank(courseId, examId, 2, input)).rejects.toThrow('another course');
  expect(update).not.toHaveBeenCalled();
});
test('manual selection revalidates current approval and commits only frozen values; numeric variant has no generation run', async () => {
  versions = [numeric];
  const saved = await addBankItems(courseId, examId, 2, [{ questionId: questionId.toHexString(), versionId: versionId.toHexString(), mode: 'parameters' }], 'teacher');
  expect(saved.items[0]).toMatchObject({ source: 'variant', validated: true, approval: { by: 'teacher' }, versionId: versionId.toHexString() });
  expect(saved.items[0].stem).not.toContain('{{');
  expect(update).toHaveBeenCalledTimes(1);
  heads[0].state = 'draft'; update.mockClear();
  await expect(addBankItems(courseId, examId, 2, [{ questionId: questionId.toHexString(), versionId: versionId.toHexString() }], 'teacher')).rejects.toThrow('current approved');
  expect(update).not.toHaveBeenCalled();
});
test('stale bank refs and a concurrent paper write cannot silently add a changed version', async () => {
  heads[0].currentVersionId = new ObjectId();
  await expect(addBankItems(courseId, examId, 2, [{ questionId: questionId.toHexString(), versionId: versionId.toHexString() }], 'teacher')).rejects.toThrow('current approved');
  heads[0].currentVersionId = versionId; update.mockResolvedValue(null);
  await expect(addBankItems(courseId, examId, 2, [{ questionId: questionId.toHexString(), versionId: versionId.toHexString() }], 'teacher')).rejects.toThrow('another session');
});

test('per-topic preview fills exact quotas across different LOs, caps the whole paper and excludes archived objectives', async () => {
  const topic2 = new ObjectId(), lo2 = new ObjectId(), q2 = new ObjectId(), v2 = new ObjectId();
  heads.push({ ...heads[0], _id: q2, currentVersionId: v2, loIds: [lo2], themeIds: [topic2] });
  versions.push({ ...conceptual, _id: v2, questionId: q2 });
  jest.mocked(themesCol).mockReturnValue({ find: () => cursor(() => [{ _id: topicId }, { _id: topic2 }]) } as never);
  jest.mocked(losCol).mockReturnValue({ find: () => cursor(() => [{ _id: loId, themeId: topicId }, { _id: lo2, themeId: topic2 }]) } as never);
  const mix = { ...input, mode: 'per-topic' as const, topics: [...input.topics, { topicId: topic2.toHexString(), count: 1 }] };
  const sample = await sampleExamBank(courseId, examId, 2, mix);
  expect(sample.questions.map(q => q.topicId)).toEqual([topicId.toHexString(), topic2.toHexString()]);
  expect(new Set(sample.questions.map(q => q.questionId)).size).toBe(2);
  exam.items = Array.from({ length: 99 }, () => ({ source: 'generated' }));
  await expect(sampleExamBank(courseId, examId, 2, mix)).rejects.toThrow('100-question');
  exam.items = [];
  jest.mocked(losCol).mockReturnValue({ find: () => cursor(() => [{ _id: loId, themeId: topicId }]) } as never);
  expect((await examBankCatalog(courseId)).questions.find(q => q.id === q2.toHexString())).toMatchObject({ contentReady: false, blockedReason: expect.stringContaining('removed learning objective') });
});
test('a blocked row in a bulk add never partially saves the preceding valid choice', async () => {
  const q2 = new ObjectId(), v2 = new ObjectId();
  jest.mocked(questionsCol).mockReturnValue({ findOne: async ({ _id }: { _id: ObjectId }) => _id.equals(questionId) ? heads[0] : { ...heads[0], _id: q2, currentVersionId: v2 } } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ findOne: async ({ _id }: { _id: ObjectId }) => _id.equals(versionId) ? conceptual : { ...numeric, _id: v2, questionId: q2, derivedValues: undefined, paramSlots: undefined, stem: 'Calculate $100.', options: conceptual.options } } as never);
  await expect(addBankItems(courseId, examId, 2, [{ questionId: questionId.toHexString(), versionId: versionId.toHexString() }, { questionId: q2.toHexString(), versionId: v2.toHexString() }], 'teacher')).rejects.toThrow('numerical proof');
  expect(update).not.toHaveBeenCalled();
});


test('manually selected and sampled bank questions publish without another approval, with frozen numeric answers unchanged', async () => {
  const q2 = new ObjectId(), v2 = new ObjectId();
  versions.push({ ...numeric, _id: v2, questionId: q2 });
  heads.push({ ...heads[0], _id: q2, currentVersionId: v2 });
  jest.mocked(questionsCol).mockReturnValue({ find: findHeads, findOne: async ({ _id }: { _id: ObjectId }) => heads.find(q => (q._id as ObjectId).equals(_id)) } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: findVersions, findOne: async ({ _id }: { _id: ObjectId }) => versions.find(v => v._id.equals(_id)) } as never);
  exam.settings = { title: 'Bank selection regression', kind: 'midterm', purpose: 'practice', durationMinutes: 20, opensAt: '2026-10-13T00:00:00.000Z', closesAt: '2026-10-14T00:00:00.000Z', timeZone: 'America/Vancouver', feedback: 'immediate', shuffle: false, accommodations: [] };
  update.mockImplementation(async (filter, patch) => {
    if (filter.revision !== exam.revision) return null;
    exam = { ...exam, ...patch.$set, revision: Number(exam.revision) + 1 };
    return exam;
  });
  // Select the conceptual question explicitly, then sample the remaining bank pool.
  const selected = await addBankItems(courseId, examId, 2, [{ questionId: questionId.toHexString(), versionId: versionId.toHexString() }], 'teacher');
  expect(selected.items[0].approval).toBeDefined();
  const sample = await sampleExamBank(courseId, examId, selected.revision, input);
  expect(sample.questions.map(q => q.questionId)).toEqual([q2.toHexString()]);
  const added = await addBankItems(courseId, examId, selected.revision, sample.questions.map(({ questionId, versionId }) => ({ questionId, versionId, mode: 'parameters' as const })), 'teacher');
  const numerical = added.items[1];
  const values = numerical.paramValues!;
  expect(numerical.options.find(o => o.role === 'correct')!.text).toBe(`$ ${formatParamValue(values.CF / (1 + values.RATE / 100), { currency: true })}`);
  expect(numerical.options.every(o => o.explanation.includes(String(values.CF)))).toBe(true);
  expect(numerical.approval).toBeDefined();
  const publish = jest.fn(); publish.mockResolvedValue({});
  jest.mocked(examPublicationsCol).mockReturnValue({ updateOne: publish } as never);
  jest.mocked(examBuildRunsCol).mockReturnValue({ countDocuments: async () => 0 } as never);
  jest.mocked(assessmentAttemptsCol).mockReturnValue({ countDocuments: async () => 0 } as never);
  await publishBuilderExam(courseId, examId, added.revision, 'teacher');
  expect(publish).toHaveBeenCalledWith(expect.anything(), { $setOnInsert: expect.objectContaining({ items: added.items, settings: added.settings }) }, { upsert: true });
  expect(publish.mock.calls[0][1].$setOnInsert.items[1].paramValues).toEqual(values);
  expect(exam.publishedRevision).toBe(exam.revision);
});
