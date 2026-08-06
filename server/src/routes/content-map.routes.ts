import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { getCourseContentMap, getCourseKnowledgeGraph } from '../services/content-map.service';

export const contentMapRouter = Router();
const courseParams = z.object({
  courseId: z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.'),
});

contentMapRouter.get(
  '/courses/:courseId/content-map',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await getCourseContentMap(new ObjectId(String(req.params.courseId))));
  },
);

contentMapRouter.get(
  '/courses/:courseId/knowledge-graph',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await getCourseKnowledgeGraph(new ObjectId(String(req.params.courseId))));
  },
);
