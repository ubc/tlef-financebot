import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated, ensureCapability } from '../components/auth';
import { ensureCourseStudent } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { flagQuestion, resolveFlag, listFlags, notifyRemediation, remediationReportForFlag } from '../services/flags.service';
import { getQuestionCourseId } from '../services/bank.service';
import { flagsCol } from '../components/mongodb/collections';
import type { Flag, FlagState } from '../types/domain';
import type { RemediationReport } from '../services/remediation.service';

// Student flagging + instructor flag-resolution surface (ST-P09, §6.2), exactly
// as specified in the Task 1 core doc. Routes with no `:courseId` in their path
// stash `res.locals.courseId` from the child resource (question or flag) before
// the course-role guard runs, mirroring questions.routes.ts's
// `stashCourseIdFromQuestion` pattern.
export const flagsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const questionIdParams = z.object({ questionId: objectIdParam });
const courseIdParams = z.object({ courseId: objectIdParam });
const flagIdParams = z.object({ flagId: objectIdParam });

const FLAG_STATES = [
  'open',
  'escalated',
  'resolved-corrected',
  'resolved-archived',
  'resolved-cleared',
] as const satisfies readonly FlagState[];

const flagsQuery = z.object({ state: z.enum(FLAG_STATES).optional() });

const flagQuestionBody = z.object({ reason: z.string().optional() });

const resolveFlagBody = z.object({
  action: z.enum(['correct', 'archive', 'clear']),
  correctnessAffecting: z.boolean().optional(),
  comment: z.string().trim().max(2000).optional(),
});

/** Resolve `res.locals.courseId` from the target question, before
 * `ensureCourseStudent()` runs — mirrors questions.routes.ts's
 * `stashCourseIdFromQuestion` (same documented 404-before-guard tradeoff). */
function stashCourseIdFromQuestion(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    getQuestionCourseId(new ObjectId(String(req.params.questionId)))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'question-not-found' });
          return;
        }
        res.locals.courseId = courseId.toString();
        next();
      })
      .catch(next);
  };
}

/** Resolve `res.locals.courseId` from the target flag, before
 * `ensureCourseInstructor()` runs — `POST /api/flags/:flagId/resolve` has no
 * `:courseId` in its path. Mirrors `stashCourseIdFromQuestion` above. */
function stashCourseIdFromFlag(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    flagsCol()
      .findOne({ _id: new ObjectId(String(req.params.flagId)) }, { projection: { courseId: 1 } })
      .then((flag) => {
        if (!flag) {
          res.status(404).json({ error: 'flag-not-found' });
          return;
        }
        res.locals.courseId = flag.courseId.toString();
        next();
      })
      .catch(next);
  };
}

/** Id-mapping response shape, matching toQuestionResponse's convention in
 * questions.routes.ts: `id` instead of raw `_id`. Accepts an optional
 * `remediation` field (resolved ambiguity #3, Task 6) — present only on a
 * correctness-affecting resolve response; passed straight through via the
 * `...rest` spread when it exists, so listFlags' plain `WithId<Flag>` rows
 * (which never carry it) are unaffected. */
function toFlagResponse(flag: WithId<Flag> & { remediation?: RemediationReport }): Record<string, unknown> {
  const { _id, ...rest } = flag;
  return { id: _id.toString(), ...rest };
}

// --- Student: flag a question --------------------------------------------------

/** POST /api/questions/:questionId/flag { reason? } -> { flagged: true }.
 * Student-guarded; idempotent per (puid, questionVersionId) — the response is
 * the same whether this call created a new flag or deduped an existing one. */
flagsRouter.post(
  '/questions/:questionId/flag',
  validate({ params: questionIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromQuestion(),
  ensureCourseStudent(),
  validate({ body: flagQuestionBody }),
  async (req, res) => {
    const questionId = new ObjectId(String(req.params.questionId));
    const { reason } = req.body as z.infer<typeof flagQuestionBody>;
    await flagQuestion({ puid: req.user!.puid, questionId, ...(reason !== undefined ? { reason } : {}) });
    res.json({ flagged: true });
  },
);

// --- Instructor: flag-resolution queue -----------------------------------------

/** GET /api/courses/:courseId/flags?state= -> flags joined with question +
 * current version. Instructor-only. */
flagsRouter.get(
  '/courses/:courseId/flags',
  validate({ params: courseIdParams }),
  ensureCapability('flag.triage'),
  validate({ query: flagsQuery }),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const { state } = req.query as z.infer<typeof flagsQuery>;
    const flags = await listFlags(courseId, state);
    res.json(flags.map((flag) => toFlagResponse(flag)));
  },
);

/** POST /api/flags/:flagId/resolve { action, correctnessAffecting? } ->
 * resolved flag. Instructor-only, courseId stashed from the target flag. */
flagsRouter.post(
  '/flags/:flagId/resolve',
  validate({ params: flagIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromFlag(),
  ensureCapability('flag.resolve'),
  validate({ body: resolveFlagBody }),
  async (req, res) => {
    const flagId = new ObjectId(String(req.params.flagId));
    const { action, correctnessAffecting, comment } = req.body as z.infer<typeof resolveFlagBody>;
    const flag = await resolveFlag(flagId, action, req.user!.puid, { correctnessAffecting, comment });
    res.json(toFlagResponse(flag));
  },
);

/** POST /api/flags/:flagId/remediation/notify -> { notified: number }.
 * Instructor-only, courseId stashed from the target flag (§6.2 remediation
 * "Notify affected students" action, Task 6). No body. This is an explicit,
 * separately-triggered user action (not part of resolve), reusing the same
 * stashCourseIdFromFlag() + ensureCourseInstructor() guard chain as
 * POST /flags/:flagId/resolve. */
flagsRouter.post(
  '/flags/:flagId/remediation/notify',
  validate({ params: flagIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromFlag(),
  ensureCapability('flag.resolve'),
  async (req, res) => {
    const flagId = new ObjectId(String(req.params.flagId));
    const result = await notifyRemediation(flagId);
    res.json(result);
  },
);

/** GET /api/flags/:flagId/remediation -> RemediationReport. Instructor-only,
 * courseId stashed from the target flag — same guard chain as the
 * resolve/notify routes above. Task 6 review fix (Finding 3): the report is
 * regenerated (a pure read-only query over the flag's `questionVersionId`)
 * rather than persisted, so the remediation panel's blast-radius numbers
 * survive a reload even though flags are terminal and the resolve response's
 * one-shot `remediation` field is gone by then. */
flagsRouter.get(
  '/flags/:flagId/remediation',
  validate({ params: flagIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromFlag(),
  ensureCapability('flag.resolve'),
  async (req, res) => {
    const flagId = new ObjectId(String(req.params.flagId));
    const report = await remediationReportForFlag(flagId);
    res.json(report);
  },
);

// --- Error normalization -----------------------------------------------------

// Domain errors thrown by flags.service (plain `Error(message)`) mapped to
// HTTP status here, matching questions.routes.ts's router-scoped normalizer
// pattern. 'question-conflict' can bubble up from transitionQuestion's own
// CAS check inside resolveFlag/checkAutoPause — it must NOT be swallowed
// here as anything other than a straight passthrough to 409. The
// `invalid-transition:` prefix also bubbles up from transitionQuestion and is
// matched the same way questions.routes.ts's own normalizer does, so it maps
// to 409 instead of falling through to an unmapped 500.
const FLAG_ERROR_STATUS: Record<string, number> = {
  'question-not-found': 404,
  'course-not-found': 404,
  'flag-not-found': 404,
  'invalid-flag-transition': 409,
  'question-conflict': 409,
};

flagsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error) {
    if (Object.hasOwn(FLAG_ERROR_STATUS, err.message)) {
      res.status(FLAG_ERROR_STATUS[err.message]).json({ error: err.message });
      return;
    }
    if (err.message.startsWith('invalid-transition:')) {
      res.status(409).json({ error: err.message });
      return;
    }
  }
  next(err);
});
