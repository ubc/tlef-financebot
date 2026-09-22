import express from 'express';
import request from 'supertest';
jest.mock('../../server/src/services/admin-diagnostics.service', () => ({
  listOperations: jest.fn(), operationDetail: jest.fn(), listRuns: jest.fn(), runDetail: jest.fn(),
  listAuditHistory: jest.fn(), listAllQuestions: jest.fn(), questionDiagnostic: jest.fn(), reproduceQuestion: jest.fn(),
}));
import * as service from '../../server/src/services/admin-diagnostics.service';
import { adminDiagnosticsRouter } from '../../server/src/routes/admin-diagnostics.routes';
const id = '123456789012345678901234';
function app(role?: 'admin' | 'instructor') {
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as typeof req.isAuthenticated;
    if (role) req.user = { puid: 'test', isAdmin: role === 'admin', platformInstructor: true } as Express.User;
    next();
  });
  app.use('/api', adminDiagnosticsRouter);
  return app;
}
it.each(['/admin/operations', '/admin/diagnostic-runs', '/admin/audit-history', '/admin/all-questions', `/admin/all-questions/${id}`, `/admin/all-questions/${id}/reproduce`, `/admin/diagnostic-runs/${id}`, '/admin/operations/550e8400-e29b-41d4-a716-446655440000'])('denies non-Admins on %s', async path => {
  expect((await request(app()).get(`/api${path}`)).status).toBe(401);
  expect((await request(app('instructor')).get(`/api${path}`)).status).toBe(403);
});
it('validates paging, date bounds, seed and exclusive replay evidence', async () => {
  for (const query of ['page=-1', 'limit=101', 'courseId=no', 'outcome=unknown', 'from=2026-09-19T00:00:00Z&until=2026-09-18T00:00:00Z']) {
    expect((await request(app('admin')).get(`/api/admin/operations?${query}`)).status).toBe(400);
  }
  expect((await request(app('admin')).get(`/api/admin/all-questions/${id}/reproduce?seed=NaN`)).status).toBe(400);
  expect((await request(app('admin')).get(`/api/admin/all-questions/${id}/reproduce?attemptId=${id}&versionId=${id}`)).status).toBe(400);
  expect(service.listOperations).not.toHaveBeenCalled();
});
it('passes validated Admin filters and replay choices to the service', async () => {
  jest.mocked(service.listOperations).mockResolvedValue({ items: [], total: 0 } as never);
  expect((await request(app('admin')).get('/api/admin/operations?actor=teacher&outcome=failed&page=2')).status).toBe(200);
  expect(service.listOperations).toHaveBeenCalledWith(expect.objectContaining({ actor: 'teacher', page: 2, limit: 25, outcome: 'failed' }));
  jest.mocked(service.reproduceQuestion).mockResolvedValue({} as never);
  await request(app('admin')).get(`/api/admin/all-questions/${id}/reproduce?versionId=${id}&seed=99`);
  expect(service.reproduceQuestion).toHaveBeenCalledWith(expect.anything(), { versionId: id, seed: 99 });
});
