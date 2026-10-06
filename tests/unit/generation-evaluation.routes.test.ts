jest.mock('../../server/src/services/generation-evaluation.service', () => ({ exportGenerationEvaluation: jest.fn() }));
jest.mock('../../server/src/services/content-runs.service', () => ({}));
jest.mock('../../server/src/services/generation-blueprints.service', () => ({}));
jest.mock('../../server/src/services/model-usage.service', () => ({}));

import express from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { contentRunsRouter } from '../../server/src/routes/content-runs.routes';
import { exportGenerationEvaluation } from '../../server/src/services/generation-evaluation.service';
import { errorHandler } from '../../server/src/middleware/error-handler';
import type { User } from '../../server/src/types/domain';

const courseId = new ObjectId(); const runId = new ObjectId();
const path = `/api/courses/${courseId}/content-runs/${runId}/evaluation-export`;
function user(role: 'instructor' | 'ta' | 'student' = 'instructor'): User {
  return { puid: 'test-user', uid: 'test-user', email: 'test@example.test', displayName: 'Test', affiliations: [], isAdmin: false,
    courseRoles: [{ courseId, role }], createdAt: new Date(), lastLoginAt: new Date() };
}
function app(person?: User) {
  const result = express();
  result.use((req, _res, next) => { req.isAuthenticated = (() => Boolean(person)) as typeof req.isAuthenticated; req.user = person; next(); });
  result.use('/api', contentRunsRouter); result.use(errorHandler); return result;
}

it('permits only the course Instructor or Admin, not students, TAs, anonymous or foreign-course instructors', async () => {
  const foreign = user(); foreign.courseRoles = [{ courseId: new ObjectId(), role: 'instructor' }];
  for (const [person, status] of [[undefined, 401], [user('student'), 403], [user('ta'), 403], [foreign, 403]] as const) {
    expect((await request(app(person)).get(path)).status).toBe(status);
  }
  expect(exportGenerationEvaluation).not.toHaveBeenCalled();
});

it.each(['instructor', 'admin'])('returns the guarded read-only attachment for %s', async role => {
  const person = user(); if (role === 'admin') { person.isAdmin = true; person.courseRoles = []; }
  jest.mocked(exportGenerationEvaluation).mockResolvedValue({ schemaVersion: 'generation-evaluation-export-v1', slots: [] } as never);
  const response = await request(app(person)).get(path);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-disposition']).toContain(`generation-evaluation-${runId}.json`);
  expect(exportGenerationEvaluation).toHaveBeenCalledWith(courseId, runId);
});

it('validates IDs and preserves missing/foreign run and active run service errors', async () => {
  expect((await request(app(user())).get(`/api/courses/${courseId}/content-runs/invalid/evaluation-export`)).status).toBe(400);
  expect(exportGenerationEvaluation).not.toHaveBeenCalled();
  jest.mocked(exportGenerationEvaluation).mockRejectedValueOnce(Object.assign(new Error('content-run-not-found'), { status: 404 }));
  expect((await request(app(user())).get(path)).status).toBe(404);
  jest.mocked(exportGenerationEvaluation).mockRejectedValueOnce(Object.assign(new Error('content-run-not-terminal'), { status: 409 }));
  expect((await request(app(user())).get(path)).status).toBe(409);
});
