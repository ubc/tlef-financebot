import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { questionsCol, questionVersionsCol, auditCol } from '../../server/src/components/mongodb/collections';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  auditCol: jest.fn(),
}));

import {
  createQuestion,
  editQuestion,
  transitionQuestion,
  bulkTransition,
} from '../../server/src/services/questions.service';
import type { QuestionOption, QuestionVersion } from '../../server/src/types/domain';

// Per-collection method mocks, wired onto the mocked accessors in beforeEach —
// follows the tests/unit/courses.service.test.ts mocking pattern.
const questionsInsertOne = jest.fn();
const questionsFindOne = jest.fn();
const questionsUpdateOne = jest.fn();
const versionsInsertOne = jest.fn();
const versionsFindOne = jest.fn();
const auditInsertOne = jest.fn();

beforeEach(() => {
  questionsInsertOne.mockReset();
  questionsFindOne.mockReset();
  questionsUpdateOne.mockReset();
  versionsInsertOne.mockReset();
  versionsFindOne.mockReset();
  auditInsertOne.mockReset();

  // Real insertOne with an explicit _id in the doc returns that _id as insertedId.
  questionsInsertOne.mockImplementation(async (doc: { _id: ObjectId }) => ({
    acknowledged: true,
    insertedId: doc._id,
  }));
  versionsInsertOne.mockImplementation(async (doc: { _id: ObjectId }) => ({
    acknowledged: true,
    insertedId: doc._id,
  }));

  jest.mocked(questionsCol).mockReturnValue({
    insertOne: questionsInsertOne,
    findOne: questionsFindOne,
    updateOne: questionsUpdateOne,
  } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({
    insertOne: versionsInsertOne,
    findOne: versionsFindOne,
  } as never);
  jest.mocked(auditCol).mockReturnValue({ insertOne: auditInsertOne } as never);
});

// --- Fixtures ------------------------------------------------------------

function mcqOptions(correctKey: 'A' | 'B' | 'C' | 'D' = 'A'): QuestionOption[] {
  return ['A', 'B', 'C', 'D'].map((key) => ({
    key,
    text: `Option ${key}`,
    role: key === correctKey ? 'correct' : 'clearly-wrong',
    explanation: `Why ${key}`,
  }));
}

function tfOptions(overrides: Partial<Record<'T' | 'F', QuestionOption['role']>> = {}): QuestionOption[] {
  return [
    { key: 'T', text: 'True', role: overrides.T ?? 'correct', explanation: 'True explanation' },
    { key: 'F', text: 'False', role: overrides.F ?? 'clearly-wrong', explanation: 'False explanation' },
  ];
}

function baseInput(overrides: Partial<Parameters<typeof createQuestion>[0]> = {}) {
  return {
    courseId: new ObjectId(),
    loIds: [new ObjectId()],
    themeIds: [new ObjectId()],
    type: 'mcq' as const,
    stem: 'What is 2 + 2?',
    options: mcqOptions(),
    difficulty: 'easy' as const,
    createdBy: 'PUID-INSTR-0001',
    ...overrides,
  };
}

// --- createQuestion --------------------------------------------------------

describe('createQuestion (IN-Q03/Q04)', () => {
  it('inserts a draft head + version 1', async () => {
    const result = await createQuestion(baseInput());

    const [headDoc] = questionsInsertOne.mock.calls[0];
    expect(headDoc.state).toBe('draft');
    expect(headDoc.labels).toEqual([]);
    expect(headDoc.internalNotes).toEqual([]);
    expect(headDoc.currentVersion).toBe(1);
    expect(headDoc.currentVersionId).toEqual(result.version._id);

    const [versionDoc] = versionsInsertOne.mock.calls[0];
    expect(versionDoc.version).toBe(1);
    expect(versionDoc.questionId).toEqual(result.questionId);
    expect(versionDoc.sourceRefs).toEqual([]);
    expect(result.version.options).toHaveLength(4);
  });

  it('throws invalid-options when an MCQ does not have exactly 4 options', async () => {
    const input = baseInput({ options: mcqOptions().slice(0, 3) });

    await expect(createQuestion(input)).rejects.toThrow('invalid-options:expected-4-options');
    expect(questionsInsertOne).not.toHaveBeenCalled();
    expect(versionsInsertOne).not.toHaveBeenCalled();
  });

  it('throws invalid-options when more than one option is marked correct', async () => {
    const options = mcqOptions();
    options[1] = { ...options[1], role: 'correct' };

    await expect(createQuestion(baseInput({ options }))).rejects.toThrow('invalid-options:exactly-one-correct');
    expect(questionsInsertOne).not.toHaveBeenCalled();
  });

  it('coerces a true-false incorrect option role to common-misconception', async () => {
    const options = tfOptions({ F: 'clearly-wrong' });

    const result = await createQuestion(baseInput({ type: 'true-false', options }));

    expect(result.version.options).toHaveLength(2);
    expect(result.version.options.find((o) => o.key === 'T')?.role).toBe('correct');
    expect(result.version.options.find((o) => o.key === 'F')?.role).toBe('common-misconception');
  });
});

// --- editQuestion -----------------------------------------------------------

describe('editQuestion (IN-Q03)', () => {
  const questionId = new ObjectId();
  const versionId = new ObjectId();
  const currentVersion: WithId<QuestionVersion> = {
    _id: versionId,
    questionId,
    version: 1,
    type: 'mcq',
    stem: 'Original stem',
    options: mcqOptions(),
    difficulty: 'easy',
    sourceRefs: [],
    createdBy: 'pipeline',
    createdAt: new Date('2026-01-01'),
  };
  const questionHead = {
    _id: questionId,
    courseId: new ObjectId(),
    currentVersionId: versionId,
    currentVersion: 1,
    state: 'draft' as const,
    loIds: [new ObjectId()],
    themeIds: [new ObjectId()],
    labels: [],
    internalNotes: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    questionsFindOne.mockResolvedValue(questionHead);
    versionsFindOne.mockResolvedValue(currentVersion);
    versionsInsertOne.mockResolvedValue({ acknowledged: true, insertedId: new ObjectId() });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  it('inserts version 2 copying unpatched fields and records editedFields for the patched key', async () => {
    const result = await editQuestion(questionId, { stem: 'Updated stem' }, 'PUID-INSTR-0002');

    const [versionDoc] = versionsInsertOne.mock.calls[0];
    expect(versionDoc.version).toBe(2);
    expect(versionDoc.stem).toBe('Updated stem');
    expect(versionDoc.options).toEqual(currentVersion.options); // copied, unpatched
    expect(versionDoc.difficulty).toBe(currentVersion.difficulty); // copied, unpatched
    expect(versionDoc.editedFields).toEqual(['stem']);
    expect(versionDoc.createdBy).toBe('PUID-INSTR-0002');
    expect(result.version).toBe(2);
  });

  it('updates the head currentVersionId/currentVersion and adds manually-edited exactly once', async () => {
    const insertedVersionId = new ObjectId();
    versionsInsertOne.mockResolvedValue({ acknowledged: true, insertedId: insertedVersionId });

    await editQuestion(questionId, { stem: 'Updated stem' }, 'PUID-INSTR-0002');

    expect(questionsUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = questionsUpdateOne.mock.calls[0];
    expect(filter).toEqual({ _id: questionId });
    expect(update.$set.currentVersionId).toEqual(insertedVersionId);
    expect(update.$set.currentVersion).toBe(2);
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(update.$addToSet).toEqual({ labels: 'manually-edited' });
  });

  it('validates patched options against the version\'s existing (unpatchable) type', async () => {
    const badOptions = mcqOptions().slice(0, 3);

    await expect(editQuestion(questionId, { options: badOptions }, 'PUID-INSTR-0002')).rejects.toThrow(
      'invalid-options:expected-4-options',
    );
    expect(versionsInsertOne).not.toHaveBeenCalled();
    expect(questionsUpdateOne).not.toHaveBeenCalled();
  });

  it('does not record loIds/themeIds as editedFields (head fields, not version content)', async () => {
    const result = await editQuestion(
      questionId,
      { difficulty: 'hard', loIds: [new ObjectId()] },
      'PUID-INSTR-0002',
    );

    expect(result.editedFields).toEqual(['difficulty']);
    const [, update] = questionsUpdateOne.mock.calls[0];
    expect(update.$set.loIds).toBeDefined();
  });
});

// --- transitionQuestion ------------------------------------------------------

describe('transitionQuestion (IN-Q07)', () => {
  const questionId = new ObjectId();

  it('allows pending-review -> approved and writes an audit log entry', async () => {
    const courseId = new ObjectId();
    questionsFindOne.mockResolvedValue({ _id: questionId, courseId, state: 'pending-review' });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true });
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    const result = await transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001');

    expect(result.state).toBe('approved');
    const [filter, update] = questionsUpdateOne.mock.calls[0];
    expect(filter).toEqual({ _id: questionId });
    expect(update.$set.state).toBe('approved');
    expect(update.$set.updatedAt).toBeInstanceOf(Date);

    expect(auditInsertOne).toHaveBeenCalledTimes(1);
    const [auditDoc] = auditInsertOne.mock.calls[0];
    expect(auditDoc).toMatchObject({
      actorPuid: 'PUID-INSTR-0001',
      action: 'question.transition',
      targetType: 'question',
      targetId: questionId,
      courseId,
      detail: { from: 'pending-review', to: 'approved' },
    });
  });

  it('rejects draft -> approved without writing anything', async () => {
    questionsFindOne.mockResolvedValue({ _id: questionId, state: 'draft' });

    await expect(transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001')).rejects.toThrow(
      'invalid-transition:draft->approved',
    );
    expect(questionsUpdateOne).not.toHaveBeenCalled();
    expect(auditInsertOne).not.toHaveBeenCalled();
  });
});

// --- bulkTransition -----------------------------------------------------------

describe('bulkTransition (IN-Q07)', () => {
  it('returns the count of questions whose transition was valid, skipping invalid ones', async () => {
    const validId = new ObjectId();
    const invalidId = new ObjectId();
    questionsFindOne.mockImplementation(async ({ _id }: { _id: ObjectId }) => {
      if (_id.equals(validId)) return { _id: validId, state: 'pending-review' };
      return { _id: invalidId, state: 'draft' };
    });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true });
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    const count = await bulkTransition([validId, invalidId], 'approved', 'PUID-INSTR-0001');

    expect(count).toBe(1);
    expect(questionsUpdateOne).toHaveBeenCalledTimes(1);
  });
});
