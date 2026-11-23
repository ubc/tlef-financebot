import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { getInstructorCourseModels, saveInstructorCourseModels } from '../services/admin.service';

/**
 * Course instructors choose each AI step's model for their course
 * (spec docs/superpowers/specs/2026-11-23-instructor-course-models-design.md).
 * The same shared setting as Admin's per-course panel; new choices are limited
 * to the built-in supported models.
 */
export const courseModelsRouter = Router();

const params = z.object({ courseId: z.string().refine(value => ObjectId.isValid(value), 'invalid course id') });
const choice = z.string().trim().min(1).max(250).optional();
const body = z.object({
  revision: z.number().int().nonnegative().safe(),
  overrides: z.object({
    generator: choice, reviewer: choice, utility: choice, outlineOrganizer: choice, masteryEvaluator: choice,
  }).strict(),
});

const STATUS: Record<string, number> = { 'course-not-found': 404, 'course-models-conflict': 409, 'invalid-model-selector': 400 };
const handle = (work: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => {
  try { await work(req, res); } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (STATUS[code]) { res.status(STATUS[code]).json({ error: code }); return; }
    next(error);
  }
};

courseModelsRouter.get('/courses/:courseId/models', validate({ params }), ensureCourseInstructor(),
  handle(async (req, res) => { res.json(await getInstructorCourseModels(new ObjectId(String(req.params.courseId)))); }));

courseModelsRouter.put('/courses/:courseId/models', validate({ params, body }), ensureCourseInstructor(),
  handle(async (req, res) => {
    res.json(await saveInstructorCourseModels(new ObjectId(String(req.params.courseId)), req.body.revision, req.body.overrides, req.user!.puid));
  }));
