import express from 'express';
import request from 'supertest';
jest.mock('../../server/src/services/admin-diagnostics.service', () => ({
  listOperations: jest.fn(), operationDetail: jest.fn(), listRuns: jest.fn(), runDetail: jest.fn(),
  listAuditHistory: jest.fn(), listAllQuestions: jest.fn(), questionDiagnostic: jest.fn(), reproduceQuestion: jest.fn(),
  listAdminModelUsage: jest.fn(),
}));
jest.mock('../../server/src/services/admin-workflow.service', () => ({ listWorkflows: jest.fn() }));
import * as service from '../../server/src/services/admin-diagnostics.service';
import { listWorkflows } from '../../server/src/services/admin-workflow.service';
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
it.each(['/admin/operations', '/admin/model-usage', '/admin/workflows', '/admin/diagnostic-runs', '/admin/audit-history', '/admin/all-questions', `/admin/all-questions/${id}`, `/admin/all-questions/${id}/reproduce`, `/admin/diagnostic-runs/${id}`, '/admin/operations/550e8400-e29b-41d4-a716-446655440000'])('denies non-Admins on %s', async path => {
  expect((await request(app()).get(`/api${path}`)).status).toBe(401);
  expect((await request(app('instructor')).get(`/api${path}`)).status).toBe(403);
});
it('validates usage and workflow scopes before reading their records', async () => {
  for (const query of ['page=0', 'limit=101', 'courseId=wrong', 'runId=wrong', 'operationId=wrong', 'from=2026-10-03T00:00:00Z&until=2026-10-02T00:00:00Z']) {
    expect((await request(app('admin')).get(`/api/admin/model-usage?${query}`)).status).toBe(400);
  }
  expect((await request(app('admin')).get('/api/admin/workflows')).status).toBe(400);
  expect((await request(app('admin')).get('/api/admin/workflows?actor=%20')).status).toBe(400);
  expect((await request(app('admin')).get('/api/admin/workflows?actor=teacher&from=2026-10-03T00:00:00Z&until=2026-10-02T00:00:00Z')).status).toBe(400);
  expect(service.listAdminModelUsage).not.toHaveBeenCalled();
  expect(listWorkflows).not.toHaveBeenCalled();
});
it('passes bounded user, course, date and correlation filters to Admin read models', async () => {
  jest.mocked(service.listAdminModelUsage).mockResolvedValue({ items: [], total: 0, summary: {} } as never);
  jest.mocked(listWorkflows).mockResolvedValue({ items: [], total: 0 } as never);
  const requestId = '550e8400-e29b-41d4-a716-446655440000';
  expect((await request(app('admin')).get(`/api/admin/model-usage?actor=teacher&courseId=${id}&runId=${id}&operationId=${requestId}&from=2026-10-01T00:00:00Z&page=2`)).status).toBe(200);
  expect(service.listAdminModelUsage).toHaveBeenCalledWith({ actor: 'teacher', courseId: id, runId: id, operationId: requestId, from: '2026-10-01T00:00:00Z', page: 2, limit: 25 });
  expect((await request(app('admin')).get(`/api/admin/workflows?actor=teacher&courseId=${id}&limit=10`)).status).toBe(200);
  expect(listWorkflows).toHaveBeenCalledWith({ actor: 'teacher', courseId: id, page: 1, limit: 10 });
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
