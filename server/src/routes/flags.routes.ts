import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import type { WithId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor, ensureCourseStudent } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { flagQuestion, resolveFlag, listFlags } from '../services/flags.service';
import { getQuestionCourseId } from '../services/bank.service';
import { flagsCol } from '../components/mongodb/collections';
import type { Flag, FlagState } from '../types/domain';

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
 * questions.routes.ts: `id` instead of raw `_id`. */
function toFlagResponse(flag: WithId<Flag>): Record<string, unknown> {
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
  ensureCourseInstructor(),
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
  ensureCourseInstructor(),
  validate({ body: resolveFlagBody }),
  async (req, res) => {
    const flagId = new ObjectId(String(req.params.flagId));
    const { action, correctnessAffecting } = req.body as z.infer<typeof resolveFlagBody>;
    const flag = await resolveFlag(flagId, action, req.user!.puid, { correctnessAffecting });
    res.json(toFlagResponse(flag));
  },
);

// --- Error normalization -----------------------------------------------------

// Domain errors thrown by flags.service (plain `Error(message)`) mapped to
// HTTP status here, matching questions.routes.ts's router-scoped normalizer
// pattern. 'question-conflict' can bubble up from transitionQuestion's own
// CAS check inside resolveFlag/checkAutoPause — it must NOT be swallowed
// here as anything other than a straight passthrough to 409. The
// `invalid-transition:` prefix also bubbles up from transitionQuestion (e.g.
// `invalid-transition:archived->archived` when a question's second open flag
// is resolved with `archive` after the first already archived it) — matched
// the same way questions.routes.ts's own normalizer does, so it maps to 409
// instead of falling through to an unmapped 500.
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
