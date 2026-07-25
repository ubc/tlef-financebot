import type { ObjectId } from 'mongodb';
import { attemptsCol, reviewBookCol } from '../components/mongodb/collections';
import { notify } from './notifications.service';

// -----------------------------------------------------------------------------
// Remediation service (§6.2 step 1, Task 6): computes the "blast radius" of a
// correctness-affecting flag resolution -- which AttemptRecords were pinned to
// the bad QuestionVersion -- and fans out the one automated remediation action
// (student correction notices). Everything else in §6.2's remediation flow
// (recompute correctness, drop from mastery windows, remove wrongly-added
// Review Book entries) is a MANUAL checklist rendered client-side from this
// report; deliberately not automated here (pilot scope -- full automation
// stays on the master slip list). Called from flags.service.ts's resolveFlag
// correctness-affecting branch and from flags.routes.ts's remediation/notify
// route (via a thin flags.service.ts wrapper) -- never directly from a route,
// per routes/AGENTS.md ("No database or SDK calls directly in a route").
// -----------------------------------------------------------------------------

export interface RemediationReport {
  affectedAttempts: number;
  affectedStudents: string[];
  reviewBookEntries: number;
  examAttempts: number;
}

/**
 * Locates every AttemptRecord pinned to the exact (bad) `questionVersionId`
 * -- never the mutable Question head, so a later content edit can't
 * retroactively broaden or narrow the blast radius. `examAttempts` counts the
 * subset with `examAttemptId` set (i.e. served in exam-prep mode), per
 * resolved ambiguity #1 -- NOT a separate `examAttemptsCol()` query.
 * `reviewBookEntries` joins ReviewBookEntry through `triggeringAttemptId`
 * against the affected attempts' own `_id`s, since ReviewBookEntry itself is
 * keyed by `questionId` (not `questionVersionId`) and so can't be filtered
 * directly. Deliberately does NOT consult `masteryCol()` or add a mastery
 * count -- MasteryProfile is an LO-level rollup with no per-version field, so
 * that remediation step stays manual checklist text (resolved ambiguity #2).
 */
export async function remediationReport(questionVersionId: ObjectId): Promise<RemediationReport> {
  const attempts = await attemptsCol().find(
    { questionVersionId },
    { projection: { _id: 1, puid: 1, examAttemptId: 1 } },
  ).toArray();

  const affectedAttempts = attempts.length;
  const affectedStudents = [...new Set(attempts.map((attempt) => attempt.puid))];
  const examAttempts = attempts.filter((attempt) => attempt.examAttemptId !== undefined).length;

  const attemptIds = attempts.map((attempt) => attempt._id);
  const reviewBookEntries = attemptIds.length
    ? await reviewBookCol().countDocuments({ triggeringAttemptId: { $in: attemptIds } })
    : 0;

  return { affectedAttempts, affectedStudents, reviewBookEntries, examAttempts };
}

/**
 * The pilot's one automated remediation action (§6.2's "Notify affected
 * students" button): one `kind: 'correction'` notification per DISTINCT
 * affected student, even when a student has multiple affected attempts.
 * `priority: 'standard'` -- 'elevated' is reserved for auto-pause specifically
 * per the phase plan's Global Constraints (resolved ambiguity #6). Uses
 * `attemptsCol().distinct('puid', ...)` rather than re-deriving the set from
 * `remediationReport`'s attempt list, mirroring flags.service.ts's own
 * `countDistinctAttempters` pattern -- the dedup happens server-side in Mongo.
 */
export async function notifyAffectedStudents(
  questionVersionId: ObjectId,
  courseId: ObjectId,
): Promise<{ notified: number }> {
  const puids = await attemptsCol().distinct('puid', { questionVersionId });

  await Promise.all(
    puids.map((puid) =>
      notify({
        recipientPuid: puid,
        courseId,
        kind: 'correction',
        priority: 'standard',
        body: 'A question you previously answered has been corrected. Please review it in your Review Book.',
        refType: 'questionVersion',
        refId: questionVersionId,
      }),
    ),
  );

  return { notified: puids.length };
}
