import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import {
  ensureCourseInstructor,
  NO_COURSE_ACCESS_BODY,
} from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  enqueueGenerationRun,
  PRESET_PROMPTS,
  preseedingProgress,
  regenerateQuestion,
} from '../services/generation.service';
import { enqueueBlueprintRun } from '../services/generation-blueprints.service';

// Three-agent generation pipeline endpoints (PRD §9.1, IN-Q10). Both routes are
// course-scoped (`:courseId` in the path), so they guard exactly like
// courses.routes.ts's course-scoped routes: `validate(params)` then
// `ensureCourseInstructor()` (which checks authentication itself).
export const generationRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const regenerationParams = z.object({ courseId: objectIdParam, questionId: objectIdParam });
const regenerationBody = z.object({ prompt: z.string().trim().min(1).max(2000) });

function ensureAnyInstructor(req: Request, res: Response, next: NextFunction): void {
  if (
    req.user?.isAdmin ||
    req.user?.courseRoles.some((courseRole) => courseRole.role === 'instructor')
  ) {
    next();
    return;
  }
  res.status(403).json(NO_COURSE_ACCESS_BODY);
}

/** Static, editable prompt starters used by the instructor generation form. */
generationRouter.get(
  '/generation/presets',
  ensureApiAuthenticated(),
  ensureAnyInstructor,
  (_req, res) => {
    res.json(PRESET_PROMPTS);
  },
);

// Bounds: at least one question, capped so a single request can't enqueue an
// unbounded run (each question is 3 LLM calls). Default is a small batch.
const DEFAULT_GENERATION_COUNT = 3;
const generateBody = z.object({
  loId: objectIdParam.optional(),
  blueprintId: objectIdParam.optional(),
  count: z.number().int().min(1).max(20).optional(),
  type: z.enum(['mcq', 'true-false']).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  prompt: z.string().max(2000).optional(),
}).refine((body) => Boolean(body.loId) !== Boolean(body.blueprintId), {
  message: 'Provide exactly one of loId or blueprintId.',
});

/**
 * POST /api/courses/:courseId/generate { loId, count?, type?, difficulty?, prompt? }
 * -> 202 { runId }. Instructor-only. Enqueues the async pipeline; results land
 * later as Draft questions in the review queue (the pipeline never publishes).
 */
generationRouter.post(
  '/courses/:courseId/generate',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  validate({ body: generateBody }),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const body = req.body as z.infer<typeof generateBody>;
    const runId = body.blueprintId
      ? await enqueueBlueprintRun(courseId, new ObjectId(body.blueprintId), req.user!.puid)
      : await enqueueGenerationRun({
          courseId,
          loId: new ObjectId(body.loId!),
          count: body.count ?? DEFAULT_GENERATION_COUNT,
          ...(body.type ? { type: body.type } : {}),
          ...(body.difficulty ? { difficulty: body.difficulty } : {}),
          ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
          byPuid: req.user!.puid,
        });
    res.status(202).json({ runId: runId.toHexString() });
  },
);

/**
 * POST /api/courses/:courseId/questions/:questionId/regenerate { prompt }
 * -> a transient side-by-side variant. The service records only request
 * provenance; replacing content remains an explicit PATCH to the question.
 */
generationRouter.post(
  '/courses/:courseId/questions/:questionId/regenerate',
  validate({ params: regenerationParams }),
  ensureCourseInstructor(),
  validate({ body: regenerationBody }),
  async (req, res) => {
    const params = req.params as z.infer<typeof regenerationParams>;
    const body = req.body as z.infer<typeof regenerationBody>;
    res.json(
      await regenerateQuestion(
        new ObjectId(params.questionId),
        body.prompt,
        req.user!.puid,
        new ObjectId(params.courseId),
      ),
    );
  },
);

/** GET /api/courses/:courseId/preseeding -> [{ loId, loName, approved, reviewed,
 * target }]. Instructor-only. Per-LO Approved/Reviewed counts against target 5. */
generationRouter.get(
  '/courses/:courseId/preseeding',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await preseedingProgress(new ObjectId(String(req.params.courseId))));
  },
);

// --- Error normalization -----------------------------------------------------

// Domain errors the pipeline can throw before/at enqueue time. lo-not-found /
// lo-not-in-course only surface if a future synchronous path calls the pipeline
// directly; the async job logs them itself. Mapped here for the router-scoped
// normalizer pattern (matches courses/materials routes).
const GENERATION_ERROR_STATUS: Record<string, number> = {
  'lo-not-found': 404,
  'lo-not-in-course': 403,
  'content-run-enqueue-failed': 503,
  'question-not-found': 404,
  'version-not-found': 404,
  'question-has-no-lo': 409,
  'question-changed-during-regeneration': 409,
  'generation-material-mention-not-found': 400,
  'generation-material-mention-ambiguous': 400,
  'generation-no-assigned-materials': 409,
  'generation-invalid-options': 422,
  'generation-retrieval-failed': 503,
  'generation-no-grounding': 422,
  'generation-blueprint-not-found': 404,
};

generationRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && Object.hasOwn(GENERATION_ERROR_STATUS, err.message)) {
    res.status(GENERATION_ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
