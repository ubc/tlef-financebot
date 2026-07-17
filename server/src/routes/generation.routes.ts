import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { enqueueJob } from '../components/jobs';
import {
  preseedingProgress,
  GENERATION_JOB,
  type GenerationJobData,
} from '../services/generation.service';

// Three-agent generation pipeline endpoints (PRD §9.1, IN-Q10). Both routes are
// course-scoped (`:courseId` in the path), so they guard exactly like
// courses.routes.ts's course-scoped routes: `validate(params)` then
// `ensureCourseInstructor()` (which checks authentication itself).
export const generationRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });

// Bounds: at least one question, capped so a single request can't enqueue an
// unbounded run (each question is 3 LLM calls). Default is a small batch.
const DEFAULT_GENERATION_COUNT = 3;
const generateBody = z.object({
  loId: objectIdParam,
  count: z.number().int().min(1).max(20).optional(),
  type: z.enum(['mcq', 'true-false']).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  prompt: z.string().max(2000).optional(),
});

/**
 * POST /api/courses/:courseId/generate { loId, count?, type?, difficulty?, prompt? }
 * -> 202 { jobId }. Instructor-only. Enqueues the async pipeline; results land
 * later as Draft questions in the review queue (the pipeline never publishes).
 */
generationRouter.post(
  '/courses/:courseId/generate',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  validate({ body: generateBody }),
  async (req, res) => {
    const courseId = String(req.params.courseId);
    const body = req.body as z.infer<typeof generateBody>;
    await enqueueJob<GenerationJobData>(GENERATION_JOB, {
      courseId,
      loId: body.loId,
      count: body.count ?? DEFAULT_GENERATION_COUNT,
      ...(body.type ? { type: body.type } : {}),
      ...(body.difficulty ? { difficulty: body.difficulty } : {}),
      ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
      byPuid: req.user!.puid,
    });
    res.status(202).json({ jobId: GENERATION_JOB });
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
};

generationRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && Object.hasOwn(GENERATION_ERROR_STATUS, err.message)) {
    res.status(GENERATION_ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
