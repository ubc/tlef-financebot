import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
jest.mock('../../server/src/components/auth', () => ({ ensureCapability: (capability: string) => (req: express.Request, res: express.Response, next: () => void) => req.headers['x-view-only'] && capability === 'analytics.individual' ? res.sendStatus(403) : next() }));
jest.mock('../../server/src/services/analytics.service', () => ({ failureRates: jest.fn(async () => []), questionPatterns: jest.fn(async () => ({ items: [], total: 0, limit: 20 })), answerDistributions: jest.fn(async () => ({})), engagement: jest.fn(async () => ({ weeks: [] })), csvSerialize: jest.fn(() => ''), lowEngagement: jest.fn(), searchStudents: jest.fn(), studentProfile: jest.fn() }));
import { analyticsRouter } from '../../server/src/routes/analytics.routes';
import { failureRates, answerDistributions, questionPatterns, engagement } from '../../server/src/services/analytics.service';
const courseId = new ObjectId().toHexString();
const questionId = new ObjectId().toHexString();
const versionId = new ObjectId().toHexString();
const app = express(); app.use(analyticsRouter);
const base = `/courses/${courseId}/analytics`;
it('passes exact outcome range and mode', async () => {
  expect((await request(app).get(`${base}/failure-rates?mode=exam-prep&from=2026-08-01&to=2026-08-28`)).status).toBe(200);
  expect(failureRates).toHaveBeenLastCalledWith(new ObjectId(courseId), 'exam-prep', expect.objectContaining({ from: new Date('2026-08-01'), to: new Date('2026-08-28') }));
});
it('rejects reversed ranges, invalid ids, mode and limit', async () => {
  for (const path of ['/failure-rates?from=2026-09-01&to=2026-08-01', '/question-patterns?limit=51', '/question-patterns?loId=no', '/question-patterns?mode=retry']) expect((await request(app).get(base + path)).status).toBe(400);
});
it('returns bounded patterns wrapper', async () => {
  const response = await request(app).get(`${base}/question-patterns?mode=topic-practice&limit=20`);
  expect(response.status).toBe(200); expect(response.body).toEqual({ items: [], total: 0, limit: 20 }); expect(questionPatterns).toHaveBeenCalled();
});
it('passes recorded version and returns missing version as 404', async () => {
  jest.mocked(answerDistributions).mockRejectedValueOnce(new Error('question-version-not-found'));
  expect((await request(app).get(`${base}/questions/${questionId}/distribution?versionId=${versionId}&mode=exam-prep`)).status).toBe(404);
  expect(answerDistributions).toHaveBeenLastCalledWith(new ObjectId(courseId), new ObjectId(questionId), expect.objectContaining({ versionId: new ObjectId(versionId), mode: 'exam-prep' }));
});
it('CSV and engagement share mode/range', async () => {
  for (const suffix of ['', '.csv']) await request(app).get(`${base}/engagement${suffix}?mode=exam-prep&from=2026-08-01&to=2026-08-28`);
  expect(engagement).toHaveBeenLastCalledWith(new ObjectId(courseId), { mode: 'exam-prep', from: new Date('2026-08-01'), to: new Date('2026-08-28') });
});

it('keeps identity-bearing follow-up behind individual permission while aggregates remain readable', async () => {
  expect((await request(app).get(`${base}/low-engagement`).set('x-view-only', 'yes')).status).toBe(403);
  expect((await request(app).get(`${base}/failure-rates`).set('x-view-only', 'yes')).status).toBe(200);
});
