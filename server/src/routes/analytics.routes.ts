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
  questionPatterns,
  type AnalyticsFilter,
  lowEngagement,
  searchStudents,
  studentProfile,
} from '../services/analytics.service';

export const analyticsRouter = Router();

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectId });
const questionParams = z.object({ courseId: objectId, questionId: objectId });
const studentParams = z.object({ courseId: objectId, puid: z.string().trim().min(1) });
const rangeQuery = z.object({
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  mode: z.enum(['topic-practice', 'exam-prep']).optional(),
});
const outcomeQuery = rangeQuery.extend({ mode: z.enum(['topic-practice', 'exam-prep']).default('topic-practice'), loId: objectId.optional() });
const patternQuery = outcomeQuery.extend({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const distributionQuery = rangeQuery.extend({ versionId: objectId.optional(), loId: objectId.optional() });
function filters(query: { from?: Date; to?: Date; mode?: 'topic-practice' | 'exam-prep'; loId?: string }): AnalyticsFilter {
  if (query.from && query.to && query.from > query.to) throw new Error('invalid-analytics-range');
  return { from: query.from, to: query.to, mode: query.mode, ...(query.loId ? { loId: new ObjectId(query.loId) } : {}) };
}
const lowQuery = z.object({ inactiveDays: z.coerce.number().int().min(1).max(365).default(7) });
const searchQuery = z.object({ q: z.string().max(200).default('') });

function range(query: z.infer<typeof rangeQuery>): { from: Date; to: Date; mode?: 'topic-practice' | 'exam-prep' } {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 12 * 7 * 86_400_000);
  if (from > to) throw new Error('invalid-analytics-range');
  return { from, to, ...(query.mode ? { mode: query.mode } : {}) };
}

analyticsRouter.get(
  '/courses/:courseId/analytics/failure-rates',
  validate({ params: courseParams, query: outcomeQuery }),
  ensureCapability('analytics.view'),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof outcomeQuery>;
    res.json(await failureRates(new ObjectId(String(req.params.courseId)), query.mode, filters(query)));
  },
);

analyticsRouter.get(
  '/courses/:courseId/analytics/questions/:questionId/distribution',
  validate({ params: questionParams, query: distributionQuery }),
  ensureCapability('analytics.view'),
  async (req, res) => res.json(await answerDistributions(
    new ObjectId(String(req.params.courseId)),
    new ObjectId(String(req.params.questionId)),
    { ...filters(req.query as unknown as z.infer<typeof distributionQuery>),
      ...(req.query.versionId ? { versionId: new ObjectId(String(req.query.versionId)) } : {}) },
  )),
);

analyticsRouter.get(
  '/courses/:courseId/analytics/question-patterns',
  validate({ params: courseParams, query: patternQuery }),
  ensureCapability('analytics.view'),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof patternQuery>;
    res.json(await questionPatterns(new ObjectId(String(req.params.courseId)), filters(query), query.limit));
  },
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
  ensureCapability('analytics.individual'),
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
  if (error instanceof Error && ['question-not-found', 'question-version-not-found'].includes(error.message)) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof Error && error.message === 'invalid-analytics-range') {
    res.status(400).json({ error: error.message });
    return;
  }
  next(error);
});
