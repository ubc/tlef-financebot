import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCapability } from '../components/auth';
import { validate } from '../middleware/validate';
import {
  answerDistributions,
  csvSerialize,
  engagement,
  failureRates,
  lowEngagement,
  searchStudents,
  studentProfile,
} from '../services/analytics.service';

export const analyticsRouter = Router();

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectId });
const questionParams = z.object({ courseId: objectId, questionId: objectId });
const studentParams = z.object({ courseId: objectId, puid: z.string().trim().min(1) });
const modeQuery = z.object({ mode: z.enum(['topic-practice', 'exam-prep']).default('topic-practice') });
const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const lowQuery = z.object({ inactiveDays: z.coerce.number().int().min(1).max(365).default(7) });
const searchQuery = z.object({ q: z.string().max(200).default('') });

function range(query: z.infer<typeof rangeQuery>): { from: Date; to: Date } {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 12 * 7 * 86_400_000);
  if (from > to) throw new Error('invalid-analytics-range');
  return { from, to };
}

analyticsRouter.get(
  '/courses/:courseId/analytics/failure-rates',
  validate({ params: courseParams, query: modeQuery }),
  ensureCapability('analytics.view'),
  async (req, res) => {
    const { mode } = req.query as z.infer<typeof modeQuery>;
    res.json(await failureRates(new ObjectId(String(req.params.courseId)), mode));
  },
);

analyticsRouter.get(
  '/courses/:courseId/analytics/questions/:questionId/distribution',
  validate({ params: questionParams }),
  ensureCapability('analytics.view'),
  async (req, res) => res.json(await answerDistributions(
    new ObjectId(String(req.params.courseId)),
    new ObjectId(String(req.params.questionId)),
  )),
);

analyticsRouter.get(
  '/courses/:courseId/analytics/engagement',
  validate({ params: courseParams, query: rangeQuery }),
  ensureCapability('analytics.view'),
  async (req, res) => res.json(await engagement(
    new ObjectId(String(req.params.courseId)),
    range(req.query as z.infer<typeof rangeQuery>),
  )),
);

analyticsRouter.get(
  '/courses/:courseId/analytics/engagement.csv',
  validate({ params: courseParams, query: rangeQuery }),
  ensureCapability('analytics.view'),
  async (req, res) => {
    const result = await engagement(
      new ObjectId(String(req.params.courseId)),
      range(req.query as z.infer<typeof rangeQuery>),
    );
    res.type('text/csv').attachment('engagement.csv').send(csvSerialize(result.weeks));
  },
);

analyticsRouter.get(
  '/courses/:courseId/analytics/low-engagement',
  validate({ params: courseParams, query: lowQuery }),
  ensureCapability('analytics.view'),
  async (req, res) => {
    const { inactiveDays } = req.query as unknown as z.infer<typeof lowQuery>;
    res.json(await lowEngagement(new ObjectId(String(req.params.courseId)), inactiveDays));
  },
);

analyticsRouter.get(
  '/courses/:courseId/students',
  validate({ params: courseParams, query: searchQuery }),
  ensureCapability('analytics.individual'),
  async (req, res) => {
    const { q } = req.query as z.infer<typeof searchQuery>;
    res.json(await searchStudents(new ObjectId(String(req.params.courseId)), q));
  },
);

analyticsRouter.get(
  '/courses/:courseId/students/:puid/analytics',
  validate({ params: studentParams }),
  ensureCapability('analytics.individual'),
  async (req, res) => res.json(await studentProfile(
    new ObjectId(String(req.params.courseId)),
    String(req.params.puid),
  )),
);

analyticsRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof Error && error.message === 'student-not-found') {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message === 'question-not-found') {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message === 'invalid-analytics-range') {
    res.status(400).json({ error: error.message });
    return;
  }
  next(error);
});
