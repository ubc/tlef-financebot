import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import {
  reviewBookCol,
  attemptsCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
  sessionSummariesCol,
} from '../components/mongodb/collections';
import { getLoStatuses } from './mastery.service';
import type { ReviewBookEntry, Theme } from '../types/domain';

// -----------------------------------------------------------------------------
// Review Book service (Task 12, ST-R02..R07, ST-P10/P11): browsing/bookmarking
// the Review Book that Task 11's attempts.service.ts auto-collects into on any
// miss, plus the session-summary/deferred-summary flow.
//
// Session model (core doc, Task 12): a "session" is every attempt since a
// client-provided `since` timestamp. Deferral overwrites the single stored
// summary per (puid, courseId) — see sessionSummariesCol()'s unique index.
// -----------------------------------------------------------------------------

export interface BookmarkResult {
  bookmarked: boolean;
}

/**
 * Adds/removes `'bookmark'` in a ReviewBookEntry's `sources` array (ST-R02).
 * An entry with `sources` including `'auto'` survives un-bookmarking — only
 * bookmark-only entries are deleted when un-bookmarked. If no entry exists
 * yet, one is created sourced from the student's latest attempt on this
 * question (loId/themeId/triggeringAttemptId); if the student has never
 * attempted this question, there is no context to source the entry from and
 * this throws `'no-attempt-context'`.
 */
export async function toggleBookmark(puid: string, courseId: ObjectId, questionId: ObjectId): Promise<BookmarkResult> {
  const existing = await reviewBookCol().findOne({ puid, courseId, questionId });

  if (existing) {
    const hasBookmark = existing.sources.includes('bookmark');
    if (hasBookmark) {
      const remaining = existing.sources.filter((s) => s !== 'bookmark');
      if (remaining.length === 0) {
        await reviewBookCol().deleteOne({ _id: existing._id });
      } else {
        await reviewBookCol().updateOne({ _id: existing._id }, { $set: { sources: remaining, updatedAt: new Date() } });
      }
      return { bookmarked: false };
    }

    await reviewBookCol().updateOne({ _id: existing._id }, { $addToSet: { sources: 'bookmark' }, $set: { updatedAt: new Date() } });
    return { bookmarked: true };
  }

  const latestAttempt = await attemptsCol().find({ puid, courseId, questionId }).sort({ createdAt: -1 }).limit(1).toArray();
  const attempt = latestAttempt[0];
  if (!attempt) throw new Error('no-attempt-context');

  const now = new Date();
  await reviewBookCol().insertOne({
    puid,
    courseId,
    questionId,
    sources: ['bookmark'],
    triggeringAttemptId: attempt._id,
    loId: attempt.loId,
    themeId: attempt.themeId,
    addedAt: now,
    updatedAt: now,
  } as ReviewBookEntry);

  return { bookmarked: true };
}

/**
 * Deletes a Review Book entry outright (ST-R03) — scoped to the owning
 * student via `puid`. Never touches `attemptRecords`: removing an entry from
 * the Review Book must not (and cannot, by construction) rewrite attempt
 * history.
 */
export async function removeEntry(puid: string, entryId: ObjectId): Promise<void> {
  await reviewBookCol().deleteOne({ _id: entryId, puid });
}

export interface ReviewBookGroup {
  theme: WithId<Theme>;
  entries: Array<
    WithId<ReviewBookEntry> & {
      question: { stem: string; type: string; difficulty: string };
    }
  >;
}

export type ReviewBookSort = 'theme' | 'date';

/**
 * Lists a student's Review Book grouped by theme (theme order ascending),
 * with each entry enriched by its current question stem/type/difficulty.
 * `sort: 'date'` orders entries within each group newest-first by `addedAt`;
 * `sort: 'theme'` leaves grouping as the only ordering concern (ST-R04/R05 —
 * shipping only these two sorts per the core doc's slip guidance).
 */
export async function listReviewBook(puid: string, courseId: ObjectId, sort: ReviewBookSort): Promise<ReviewBookGroup[]> {
  const entries = await reviewBookCol().find({ puid, courseId }).toArray();
  if (entries.length === 0) return [];

  const questionIds = [...new Map(entries.map((e) => [e.questionId.toString(), e.questionId])).values()];
  const themeIds = [...new Map(entries.map((e) => [e.themeId.toString(), e.themeId])).values()];

  const [questions, themes] = await Promise.all([
    questionsCol().find({ _id: { $in: questionIds } }).toArray(),
    themesCol().find({ _id: { $in: themeIds } }).toArray(),
  ]);

  const versionIds = [...new Map(questions.map((q) => [q.currentVersionId.toString(), q.currentVersionId])).values()];
  const versions = await questionVersionsCol().find({ _id: { $in: versionIds } }).toArray();

  const questionById = new Map(questions.map((q) => [q._id.toString(), q]));
  const versionById = new Map(versions.map((v) => [v._id.toString(), v]));
  const themeById = new Map(themes.map((t) => [t._id.toString(), t]));

  const sortedEntries = [...entries].sort((a, b) => (sort === 'date' ? b.addedAt.getTime() - a.addedAt.getTime() : 0));

  const groupsByTheme = new Map<string, ReviewBookGroup>();
  for (const entry of sortedEntries) {
    const theme = themeById.get(entry.themeId.toString());
    if (!theme) continue;
    const question = questionById.get(entry.questionId.toString());
    const version = question ? versionById.get(question.currentVersionId.toString()) : undefined;

    const key = entry.themeId.toString();
    let group = groupsByTheme.get(key);
    if (!group) {
      group = { theme, entries: [] };
      groupsByTheme.set(key, group);
    }
    group.entries.push({
      ...entry,
      question: {
        stem: version?.stem ?? '',
        type: version?.type ?? '',
        difficulty: version?.difficulty ?? '',
      },
    });
  }

  return [...groupsByTheme.values()].sort((a, b) => a.theme.order - b.theme.order);
}

export interface SessionEndSummary {
  losCovered: string[];
  questionsAttempted: number;
  accuracyByLo: Array<{ loId: string; attempted: number; correct: number; accuracy: number }>;
  reviewBookAdditions: Array<{ entryId: string; questionId: string; loId: string; themeId: string }>;
  missedQuestions: string[];
}

/**
 * Computes the end-of-session summary for attempts since `since` (ST-P10).
 * `missedQuestions` is derived from the SAME Review Book entries counted in
 * `reviewBookAdditions` — not a separately-queried "incorrect attempts"
 * list — so it can never diverge from what the Review Book actually shows
 * (ST-R06): an entry only counts as an "addition" in this window if its
 * `addedAt` (first-miss time, set once via $setOnInsert in
 * attempts.service.ts) falls inside the window; a repeat-miss `updatedAt`
 * bump on an older entry does not.
 */
export async function sessionEndSummary(puid: string, courseId: ObjectId, since: Date): Promise<SessionEndSummary> {
  const [sessionAttempts, reviewBookAdditionsRaw] = await Promise.all([
    attemptsCol().find({ puid, courseId, createdAt: { $gte: since } }).toArray(),
    reviewBookCol().find({ puid, courseId, addedAt: { $gte: since } }).toArray(),
  ]);

  const byLo = new Map<string, { attempted: number; correct: number }>();
  for (const a of sessionAttempts) {
    const key = a.loId.toHexString();
    const entry = byLo.get(key) ?? { attempted: 0, correct: 0 };
    entry.attempted += 1;
    if (a.correct) entry.correct += 1;
    byLo.set(key, entry);
  }

  const statuses = await getLoStatuses(puid, courseId);
  const losCovered = [...byLo.keys()].filter((loId) => statuses.get(loId) === 'covered');

  const accuracyByLo = [...byLo.entries()].map(([loId, v]) => ({
    loId,
    attempted: v.attempted,
    correct: v.correct,
    accuracy: v.attempted === 0 ? 0 : v.correct / v.attempted,
  }));

  const reviewBookAdditions = reviewBookAdditionsRaw.map((e) => ({
    entryId: e._id.toString(),
    questionId: e.questionId.toString(),
    loId: e.loId.toHexString(),
    themeId: e.themeId.toString(),
  }));

  return {
    losCovered,
    questionsAttempted: sessionAttempts.length,
    accuracyByLo,
    reviewBookAdditions,
    missedQuestions: reviewBookAdditions.map((a) => a.questionId),
  };
}

export interface SessionSummaryForStart {
  deferred?: SessionEndSummary;
  welcome: boolean;
}

/**
 * Computes the end-of-session summary since `since` and stores it as the
 * student's deferred summary for this course (ST-P10) — overwriting any
 * previously-deferred summary (upsert on the unique (puid, courseId) index).
 */
export async function storeDeferredSummary(puid: string, courseId: ObjectId, since: Date): Promise<SessionEndSummary> {
  const summary = await sessionEndSummary(puid, courseId, since);
  const now = new Date();
  await sessionSummariesCol().updateOne(
    { puid, courseId },
    { $set: { puid, courseId, summary, since, updatedAt: now } },
    { upsert: true },
  );
  return summary;
}

/**
 * Start-of-session read (ST-P11): `welcome: true` when the student has no
 * attempts in this course yet (first-ever session). Otherwise returns the
 * previously-deferred summary, if any, under `deferred`.
 */
export async function getSessionSummaryForStart(puid: string, courseId: ObjectId): Promise<SessionSummaryForStart> {
  const attemptCount = await attemptsCol().countDocuments({ puid, courseId });
  if (attemptCount === 0) return { welcome: true };

  const stored = await sessionSummariesCol().findOne({ puid, courseId });
  return { welcome: false, ...(stored ? { deferred: stored.summary as SessionEndSummary } : {}) };
}
