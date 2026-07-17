import type { WithId } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Question, QuestionVersion, Theme, LearningObjective, Difficulty, PublicationState } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
}));

jest.mock('../../server/src/services/mastery.service', () => ({
  getMasteryTier: jest.fn(),
  getLoStatuses: jest.fn(),
}));

import { questionsCol, questionVersionsCol, themesCol, losCol } from '../../server/src/components/mongodb/collections';
import { getMasteryTier, getLoStatuses } from '../../server/src/services/mastery.service';
import { selectNextQuestion, selectRetryQuestion, studentCourseHome } from '../../server/src/services/serving.service';

// -----------------------------------------------------------------------------
// Fake collections. `serving.service.ts` fetches its candidate list once per
// call via find().toArray() (and _id $in for the version join) plus, for
// studentCourseHome, countDocuments() — a plain array-backed fake covers all
// of that without needing a real Mongo driver surface. `getMasteryTier` /
// `getLoStatuses` (Task 9) are mocked directly rather than faked through
// masteryCol(), since serving.service only ever calls them as a black box.
// -----------------------------------------------------------------------------

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
      const ops = expected as Record<string, unknown>;
      if ('$exists' in ops) {
        const wantExists = ops.$exists as boolean;
        return wantExists ? key in doc : !(key in doc);
      }
      if ('$in' in ops) {
        const candidates = ops.$in as unknown[];
        return candidates.some((c) => valuesEqual(c, actual));
      }
      if ('$ne' in ops) {
        return !valuesEqual(ops.$ne, actual);
      }
      if ('$nin' in ops) {
        const candidates = ops.$nin as unknown[];
        return !candidates.some((c) => valuesEqual(c, actual));
      }
    }
    if (Array.isArray(actual)) {
      return actual.some((item) => valuesEqual(item, expected));
    }
    return valuesEqual(actual, expected);
  });
}

function makeFindableFake(docs: Record<string, unknown>[]) {
  return {
    docs,
    find: jest.fn((filter: Record<string, unknown>) => ({
      toArray: async () => docs.filter((d) => matchesFilter(d, filter)),
    })),
    countDocuments: jest.fn(async (filter: Record<string, unknown>) => docs.filter((d) => matchesFilter(d, filter)).length),
  };
}

// --- Fixtures -----------------------------------------------------------------

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
const puid = 'PUID-STUDENT-0001';

interface BankSpec {
  id?: ObjectId;
  difficulty: Difficulty;
  state: PublicationState;
  loIds: ObjectId[];
}

/** Seeded bank builder (core doc, Task 10 Step 1): each spec becomes a
 * Question head + its v1 QuestionVersion, wired together like the real
 * questions.service.ts createQuestion() does. */
function bank(specs: BankSpec[]): { questions: WithId<Question>[]; versions: WithId<QuestionVersion>[] } {
  const questions: WithId<Question>[] = [];
  const versions: WithId<QuestionVersion>[] = [];
  for (const spec of specs) {
    const questionId = spec.id ?? new ObjectId();
    const versionId = new ObjectId();
    questions.push({
      _id: questionId,
      courseId,
      currentVersionId: versionId,
      currentVersion: 1,
      state: spec.state,
      loIds: spec.loIds,
      themeIds: [themeId],
      labels: [],
      internalNotes: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    versions.push({
      _id: versionId,
      questionId,
      version: 1,
      type: 'mcq',
      stem: `stem-${questionId.toHexString()}`,
      options: [],
      difficulty: spec.difficulty,
      sourceRefs: [],
      createdBy: 'seed',
      createdAt: new Date(),
    });
  }
  return { questions, versions };
}

function seedBank(specs: BankSpec[]): void {
  const { questions, versions } = bank(specs);
  jest.mocked(questionsCol).mockReturnValue(makeFindableFake(questions as unknown as Record<string, unknown>[]) as never);
  jest.mocked(questionVersionsCol).mockReturnValue(makeFindableFake(versions as unknown as Record<string, unknown>[]) as never);
}

beforeEach(() => {
  jest.mocked(getMasteryTier).mockReset();
  jest.mocked(getLoStatuses).mockReset();
});

// A rand() that always picks the first element of whatever pool is passed to
// Math.floor(rand() * n) — pins the "random within pool" choice so ladder
// tests are deterministic.
const firstPick = () => 0;

describe('selectNextQuestion', () => {
  it('case 1: approved-only filter — a bank of drafts/pending/paused returns null', async () => {
    seedBank([
      { difficulty: 'easy', state: 'draft', loIds: [loId] },
      { difficulty: 'medium', state: 'pending-review', loIds: [loId] },
      { difficulty: 'hard', state: 'paused', loIds: [loId] },
    ]);
    jest.mocked(getMasteryTier).mockResolvedValue('easy');

    const result = await selectNextQuestion({ puid, courseId, loId, sessionServedIds: [] }, firstPick);
    expect(result).toBeNull();
  });

  it('case 2: excludes sessionServedIds when unseen same-tier questions exist', async () => {
    const served = new ObjectId();
    const unseen = new ObjectId();
    seedBank([
      { id: served, difficulty: 'easy', state: 'approved', loIds: [loId] },
      { id: unseen, difficulty: 'easy', state: 'approved', loIds: [loId] },
    ]);
    jest.mocked(getMasteryTier).mockResolvedValue('easy');

    const result = await selectNextQuestion({ puid, courseId, loId, sessionServedIds: [served] }, firstPick);
    expect(result).not.toBeNull();
    expect(result!.question._id.equals(unseen)).toBe(true);
    expect(result!.degraded).toBe('none');
  });

  it('case 3: targets the mastery tier — a medium question wins over easy/hard', async () => {
    const easyId = new ObjectId();
    const mediumId = new ObjectId();
    const hardId = new ObjectId();
    seedBank([
      { id: easyId, difficulty: 'easy', state: 'approved', loIds: [loId] },
      { id: mediumId, difficulty: 'medium', state: 'approved', loIds: [loId] },
      { id: hardId, difficulty: 'hard', state: 'approved', loIds: [loId] },
    ]);
    jest.mocked(getMasteryTier).mockResolvedValue('medium');

    const result = await selectNextQuestion({ puid, courseId, loId, sessionServedIds: [] }, firstPick);
    expect(result!.question._id.equals(mediumId)).toBe(true);
    expect(result!.degraded).toBe('none');
  });

  it('case 4: ladder rung 1 — all same-tier questions served -> repeats one (degraded: repeat)', async () => {
    const servedA = new ObjectId();
    const servedB = new ObjectId();
    seedBank([
      { id: servedA, difficulty: 'medium', state: 'approved', loIds: [loId] },
      { id: servedB, difficulty: 'medium', state: 'approved', loIds: [loId] },
    ]);
    jest.mocked(getMasteryTier).mockResolvedValue('medium');

    const result = await selectNextQuestion({ puid, courseId, loId, sessionServedIds: [servedA, servedB] }, firstPick);
    expect(result).not.toBeNull();
    expect([servedA.toString(), servedB.toString()]).toContain(result!.question._id.toString());
    expect(result!.degraded).toBe('repeat');
  });

  it('case 5: ladder rung 2 — no same-tier at all -> adjacent difficulty unseen (degraded: adjacent)', async () => {
    const easyId = new ObjectId();
    const hardId = new ObjectId();
    seedBank([
      { id: easyId, difficulty: 'easy', state: 'approved', loIds: [loId] },
      { id: hardId, difficulty: 'hard', state: 'approved', loIds: [loId] },
    ]);
    jest.mocked(getMasteryTier).mockResolvedValue('medium');

    const result = await selectNextQuestion({ puid, courseId, loId, sessionServedIds: [] }, firstPick);
    expect(result).not.toBeNull();
    // Both easy and hard are adjacent to medium; either is a valid pick.
    expect([easyId.toString(), hardId.toString()]).toContain(result!.question._id.toString());
    expect(result!.degraded).toBe('adjacent');
  });

  it('case 6: ladder rung 3 — only an off-tier already-served question exists -> serves it (degraded: any)', async () => {
    const hardServed = new ObjectId();
    seedBank([{ id: hardServed, difficulty: 'hard', state: 'approved', loIds: [loId] }]);
    jest.mocked(getMasteryTier).mockResolvedValue('easy');

    const result = await selectNextQuestion({ puid, courseId, loId, sessionServedIds: [hardServed] }, firstPick);
    expect(result).not.toBeNull();
    expect(result!.question._id.equals(hardServed)).toBe(true);
    expect(result!.degraded).toBe('any');
  });

  it('case 7: zero approved for the LO -> null', async () => {
    seedBank([]);
    jest.mocked(getMasteryTier).mockResolvedValue('easy');

    const result = await selectNextQuestion({ puid, courseId, loId, sessionServedIds: [] }, firstPick);
    expect(result).toBeNull();
  });
});

describe('selectRetryQuestion', () => {
  it('case 8: never returns the excluded questionId; returns null when the LO has only that one question', async () => {
    const onlyQuestion = new ObjectId();
    const other = new ObjectId();

    // Sub-case: only the excluded question exists for the LO -> null.
    seedBank([{ id: onlyQuestion, difficulty: 'easy', state: 'approved', loIds: [loId] }]);
    jest.mocked(getMasteryTier).mockResolvedValue('easy');
    const nullResult = await selectRetryQuestion(
      { puid, courseId, loId, excludeQuestionId: onlyQuestion, sessionServedIds: [] },
      firstPick,
    );
    expect(nullResult).toBeNull();

    // Sub-case: a second question exists -> it is returned, never the excluded one.
    seedBank([
      { id: onlyQuestion, difficulty: 'easy', state: 'approved', loIds: [loId] },
      { id: other, difficulty: 'easy', state: 'approved', loIds: [loId] },
    ]);
    const result = await selectRetryQuestion(
      { puid, courseId, loId, excludeQuestionId: onlyQuestion, sessionServedIds: [] },
      firstPick,
    );
    expect(result).not.toBeNull();
    expect(result!.question._id.equals(other)).toBe(true);
    expect(result!.question._id.equals(onlyQuestion)).toBe(false);
  });
});

describe('studentCourseHome', () => {
  it('case 9: hides a theme whose availableFrom is tomorrow, and an LO with 0 approved questions', async () => {
    const availableTheme: WithId<Theme> = {
      _id: themeId,
      courseId,
      name: 'Available Theme',
      order: 1,
    };
    const futureThemeId = new ObjectId();
    const futureTheme: WithId<Theme> = {
      _id: futureThemeId,
      courseId,
      name: 'Future Theme',
      order: 2,
      availableFrom: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
    };

    const coveredLoId = new ObjectId();
    const uncoveredLoId = new ObjectId();
    const coveredLo: WithId<LearningObjective> = {
      _id: coveredLoId,
      courseId,
      themeId,
      name: 'Covered LO',
      order: 1,
    };
    const uncoveredLo: WithId<LearningObjective> = {
      _id: uncoveredLoId,
      courseId,
      themeId,
      name: 'Uncovered LO',
      order: 2,
    };
    const futureLo: WithId<LearningObjective> = {
      _id: new ObjectId(),
      courseId,
      themeId: futureThemeId,
      name: 'Future LO',
      order: 1,
    };

    jest.mocked(themesCol).mockReturnValue(
      makeFindableFake([availableTheme, futureTheme] as unknown as Record<string, unknown>[]) as never,
    );
    jest.mocked(losCol).mockReturnValue(
      makeFindableFake([coveredLo, uncoveredLo, futureLo] as unknown as Record<string, unknown>[]) as never,
    );
    seedBank([{ difficulty: 'easy', state: 'approved', loIds: [coveredLoId] }]);
    jest.mocked(getLoStatuses).mockResolvedValue(new Map([[coveredLoId.toHexString(), 'in-progress']]));

    const result = await studentCourseHome(puid, courseId);

    expect(result).toHaveLength(1);
    expect(result[0].theme._id.equals(themeId)).toBe(true);
    expect(result[0].los).toHaveLength(1);
    expect(result[0].los[0].lo._id.equals(coveredLoId)).toBe(true);
    expect(result[0].los[0].status).toBe('in-progress');
    expect(result[0].los[0].approvedCount).toBe(1);
  });
});
