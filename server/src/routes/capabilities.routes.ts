import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { validate } from '../middleware/validate';
import { selfCourseCapabilities } from '../services/capabilities.service';

export const selfCapabilitiesRouter = Router();
selfCapabilitiesRouter.get('/courses/:courseId/capabilities/me',
  validate({ params: z.object({ courseId: z.string().regex(/^[0-9a-f]{24}$/) }) }),
  ensureApiAuthenticated(),
  async (req, res, next) => {
    try { res.json(await selfCourseCapabilities(req.user!, new ObjectId(String(req.params.courseId)))); }
    catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 403) { res.status(403).json({ error: error.message }); return; }
      next(error);
    }
  },
);
