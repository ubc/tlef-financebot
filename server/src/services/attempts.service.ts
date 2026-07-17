import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { attemptsCol, questionsCol, questionVersionsCol, coursesCol, reviewBookCol } from '../components/mongodb/collections';
import { recordAttemptInMastery, getLoStatuses, themeCoverage } from './mastery.service';
import { selectRetryQuestion } from './serving.service';
import type {
  AppliedStrategy,
  AttemptRecord,
  FeedbackStrategy,
  MasteryStatus,
  OptionRole,
  PracticeMode,
  QuestionType,
  User,
} from '../types/domain';

// -----------------------------------------------------------------------------
// Attempts service (Task 11, ST-P04/ST-R01): attempt submission, the adaptive
// feedback truth table, the Strategy-A retry gate, and Review Book
// auto-collection. This is the one place a student's answer is graded — see
// server/src/services/AGENTS.md.
//
// `submitAttempt` calls Task 9's `recordAttemptInMastery` exactly once per
// call (its docstring requires "once per real attempt, in lockstep" — every
// retry is its own real attempt, submitted as its own `submitAttempt` call
// with `isRetry: true`, so this 1:1 mapping always holds; there is no
// separate "half weight" attempt path to reconcile).
// -----------------------------------------------------------------------------

/** Pure truth table (ST-P04): a locked course strategy applies regardless of
 * the selected option's role; only 'adaptive' looks at the role at all. */
export function decideStrategy(courseStrategy: FeedbackStrategy, selectedRole: OptionRole): AppliedStrategy {
  if (courseStrategy === 'strategy-a') return 'a';
  if (courseStrategy === 'strategy-b') return 'b';
  return selectedRole === 'common-misconception' ? 'a' : 'b';
}

export interface RevealedOption {
  key: string;
  text: string;
  role: OptionRole;
  explanation: string;
  correct: boolean;
}

export interface AttemptResult {
  correct: boolean;
  feedback: {
    strategy: AppliedStrategy;
    revealed: RevealedOption[];
    retry?: { questionId: string; questionVersionId: string; type: QuestionType; stem: string; options: Array<{ key: string; text: string }> };
  };
  mastery: { loStatus: MasteryStatus; recommendation?: 'advance-lo' | 'advance-theme' };
  reviewBook: { added: boolean };
}

export interface SubmitAttemptInput {
  user: User;
  questionVersionId: ObjectId;
  loId: ObjectId;
  mode: PracticeMode;
  selectedKey: string;
  sessionServedIds: ObjectId[];
  isRetry?: boolean;
  paramValues?: Record<string, number>;
}

function fullReveal(options: Array<{ key: string; text: string; role: OptionRole; explanation: string }>): RevealedOption[] {
  return options.map((o) => ({ key: o.key, text: o.text, role: o.role, explanation: o.explanation, correct: o.role === 'correct' }));
}

/** Upserts the ReviewBookEntry for a miss: one entry per (puid, courseId,
 * questionId); a repeat miss updates `triggeringAttemptId`/`updatedAt`
 * without creating a duplicate. Returns whether this was a brand-new entry. */
async function upsertReviewBookEntry(input: {
  puid: string;
  courseId: ObjectId;
  questionId: ObjectId;
  loId: ObjectId;
  themeId: ObjectId;
  attemptId: ObjectId;
}): Promise<boolean> {
  const existing = await reviewBookCol().findOne({ puid: input.puid, courseId: input.courseId, questionId: input.questionId });
  const now = new Date();
  await reviewBookCol().updateOne(
    { puid: input.puid, courseId: input.courseId, questionId: input.questionId },
    {
      $set: { triggeringAttemptId: input.attemptId, loId: input.loId, themeId: input.themeId, updatedAt: now },
      $addToSet: { sources: 'auto' },
      $setOnInsert: { puid: input.puid, courseId: input.courseId, questionId: input.questionId, addedAt: now },
    },
    { upsert: true },
  );
  return !existing;
}

/**
 * Grades one submission, updates mastery, auto-collects the Review Book on
 * any miss, and runs the Strategy-A retry gate. See the module docstring for
 * the recordAttemptInMastery lockstep contract.
 *
 * Behaviour (core doc, Task 11 Interfaces):
 *  - Correct answer, or a miss under applied strategy 'b': full reveal (every
 *    option with role + explanation + correct).
 *  - Strategy-A miss: reveals ONLY the chosen option (others withheld), then
 *    upserts the Review Book entry BEFORE calling `selectRetryQuestion` (the
 *    ordering the core doc calls out explicitly) — a retry question is
 *    attached if one exists; otherwise this degrades to a full reveal (the
 *    §5.1 degradation), with `strategy` staying `'a'`.
 *  - Any miss (either strategy) upserts the Review Book, not just Strategy-A
 *    misses — "on any miss" per the core doc.
 *  - `recommendation`: 'advance-theme' when this attempt both flips the LO to
 *    covered AND that completes the theme; 'advance-lo' when it flips the LO
 *    to covered but the theme isn't fully covered yet; unset otherwise.
 */
export async function submitAttempt(input: SubmitAttemptInput): Promise<AttemptResult> {
  const version = await questionVersionsCol().findOne({ _id: input.questionVersionId });
  if (!version) throw new Error('question-not-servable');

  const question = await questionsCol().findOne({ _id: version.questionId });
  if (!question || question.state !== 'approved') throw new Error('question-not-servable');

  const selectedOption = version.options.find((o) => o.key === input.selectedKey);
  if (!selectedOption) throw new Error('invalid-selected-key');

  const course = await coursesCol().findOne({ _id: question.courseId });
  if (!course) throw new Error('question-not-servable');

  const themeId = question.themeIds[0];
  if (!themeId) throw new Error('question-not-servable');

  const correct = selectedOption.role === 'correct';
  const appliedStrategy = decideStrategy(course.feedbackStrategy, selectedOption.role);

  const attemptId = new ObjectId();
  const attemptRecord: AttemptRecord & { _id: ObjectId } = {
    _id: attemptId,
    puid: input.user.puid,
    courseId: question.courseId,
    questionId: question._id,
    questionVersionId: version._id,
    loId: input.loId,
    themeId,
    mode: input.mode,
    strategy: appliedStrategy,
    selectedKey: input.selectedKey,
    correct,
    selectedRole: selectedOption.role,
    difficulty: version.difficulty,
    ...(input.paramValues !== undefined ? { paramValues: input.paramValues } : {}),
    isRetry: input.isRetry ?? false,
    createdAt: new Date(),
  };

  // Prior status captured BEFORE recordAttemptInMastery mutates it, so we can
  // detect whether THIS attempt is the one that flips the LO to covered.
  const priorStatuses = await getLoStatuses(input.user.puid, question.courseId);
  const priorStatus = priorStatuses.get(input.loId.toHexString()) ?? 'not-attempted';

  const profile = await recordAttemptInMastery(attemptRecord);

  let recommendation: 'advance-lo' | 'advance-theme' | undefined;
  if (priorStatus !== 'covered' && profile.status === 'covered') {
    const coverage = await themeCoverage(input.user.puid, question.courseId, themeId);
    recommendation = coverage.covered ? 'advance-theme' : 'advance-lo';
  }

  let revealed: RevealedOption[];
  let retry: AttemptResult['feedback']['retry'];
  let reviewBookAdded = false;

  if (!correct) {
    reviewBookAdded = await upsertReviewBookEntry({
      puid: input.user.puid,
      courseId: question.courseId,
      questionId: question._id,
      loId: input.loId,
      themeId,
      attemptId,
    });
  }

  if (correct || appliedStrategy === 'b') {
    revealed = fullReveal(version.options);
  } else {
    // Strategy A miss: only the chosen option, others withheld.
    revealed = [{ key: selectedOption.key, text: selectedOption.text, role: selectedOption.role, explanation: selectedOption.explanation, correct: false }];

    const retryResult = await selectRetryQuestion({
      puid: input.user.puid,
      courseId: question.courseId,
      loId: input.loId,
      excludeQuestionId: question._id,
      sessionServedIds: input.sessionServedIds,
    });

    if (retryResult) {
      retry = {
        questionId: retryResult.question._id.toString(),
        questionVersionId: retryResult.version._id.toString(),
        type: retryResult.version.type,
        stem: retryResult.version.stem,
        options: retryResult.version.options.map((o) => ({ key: o.key, text: o.text })),
      };
    } else {
      // §5.1 degradation: no retry available -> full reveal; strategy stays 'a'.
      revealed = fullReveal(version.options);
    }
  }

  return {
    correct,
    feedback: { strategy: appliedStrategy, revealed, ...(retry ? { retry } : {}) },
    mastery: { loStatus: profile.status, ...(recommendation ? { recommendation } : {}) },
    reviewBook: { added: reviewBookAdded },
  };
}

/** The course a QuestionVersion's question belongs to — used by
 * practice.routes.ts to resolve `res.locals.courseId` for
 * `ensureCourseStudent()` on `POST /api/attempts`, which has no `:courseId`
 * in its path. Mirrors bank.service.ts's `getQuestionCourseId`. */
export async function getCourseIdForQuestionVersion(questionVersionId: ObjectId): Promise<ObjectId | null> {
  const version = await questionVersionsCol().findOne({ _id: questionVersionId }, { projection: { questionId: 1 } });
  if (!version) return null;
  const question = await questionsCol().findOne({ _id: version.questionId }, { projection: { courseId: 1 } });
  return question?.courseId ?? null;
}

export interface SessionSummary {
  since: Date | null;
  byLo: Array<{ loId: string; attempted: number; correct: number }>;
  totalAttempts: number;
}

// A session boundary isn't modeled yet (no sessionId on AttemptRecord — that
// is Task 12's session model, per the core doc). Until then, "the last
// session" is approximated as the most recent run of attempts with no gap
// larger than this between consecutive ones — a placeholder, not a permanent
// session definition.
const SESSION_GAP_MS = 60 * 60 * 1000;

/** GET .../session-summary's backing query: the student's most recent
 * attempts for this course, grouped by LO, restricted to the trailing run
 * whose consecutive gaps never exceed SESSION_GAP_MS. */
export async function getSessionSummary(puid: string, courseId: ObjectId): Promise<SessionSummary> {
  const recent: WithId<AttemptRecord>[] = await attemptsCol().find({ puid, courseId }).sort({ createdAt: -1 }).limit(200).toArray();
  if (recent.length === 0) return { since: null, byLo: [], totalAttempts: 0 };

  const session = [recent[0]];
  for (let i = 1; i < recent.length; i += 1) {
    const gap = session[session.length - 1].createdAt.getTime() - recent[i].createdAt.getTime();
    if (gap > SESSION_GAP_MS) break;
    session.push(recent[i]);
  }

  const byLoMap = new Map<string, { attempted: number; correct: number }>();
  for (const a of session) {
    const key = a.loId.toHexString();
    const entry = byLoMap.get(key) ?? { attempted: 0, correct: 0 };
    entry.attempted += 1;
    if (a.correct) entry.correct += 1;
    byLoMap.set(key, entry);
  }

  return {
    since: session[session.length - 1].createdAt,
    byLo: [...byLoMap.entries()].map(([loId, v]) => ({ loId, ...v })),
    totalAttempts: session.length,
  };
}
