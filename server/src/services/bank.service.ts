import type { WithId, ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol } from '../components/mongodb/collections';
import type { Question, QuestionVersion, PublicationState, QuestionType, Difficulty, QuestionLabel } from '../types/domain';

// -----------------------------------------------------------------------------
// Bank service (Task 5, IN-Q02/Q05/Q08): the instructor-facing browse/filter
// view over the question bank and the prioritized review queue. Pure service
// logic — routes/questions.routes.ts is the only caller. See
// server/src/services/AGENTS.md. Only reads questionsCol()/questionVersionsCol()
// — flagsCol()/attemptsCol() are not needed: the review-queue ordering rule
// (student-flagged label -> reviewed state -> under-coverage by approved
// count) is computable entirely from Question/QuestionVersion documents.
// -----------------------------------------------------------------------------

export interface BankFilters {
  state?: PublicationState;
  loId?: ObjectId;
  themeId?: ObjectId;
  type?: QuestionType;
  difficulty?: Difficulty;
  label?: QuestionLabel;
  includeArchived?: boolean;
}

export type BankItem = WithId<Question> & { current: WithId<QuestionVersion> };

/** Joins each question head's current QuestionVersion via a single `$in` on
 * currentVersionId. A head whose current version is somehow missing (should
 * never happen — versions are never deleted, PRD §2) is silently dropped
 * rather than surfaced as a joined item with no `current`. */
async function joinCurrentVersions<T extends WithId<Question>>(heads: T[]): Promise<Array<T & { current: WithId<QuestionVersion> }>> {
  if (heads.length === 0) return [];
  const versionIds = heads.map((h) => h.currentVersionId);
  const versions = await questionVersionsCol()
    .find({ _id: { $in: versionIds } })
    .toArray();
  const versionById = new Map(versions.map((v) => [v._id.toString(), v]));
  const joined: Array<T & { current: WithId<QuestionVersion> }> = [];
  for (const head of heads) {
    const current = versionById.get(head.currentVersionId.toString());
    if (current) joined.push({ ...head, current });
  }
  return joined;
}

/**
 * Browse/filter the question bank (IN-Q08). `state` is a strict publication
 * state — `student-flagged` and other overlay labels are a SEPARATE `label`
 * filter, never conflated into `state`. Archived questions are excluded
 * unless `state: 'archived'` is requested explicitly or `includeArchived` is
 * set — no fallback to unreviewed/archived content by default. `type` and
 * `difficulty` live on the QuestionVersion, not the head, so they're applied
 * after the version join rather than as a head-collection query filter.
 */
export async function browseBank(
  courseId: ObjectId,
  filters: BankFilters,
): Promise<{ total: number; questions: BankItem[] }> {
  const query: Record<string, unknown> = { courseId };
  if (filters.state) {
    query.state = filters.state;
  } else if (!filters.includeArchived) {
    query.state = { $ne: 'archived' };
  }
  if (filters.loId) query.loIds = filters.loId;
  if (filters.themeId) query.themeIds = filters.themeId;
  if (filters.label) query.labels = filters.label;

  const heads = await questionsCol().find(query).toArray();
  let joined = await joinCurrentVersions(heads);

  if (filters.type) joined = joined.filter((q) => q.current.type === filters.type);
  if (filters.difficulty) joined = joined.filter((q) => q.current.difficulty === filters.difficulty);

  return { total: joined.length, questions: joined };
}

/**
 * Prioritized review queue (IN-Q02): non-archived, non-approved questions
 * ordered (1) `labels` contains `student-flagged`, (2) `state === 'reviewed'`,
 * (3) the rest, ranked by under-coverage — fewest Approved questions
 * currently tagged to their first LO sort first, so the thinnest LOs surface
 * ahead of already well-covered ones. Computed as three top-level
 * questionsCol() queries (one per tier) concatenated and de-duplicated by id
 * — a question already placed by an earlier, higher-priority tier is never
 * re-added by a later one. A question with no LOs sorts last within tier 3
 * (there's no coverage number to rank it by).
 */
export async function reviewQueue(courseId: ObjectId): Promise<Array<BankItem & { priority: number }>> {
  const nonTerminal = { courseId, state: { $nin: ['archived', 'approved'] as PublicationState[] } };

  const flagged = await questionsCol()
    .find({ ...nonTerminal, labels: 'student-flagged' })
    .toArray();
  const reviewed = await questionsCol()
    .find({ ...nonTerminal, state: 'reviewed' })
    .toArray();
  const rest = await questionsCol().find(nonTerminal).toArray();

  const seen = new Set<string>();
  const ordered: Array<WithId<Question> & { priority: number }> = [];
  const addAll = (docs: WithId<Question>[], priority: number): void => {
    for (const doc of docs) {
      const id = doc._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push({ ...doc, priority });
    }
  };
  addAll(flagged, 1);
  addAll(reviewed, 2);

  const restRemaining = rest.filter((doc) => !seen.has(doc._id.toString()));
  const coverageByLo = new Map<string, number>();
  for (const doc of restRemaining) {
    const firstLoId = doc.loIds[0];
    if (!firstLoId) continue;
    const key = firstLoId.toString();
    if (coverageByLo.has(key)) continue;
    // courseId-scoped like every other query in this file — an LO id is not
    // globally unique to a course, and PATCH lets an instructor tag their own
    // question with any loId (no ownership check at that layer). Without this
    // scope, a question in course B carrying course A's LO id would count
    // toward A's approved coverage and skew A's review-queue ordering.
    coverageByLo.set(key, await questionsCol().countDocuments({ courseId, loIds: firstLoId, state: 'approved' }));
  }
  const rankedRest = restRemaining
    .map((doc) => ({
      doc,
      coverage: doc.loIds[0] ? (coverageByLo.get(doc.loIds[0].toString()) ?? 0) : Number.POSITIVE_INFINITY,
    }))
    // Explicit comparator, not `a.coverage - b.coverage` — two LO-less
    // questions both carry Number.POSITIVE_INFINITY, and Infinity - Infinity
    // is NaN. Array.prototype.sort coerces a NaN comparator result to +0
    // (treats them as equal) so this was never actually broken, but that's
    // an implementation detail of `sort` to depend on, not a guarantee to
    // write into a comparator on purpose.
    .sort((a, b) => {
      if (a.coverage === b.coverage) return 0;
      return a.coverage < b.coverage ? -1 : 1;
    })
    .map((x) => x.doc);
  addAll(rankedRest, 3);

  const joined = await joinCurrentVersions(ordered);
  return joined;
}

/** The course a question belongs to — used by questions.routes.ts to resolve
 * `res.locals.courseId` for `ensureCourseInstructor()` on question-scoped
 * endpoints that have no `:courseId` in their path. Mirrors
 * courses.service.ts's getThemeCourseId()/getLoCourseId(). */
export async function getQuestionCourseId(questionId: ObjectId): Promise<ObjectId | null> {
  const question = await questionsCol().findOne({ _id: questionId }, { projection: { courseId: 1 } });
  return question?.courseId ?? null;
}

/**
 * Distinct courseIds among the given question ids that actually exist — used
 * only by the bulk-transition route's loader to decide whether an entire
 * batch belongs to a single course before `ensureCourseInstructor()` runs
 * (human-approved decision, see questions.routes.ts). A missing id is simply
 * absent from the result, not an error here — `bulkTransition()` itself
 * reports per-id `question-not-found`.
 */
export async function getDistinctQuestionCourseIds(questionIds: ObjectId[]): Promise<ObjectId[]> {
  return questionsCol().distinct('courseId', { _id: { $in: questionIds } });
}

export interface QuestionDetail {
  question: WithId<Question>;
  current: WithId<QuestionVersion>;
  versions: Array<{ version: number; createdBy: string; createdAt: Date; editedFields?: string[] }>;
}

/** Full detail view for `GET /api/questions/:questionId`: the head (carrying
 * `agentDecision`/`internalNotes`), its current version, and lightweight
 * version-list metadata (not the full content of every past version). */
export async function getQuestionDetail(questionId: ObjectId): Promise<QuestionDetail> {
  const question = await questionsCol().findOne({ _id: questionId });
  if (!question) throw new Error('question-not-found');

  const current = await questionVersionsCol().findOne({ _id: question.currentVersionId });
  if (!current) throw new Error('version-not-found');

  const versions = await questionVersionsCol()
    .find({ questionId }, { projection: { version: 1, createdBy: 1, createdAt: 1, editedFields: 1 } })
    .sort({ version: 1 })
    .toArray();

  return {
    question,
    current,
    versions: versions.map((v) => ({
      version: v.version,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      editedFields: v.editedFields,
    })),
  };
}
