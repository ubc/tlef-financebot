import { ObjectId } from 'mongodb';
import type { PublicationState, Difficulty, User, QuestionOption } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
  coursesCol: jest.fn(),
  reviewBookCol: jest.fn(),
  attemptsCol: jest.fn(),
}));

jest.mock('../../server/src/services/mastery.service', () => ({
  getMasteryTier: jest.fn(),
  getLoStatuses: jest.fn(),
  recordAttemptInMastery: jest.fn(),
  themeCoverage: jest.fn(),
}));

jest.mock('../../server/src/services/progression.service', () => ({
  repeatedFailureRedirect: jest.fn(),
}));

import {
  questionsCol,
  questionVersionsCol,
  coursesCol,
  reviewBookCol,
  attemptsCol,
  losCol,
} from '../../server/src/components/mongodb/collections';
import { getMasteryTier, getLoStatuses, themeCoverage, recordAttemptInMastery } from '../../server/src/services/mastery.service';
import { repeatedFailureRedirect } from '../../server/src/services/progression.service';
import { selectNextQuestion } from '../../server/src/services/serving.service';
import { submitAttempt } from '../../server/src/services/attempts.service';

// -----------------------------------------------------------------------------
// Phase 1 Task 16 Step 1 — the Approved-only serving proof.
//
// This is the phase exit's safety artifact, and it is deliberately narrow: the
// ONE property it pins is that no question outside `state: 'approved'` can ever
// reach a student, on either the read path (selectNextQuestion) or the write
// path (submitAttempt). PRD §9.1 / the Phase 1 global constraint state it as an
// absolute — "No fallback to unreviewed content, ever."
//
// Other suites cover adjacent behaviour (serving.service.test.ts drives the
// degradation ladder, attempts.service.test.ts drives grading and the Review
// Book). Neither seeds all six publication states at once, and neither
// exercises selection repeatedly enough for a random tie-break to expose a
// leak — which is exactly what Task 16 asked for.
//
// Fakes follow serving.service.test.ts's array-backed collection harness: the
// services under test only need find().toArray() and findOne(), plus insert
// stubs on the write path.
// -----------------------------------------------------------------------------

const ALL_STATES: PublicationState[] = [
  'draft',
  'pending-review',
  'reviewed',
  'approved',
  'paused',
  'archived',
];

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === 'object' && !(expected instanceof ObjectId)) {
      const ops = expected as Record<string, unknown>;
      if ('$in' in ops) return (ops.$in as unknown[]).some((c) => valuesEqual(c, actual));
      if ('$ne' in ops) return !valuesEqual(ops.$ne, actual);
    }
    if (Array.isArray(actual)) return actual.some((item) => valuesEqual(item, expected));
    return valuesEqual(actual, expected);
  });
}

function makeFake(docs: Record<string, unknown>[]) {
  return {
    docs,
    find: jest.fn((filter: Record<string, unknown>) => ({
      toArray: async () => docs.filter((d) => matchesFilter(d, filter)),
    })),
    findOne: jest.fn(async (filter: Record<string, unknown>) => docs.find((d) => matchesFilter(d, filter)) ?? null),
    countDocuments: jest.fn(async (filter: Record<string, unknown>) => docs.filter((d) => matchesFilter(d, filter)).length),
  };
}

// --- Fixtures ----------------------------------------------------------------

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
const puid = 'PUID-STUDENT-0001';

const OPTIONS: QuestionOption[] = [
  { key: 'A', text: 'Correct', role: 'correct', explanation: 'Right.' },
  { key: 'B', text: 'Misconception', role: 'common-misconception', explanation: 'Common slip.' },
  { key: 'C', text: 'Partial', role: 'partially-correct', explanation: 'Halfway.' },
  { key: 'D', text: 'Wrong', role: 'clearly-wrong', explanation: 'No.' },
];

const student = { puid, displayName: 'Jane Student', courseRoles: [{ courseId, role: 'student' }] } as unknown as User;

/** One question head + its current version per publication state, all in the
 * same course and LO and all at the same difficulty — so `state` is the ONLY
 * thing that can distinguish them, and any leak is unambiguous. */
function seedAllStates(difficulty: Difficulty = 'easy'): {
  questions: Record<string, unknown>[];
  versions: Record<string, unknown>[];
  byState: Map<PublicationState, { questionId: ObjectId; versionId: ObjectId }>;
} {
  const questions: Record<string, unknown>[] = [];
  const versions: Record<string, unknown>[] = [];
  const byState = new Map<PublicationState, { questionId: ObjectId; versionId: ObjectId }>();

  for (const state of ALL_STATES) {
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    questions.push({
      _id: questionId,
      courseId,
      loIds: [loId],
      themeIds: [themeId],
      state,
      currentVersionId: versionId,
      type: 'mcq',
    });
    versions.push({
      _id: versionId,
      questionId,
      version: 1,
      stem: `Stem for the ${state} question`,
      options: OPTIONS,
      difficulty,
    });
    byState.set(state, { questionId, versionId });
  }
  return { questions, versions, byState };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getMasteryTier).mockResolvedValue('easy');
  jest.mocked(getLoStatuses).mockResolvedValue(new Map());
  jest.mocked(themeCoverage).mockResolvedValue({ covered: false, includesSkipped: false });
  jest.mocked(repeatedFailureRedirect).mockResolvedValue(undefined);
  // attempts.service reads `profile.status` off this return (line 242/317), so
  // it must be a real profile shape — a bare jest.fn() returning undefined
  // would make the approved-head control below fail for a fixture reason
  // rather than a behavioural one.
  jest.mocked(recordAttemptInMastery).mockResolvedValue({
    puid,
    courseId,
    loId,
    status: 'in-progress',
    attemptCount: 1,
    windowAccuracy: 1,
    windowRoles: {},
    currentTier: 'easy',
    attemptsSinceEvaluation: 1,
    updatedAt: new Date(),
  } as never);
});

// -----------------------------------------------------------------------------

describe('Approved-only serving proof (PRD §9.1, Phase 1 Task 16)', () => {
  describe('read path — selectNextQuestion', () => {
    it('only ever selects the approved question, across 50 randomized runs', async () => {
      const { questions, versions, byState } = seedAllStates();
      jest.mocked(questionsCol).mockReturnValue(makeFake(questions) as never);
      jest.mocked(questionVersionsCol).mockReturnValue(makeFake(versions) as never);

      const approved = byState.get('approved')!;
      const seen = new Set<string>();

      for (let run = 0; run < 50; run += 1) {
        // A fresh pseudo-random stream per run, spanning [0,1), so any
        // tie-break or shuffle inside the ladder is genuinely exercised rather
        // than pinned to one branch by a constant.
        const rand = (): number => (run * 0.019 + Math.random()) % 1;
        const result = await selectNextQuestion(
          { puid, courseId, loId, sessionServedIds: [] },
          rand,
        );

        expect(result).not.toBeNull();
        seen.add(result!.question._id.toString());
        expect(result!.question.state).toBe('approved');
      }

      // Exactly one distinct question was ever served: the approved one.
      expect([...seen]).toEqual([approved.questionId.toString()]);
    });

    it('returns null rather than degrading to unreviewed content when nothing is approved', async () => {
      const { questions, versions, byState } = seedAllStates();
      // Drop the approved head; every other state remains available.
      const approvedId = byState.get('approved')!.questionId;
      const withoutApproved = questions.filter((q) => !(q._id as ObjectId).equals(approvedId));
      expect(withoutApproved).toHaveLength(ALL_STATES.length - 1);

      jest.mocked(questionsCol).mockReturnValue(makeFake(withoutApproved) as never);
      jest.mocked(questionVersionsCol).mockReturnValue(makeFake(versions) as never);

      for (let run = 0; run < 50; run += 1) {
        const result = await selectNextQuestion(
          { puid, courseId, loId, sessionServedIds: [] },
          () => Math.random(),
        );
        expect(result).toBeNull();
      }
    });

    it('does not leak a non-approved question once the approved one is already served this session', async () => {
      // The finite-round ladder repeats an already-served Approved question
      // rather than reaching for unreviewed content — the degradation path is
      // where a "just show them something" fallback would most plausibly creep
      // in.
      const { questions, versions, byState } = seedAllStates();
      jest.mocked(questionsCol).mockReturnValue(makeFake(questions) as never);
      jest.mocked(questionVersionsCol).mockReturnValue(makeFake(versions) as never);

      const approved = byState.get('approved')!;
      const result = await selectNextQuestion(
        { puid, courseId, loId, sessionServedIds: [approved.questionId] },
        () => Math.random(),
      );

      if (result !== null) {
        expect(result.question.state).toBe('approved');
        expect(result.question._id.toString()).toBe(approved.questionId.toString());
      }
    });
  });

  describe('write path — submitAttempt', () => {
    const nonApproved = ALL_STATES.filter((s) => s !== 'approved');

    beforeEach(() => {
      jest.mocked(coursesCol).mockReturnValue(
        makeFake([{ _id: courseId, feedbackStrategy: 'b', name: 'Course' }]) as never,
      );
      jest.mocked(losCol).mockReturnValue(makeFake([{ _id: loId, courseId, themeId, name: 'LO' }]) as never);
      jest.mocked(reviewBookCol).mockReturnValue({
        findOne: jest.fn(async () => null),
        updateOne: jest.fn(async () => ({ acknowledged: true })),
      } as never);
      jest.mocked(attemptsCol).mockReturnValue({
        insertOne: jest.fn(async () => ({ acknowledged: true, insertedId: new ObjectId() })),
        find: jest.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })),
        countDocuments: jest.fn(async () => 0),
      } as never);
    });

    it.each(nonApproved)('throws question-not-servable when the head is %s', async (state) => {
      const { questions, versions, byState } = seedAllStates();
      jest.mocked(questionsCol).mockReturnValue(makeFake(questions) as never);
      jest.mocked(questionVersionsCol).mockReturnValue(makeFake(versions) as never);

      const target = byState.get(state)!;
      await expect(
        submitAttempt({
          user: student,
          questionVersionId: target.versionId,
          loId,
          mode: 'topic-practice',
          selectedKey: 'A',
          sessionServedIds: [],
        }),
      ).rejects.toThrow('question-not-servable');
    });

    it('throws question-not-servable when the version id does not resolve at all', async () => {
      const { questions, versions } = seedAllStates();
      jest.mocked(questionsCol).mockReturnValue(makeFake(questions) as never);
      jest.mocked(questionVersionsCol).mockReturnValue(makeFake(versions) as never);

      await expect(
        submitAttempt({
          user: student,
          questionVersionId: new ObjectId(),
          loId,
          mode: 'topic-practice',
          selectedKey: 'A',
          sessionServedIds: [],
        }),
      ).rejects.toThrow('question-not-servable');
    });

    it('records no attempt for any non-approved head — the write is refused, not merely unreported', async () => {
      const { questions, versions, byState } = seedAllStates();
      jest.mocked(questionsCol).mockReturnValue(makeFake(questions) as never);
      jest.mocked(questionVersionsCol).mockReturnValue(makeFake(versions) as never);

      const insertOne = jest.fn(async () => ({ acknowledged: true, insertedId: new ObjectId() }));
      jest.mocked(attemptsCol).mockReturnValue({
        insertOne,
        find: jest.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })),
        countDocuments: jest.fn(async () => 0),
      } as never);

      for (const state of nonApproved) {
        const target = byState.get(state)!;
        await expect(
          submitAttempt({
            user: student,
            questionVersionId: target.versionId,
            loId,
            mode: 'topic-practice',
            selectedKey: 'A',
            sessionServedIds: [],
          }),
        ).rejects.toThrow('question-not-servable');
      }

      expect(insertOne).not.toHaveBeenCalled();
    });

    it('accepts the approved head, proving the guard rejects on state and not on the fixture shape', async () => {
      // Without this, every rejection above could be passing for an unrelated
      // reason (a malformed fixture, a missing course) and the suite would
      // still be green while proving nothing.
      const { questions, versions, byState } = seedAllStates();
      jest.mocked(questionsCol).mockReturnValue(makeFake(questions) as never);
      jest.mocked(questionVersionsCol).mockReturnValue(makeFake(versions) as never);

      const approved = byState.get('approved')!;
      await expect(
        submitAttempt({
          user: student,
          questionVersionId: approved.versionId,
          loId,
          mode: 'topic-practice',
          selectedKey: 'A',
          sessionServedIds: [],
        }),
      ).resolves.toBeDefined();
    });
  });
});
