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
  addQuestionInternalNote,
  transitionQuestion,
  bulkTransition,
} from '../../server/src/services/questions.service';
import { shuffleOptions } from '../../server/src/services/option-order.service';
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
    expect(headDoc.templateFamilyId).toEqual(result.questionId);

    const [versionDoc] = versionsInsertOne.mock.calls[0];
    expect(versionDoc.version).toBe(1);
    expect(versionDoc.questionId).toEqual(result.questionId);
    expect(versionDoc.sourceRefs).toEqual([]);
    expect(versionDoc.provenance).toEqual({ kind: 'manual' });
    expect(result.version.options).toHaveLength(4);
  });

  it('stores a migration generateScript on version 1 without publishing the question', async () => {
    const generateScript =
      'function generate(random){ return { vars: { principal: 1000, rate: 5 } }; }';

    await createQuestion(baseInput({ generateScript }));

    const [headDoc] = questionsInsertOne.mock.calls[0];
    const [versionDoc] = versionsInsertOne.mock.calls[0];
    expect(headDoc.state).toBe('draft');
    expect(versionDoc.generateScript).toBe(generateScript);
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

// --- shuffleOptions ---------------------------------------------------------

// The fixtures label every field with the option's ORIGINAL key ('Option A',
// 'Why A'), so after a shuffle the text is what identifies an option and the
// key is what moved. That is what makes set-preservation assertable at all.
function identity(options: QuestionOption[]): Array<[string, string, string]> {
  return options.map((o) => [o.text, o.role, o.explanation] as [string, string, string]).sort();
}

describe('shuffleOptions', () => {
  it('preserves the option set exactly — only the keys move', () => {
    const original = mcqOptions();

    const shuffled = shuffleOptions(original, 12345);

    expect(identity(shuffled)).toEqual(identity(original));
    expect(shuffled).toHaveLength(4);
  });

  it('relabels keys A,B,C,D by new position so the list still reads in order', () => {
    const shuffled = shuffleOptions(mcqOptions(), 12345);

    expect(shuffled.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('moves the correct role off key A for at least one seed', () => {
    // The whole point of the task: position must stop predicting correctness.
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

    const correctKeys = seeds.map((seed) => shuffleOptions(mcqOptions(), seed).find((o) => o.role === 'correct')?.key);

    expect(correctKeys.some((key) => key !== 'A')).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    expect(shuffleOptions(mcqOptions(), 999)).toEqual(shuffleOptions(mcqOptions(), 999));
  });

  it('relabels from the option set\'s own keys, not a hardcoded A-D', () => {
    // An import may use another alphabet; it should keep it.
    const numbered = mcqOptions().map((o, index) => ({ ...o, key: String(index + 1) }));

    const shuffled = shuffleOptions(numbered, 4242);

    expect(shuffled.map((o) => o.key)).toEqual(['1', '2', '3', '4']);
  });
});

describe('createQuestion option shuffling', () => {
  it('does not leave the correct answer pinned to key A across many questions', async () => {
    // Loose bounds on purpose. The seed is drawn per call (drawSeed), so this is
    // a real random sample: expected count at 'A' is 25/100, sd ~4.3, and each
    // key is missed entirely with probability (3/4)^100 ~ 3e-13. Tight bounds
    // here would flake; these will not.
    const correctKeys: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const result = await createQuestion(baseInput());
      correctKeys.push(result.version.options.find((o) => o.role === 'correct')!.key);
    }

    expect(new Set(correctKeys)).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(correctKeys.filter((key) => key === 'A').length).toBeLessThan(50);
  });

  it('carries text, role and explanation together so the shuffle cannot change the answer', async () => {
    const input = baseInput();

    const result = await createQuestion(input);

    expect(identity(result.version.options)).toEqual(identity(input.options));
    // 'Option A' is the correct one in the fixture, wherever it landed.
    expect(result.version.options.find((o) => o.role === 'correct')?.text).toBe('Option A');
  });

  it('stores the given order when the caller says it already shuffled', async () => {
    // The generation pipeline shuffles upstream of its validator/reviewer,
    // whose prose names the resulting letters — a second shuffle here would
    // reassign every key after that prose was written.
    const input = baseInput({ optionsAlreadyShuffled: true });

    const result = await createQuestion(input);

    expect(result.version.options).toEqual(input.options);
  });

  it('leaves true-false as T then F', async () => {
    const result = await createQuestion(baseInput({ type: 'true-false', options: tfOptions() }));

    expect(result.version.options.map((o) => o.key)).toEqual(['T', 'F']);
    expect(result.version.options[0].text).toBe('True');
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
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
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
    // Copy-fidelity: the append-only copy must carry every other unpatched
    // field forward, not just options/difficulty — questionId is load-bearing
    // (drop it and every version after v1 orphans, silently breaking the
    // {questionId, version} unique index) and type/sourceRefs are the rest of
    // the content surface.
    expect(versionDoc.questionId).toEqual(currentVersion.questionId);
    expect(versionDoc.type).toBe(currentVersion.type);
    expect(versionDoc.sourceRefs).toEqual(currentVersion.sourceRefs);
    expect(result.version).toBe(2);
  });

  it('stores an options patch in the order it was given — an edit is never reshuffled', async () => {
    // Only createQuestion shuffles. An edit is a human stating the order they
    // want, and every question has already been shuffled once on the way in.
    const reordered = [mcqOptions()[2], mcqOptions()[0], mcqOptions()[3], mcqOptions()[1]];

    await editQuestion(questionId, { options: reordered }, 'PUID-INSTR-0002');

    const [versionDoc] = versionsInsertOne.mock.calls[0];
    expect(versionDoc.options).toEqual(reordered);
  });

  it('versions a generateScript-only patch (Task 5, IN-Q09), mirroring the paramSlots content-key pattern', async () => {
    const result = await editQuestion(
      questionId,
      { generateScript: 'function generate(random){ return { vars: { rate: 5 } }; }' },
      'PUID-INSTR-0002',
    );

    const [versionDoc] = versionsInsertOne.mock.calls[0];
    expect(versionDoc.generateScript).toBe('function generate(random){ return { vars: { rate: 5 } }; }');
    expect(versionDoc.editedFields).toEqual(['generateScript']);
    expect(versionDoc.stem).toBe(currentVersion.stem); // copied, unpatched
    expect(result.version).toBe(2);
  });

  it('updates the head currentVersionId/currentVersion and adds manually-edited exactly once', async () => {
    const insertedVersionId = new ObjectId();
    versionsInsertOne.mockResolvedValue({ acknowledged: true, insertedId: insertedVersionId });

    const result = await editQuestion(questionId, { stem: 'Updated stem' }, 'PUID-INSTR-0002');

    expect(questionsUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = questionsUpdateOne.mock.calls[0];
    expect(filter).toEqual({ _id: questionId });
    expect(update.$set.currentVersionId).toEqual(insertedVersionId);
    expect(update.$set.currentVersion).toBe(2);
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(update.$addToSet).toEqual({ labels: 'manually-edited' });
    // The version's createdAt and the head's updatedAt must be the same value.
    expect(result.createdAt).toEqual(update.$set.updatedAt);
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
    const newLoIds = [new ObjectId()];
    const result = await editQuestion(questionId, { difficulty: 'hard', loIds: newLoIds }, 'PUID-INSTR-0002');

    expect(result.editedFields).toEqual(['difficulty']);
    const [, update] = questionsUpdateOne.mock.calls[0];
    expect(update.$set.loIds).toEqual(newLoIds);
  });

  it('coerces a true-false incorrect option role to common-misconception on the edit path', async () => {
    const tfCurrent: WithId<QuestionVersion> = { ...currentVersion, type: 'true-false', options: tfOptions() };
    versionsFindOne.mockResolvedValue(tfCurrent);

    const result = await editQuestion(
      questionId,
      { options: tfOptions({ F: 'clearly-wrong' }) },
      'PUID-INSTR-0002',
    );

    expect(result.options.find((o) => o.key === 'T')?.role).toBe('correct');
    expect(result.options.find((o) => o.key === 'F')?.role).toBe('common-misconception');
  });

  // --- tagging-only patches (IN-Q13) — human decision, review finding #2 ---
  // A patch with no content key must not version, must not label, and must
  // update only the head's tags.
  describe('tagging-only patches do not version or label', () => {
    it('a loIds-only patch updates the head loIds, inserts no version, adds no label, returns the current version unchanged', async () => {
      const newLoIds = [new ObjectId()];

      const result = await editQuestion(questionId, { loIds: newLoIds }, 'PUID-INSTR-0002');

      expect(versionsInsertOne).not.toHaveBeenCalled();
      expect(result).toEqual(currentVersion);

      expect(questionsUpdateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = questionsUpdateOne.mock.calls[0];
      expect(filter).toEqual({ _id: questionId });
      expect(update.$set.loIds).toEqual(newLoIds);
      expect(update.$set.updatedAt).toBeInstanceOf(Date);
      expect(update.$set.currentVersionId).toBeUndefined();
      expect(update.$set.currentVersion).toBeUndefined();
      expect(update.$addToSet).toBeUndefined();
    });

    it('an empty patch inserts no version, adds no label, and issues no head write', async () => {
      const result = await editQuestion(questionId, {}, 'PUID-INSTR-0002');

      expect(versionsInsertOne).not.toHaveBeenCalled();
      expect(result).toEqual(currentVersion);

      expect(questionsUpdateOne).not.toHaveBeenCalled();
    });

    it('a content+tags patch still versions and labels (unchanged from today)', async () => {
      const newLoIds = [new ObjectId()];

      const result = await editQuestion(questionId, { difficulty: 'hard', loIds: newLoIds }, 'PUID-INSTR-0002');

      expect(versionsInsertOne).toHaveBeenCalledTimes(1);
      expect(result.version).toBe(2);
      expect(result.editedFields).toEqual(['difficulty']);
      expect(result.provenance).toEqual({ kind: 'edited', parentVersionId: versionId });

      const [, update] = questionsUpdateOne.mock.calls[0];
      expect(update.$set.loIds).toEqual(newLoIds);
      expect(update.$set.currentVersion).toBe(2);
      expect(update.$addToSet).toEqual({ labels: 'manually-edited' });
    });
  });
});

// --- transitionQuestion ------------------------------------------------------

describe('transitionQuestion (IN-Q07)', () => {
  const questionId = new ObjectId();

  it('allows pending-review -> approved and writes an audit log entry', async () => {
    const courseId = new ObjectId();
    questionsFindOne.mockResolvedValue({ _id: questionId, courseId, state: 'pending-review' });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    const result = await transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001');

    expect(result.state).toBe('approved');
    const [filter, update] = questionsUpdateOne.mock.calls[0];
    expect(filter).toEqual({ _id: questionId, state: 'pending-review' });
    expect(update.$set.state).toBe('approved');
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    // The returned Question must carry the SAME updatedAt that was written to
    // the DB, not the stale pre-update value from the findOne'd doc.
    expect(result.updatedAt).toEqual(update.$set.updatedAt);

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
    expect(auditDoc.createdAt).toEqual(update.$set.updatedAt);
  });

  it('allows one-click draft -> approved for an instructor', async () => {
    const courseId = new ObjectId();
    questionsFindOne.mockResolvedValue({ _id: questionId, courseId, state: 'draft' });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });

    await expect(transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001')).resolves.toMatchObject({
      state: 'approved',
    });
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, state: 'draft' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'approved' }) }),
    );
    expect(auditInsertOne).toHaveBeenCalledTimes(1);
  });

  it('compare-and-sets the reviewed currentVersionId when the caller supplies one', async () => {
    const courseId = new ObjectId();
    const expectedVersionId = new ObjectId();
    questionsFindOne.mockResolvedValue({
      _id: questionId,
      courseId,
      currentVersionId: expectedVersionId,
      state: 'draft',
    });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });

    await expect(
      transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001', expectedVersionId),
    ).resolves.toMatchObject({ state: 'approved', currentVersionId: expectedVersionId });

    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, state: 'draft', currentVersionId: expectedVersionId },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'approved' }) }),
    );
    expect(auditInsertOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale reviewed version before changing state or writing an audit', async () => {
    const currentVersionId = new ObjectId();
    const staleVersionId = new ObjectId();
    questionsFindOne.mockResolvedValue({
      _id: questionId,
      courseId: new ObjectId(),
      currentVersionId,
      state: 'draft',
    });

    await expect(
      transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001', staleVersionId),
    ).rejects.toThrow('question-conflict');

    expect(questionsUpdateOne).not.toHaveBeenCalled();
    expect(auditInsertOne).not.toHaveBeenCalled();
  });

  it('rejects an edit that races after the reviewed-version check', async () => {
    const expectedVersionId = new ObjectId();
    questionsFindOne.mockResolvedValue({
      _id: questionId,
      courseId: new ObjectId(),
      currentVersionId: expectedVersionId,
      state: 'draft',
    });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });

    await expect(
      transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001', expectedVersionId),
    ).rejects.toThrow('question-conflict');

    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, state: 'draft', currentVersionId: expectedVersionId },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'approved' }) }),
    );
    expect(auditInsertOne).not.toHaveBeenCalled();
  });

  it('rejects a stale concurrent transition without writing a contradictory audit', async () => {
    questionsFindOne.mockResolvedValue({
      _id: questionId,
      courseId: new ObjectId(),
      state: 'pending-review',
    });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });

    await expect(transitionQuestion(questionId, 'approved', 'PUID-INSTR-0001')).rejects.toThrow(
      'question-conflict',
    );

    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId, state: 'pending-review' },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'approved' }) }),
    );
    expect(auditInsertOne).not.toHaveBeenCalled();
  });

  it('allows only one of two reviewers that read the same state to transition and audit', async () => {
    const courseId = new ObjectId();
    questionsFindOne.mockResolvedValue({ _id: questionId, courseId, state: 'pending-review' });
    questionsUpdateOne
      .mockResolvedValueOnce({ acknowledged: true, matchedCount: 1 })
      .mockResolvedValueOnce({ acknowledged: true, matchedCount: 0 });
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    await expect(transitionQuestion(questionId, 'approved', 'PUID-ONE')).resolves.toMatchObject({
      state: 'approved',
    });
    await expect(transitionQuestion(questionId, 'approved', 'PUID-TWO')).rejects.toThrow('question-conflict');

    expect(auditInsertOne).toHaveBeenCalledTimes(1);
    expect(auditInsertOne.mock.calls[0][0].actorPuid).toBe('PUID-ONE');
  });
});

describe('addQuestionInternalNote', () => {
  it('trims and appends a teaching-team-only note with an audit entry', async () => {
    const questionId = new ObjectId();
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });

    const note = await addQuestionInternalNote(questionId, '  Needs another example.  ', 'PUID-INSTR-0001');

    expect(note).toMatchObject({ puid: 'PUID-INSTR-0001', text: 'Needs another example.' });
    expect(note.at).toBeInstanceOf(Date);
    expect(questionsUpdateOne).toHaveBeenCalledWith(
      { _id: questionId },
      {
        $push: { internalNotes: note },
        $set: { updatedAt: note.at },
      },
    );
    expect(auditInsertOne).toHaveBeenCalledWith(expect.objectContaining({
      action: 'question.internal-note.add',
      targetId: questionId,
    }));
  });

  it('rejects blank notes without writing', async () => {
    await expect(addQuestionInternalNote(new ObjectId(), '   ', 'PUID-INSTR-0001'))
      .rejects.toThrow('internal-note-required');
    expect(questionsUpdateOne).not.toHaveBeenCalled();
  });
});

// --- bulkTransition -----------------------------------------------------------

describe('bulkTransition (IN-Q07)', () => {
  it('returns the count of questions whose transition was valid, skipping invalid ones', async () => {
    const validId = new ObjectId();
    const invalidId = new ObjectId();
    questionsFindOne.mockImplementation(async ({ _id }: { _id: ObjectId }) => {
      if (_id.equals(validId)) return { _id: validId, state: 'pending-review' };
      return { _id: invalidId, state: 'archived' };
    });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    const count = await bulkTransition([validId, invalidId], 'approved', 'PUID-INSTR-0001');

    expect(count).toBe(1);
    expect(questionsUpdateOne).toHaveBeenCalledTimes(1);
  });

  it('skips a missing question (question-not-found) without writing an audit entry for it', async () => {
    const validId = new ObjectId();
    const missingId = new ObjectId();
    questionsFindOne.mockImplementation(async ({ _id }: { _id: ObjectId }) => {
      if (_id.equals(validId)) return { _id: validId, state: 'pending-review' };
      return null;
    });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    const count = await bulkTransition([validId, missingId], 'approved', 'PUID-INSTR-0001');

    expect(count).toBe(1);
    // Skipped questions must produce no audit noise — exactly one insert, for
    // the one question that actually transitioned.
    expect(auditInsertOne).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-domain error (e.g. Mongo unreachable) instead of counting it as a skip', async () => {
    const validId = new ObjectId();
    const brokenId = new ObjectId();
    questionsFindOne.mockImplementation(async ({ _id }: { _id: ObjectId }) => {
      if (_id.equals(validId)) return { _id: validId, state: 'pending-review' };
      throw new Error('connection timed out');
    });
    questionsUpdateOne.mockResolvedValue({ acknowledged: true });
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    await expect(bulkTransition([validId, brokenId], 'approved', 'PUID-INSTR-0001')).rejects.toThrow(
      'connection timed out',
    );
  });

  it('skips an item whose expected state changed concurrently', async () => {
    const successfulId = new ObjectId();
    const conflictedId = new ObjectId();
    questionsFindOne.mockImplementation(async ({ _id }: { _id: ObjectId }) => ({
      _id,
      courseId: new ObjectId(),
      state: 'pending-review',
    }));
    questionsUpdateOne.mockImplementation(async ({ _id }: { _id: ObjectId }) => ({
      acknowledged: true,
      matchedCount: _id.equals(successfulId) ? 1 : 0,
    }));
    auditInsertOne.mockResolvedValue({ acknowledged: true });

    const count = await bulkTransition([successfulId, conflictedId], 'approved', 'PUID-INSTR-0001');

    expect(count).toBe(1);
    expect(auditInsertOne).toHaveBeenCalledTimes(1);
  });
});
