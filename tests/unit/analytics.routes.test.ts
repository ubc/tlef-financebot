import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
jest.mock('../../server/src/components/auth', () => ({ ensureCapability: (capability: string) => (req: express.Request, res: express.Response, next: () => void) => {
  if (req.headers['x-signed-out']) return res.sendStatus(401);
  if (req.headers['x-no-analytics'] || (req.headers['x-view-only'] && capability !== 'analytics.view')) return res.sendStatus(403);
  return next();
} }));
jest.mock('../../server/src/services/analytics-report.service', () => ({
  generateAnalyticsReport: jest.fn(async () => Buffer.from('%PDF-1.7')),
}));
jest.mock('../../server/src/services/analytics.service', () => ({ examScores: jest.fn(async () => ({ items: [], excludedUnscored: 0 })), failureRates: jest.fn(async () => []), questionPatterns: jest.fn(async () => ({ items: [], total: 0, limit: 20 })), answerDistributions: jest.fn(async () => ({})), engagement: jest.fn(async () => ({ weeks: [] })), csvSerialize: jest.fn(() => ''), lowEngagement: jest.fn(), searchStudents: jest.fn(), studentProfile: jest.fn() }));
import { analyticsRouter } from '../../server/src/routes/analytics.routes';
import { failureRates, answerDistributions, questionPatterns, engagement } from '../../server/src/services/analytics.service';
import { generateAnalyticsReport } from '../../server/src/services/analytics-report.service';
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

it('downloads a private PDF for aggregate-only viewers with the selected date and mode', async () => {
  const response = await request(app).get(`${base}/report.pdf?mode=exam-prep&from=2026-08-01&to=2026-08-28`).set('x-view-only', 'yes');
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/^application\/pdf/);
  expect(response.headers['content-disposition']).toMatch(/^attachment; filename="?financebot-analytics-exam-prep-2026-08-28\.pdf"?$/);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(generateAnalyticsReport).toHaveBeenLastCalledWith(new ObjectId(courseId), {
    mode: 'exam-prep', from: new Date('2026-08-01'), to: new Date('2026-08-28'),
  });
});

it('rejects inaccessible and invalid report requests before rendering', async () => {
  jest.mocked(generateAnalyticsReport).mockClear();
  const path = `${base}/report.pdf`;
  expect((await request(app).get(path).set('x-signed-out', 'yes')).status).toBe(401);
  expect((await request(app).get(path).set('x-no-analytics', 'yes')).status).toBe(403);
  for (const query of ['mode=retry', 'from=2026-08-28&to=2026-08-01', 'from=1960-01-01', 'to=9999-01-01']) {
    expect((await request(app).get(`${path}?${query}`)).status).toBe(400);
  }
  expect(generateAnalyticsReport).not.toHaveBeenCalled();
});

it('keeps identity-bearing follow-up behind individual permission while aggregates remain readable', async () => {
  expect((await request(app).get(`${base}/low-engagement`).set('x-view-only', 'yes')).status).toBe(403);
  expect((await request(app).get(`${base}/failure-rates`).set('x-view-only', 'yes')).status).toBe(200);
});

it('restricts named exam scores and validates the date range', async () => {
  expect((await request(app).get(base + '/exam-scores').set('x-view-only', 'yes')).status).toBe(403);
  expect((await request(app).get(base + '/exam-scores')).body).toEqual({ items: [], excludedUnscored: 0 });
  expect((await request(app).get(base + '/exam-scores?from=2026-09-15&to=2026-09-01')).status).toBe(400);
});
