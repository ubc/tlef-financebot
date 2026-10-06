import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureAdmin } from '../components/auth';
import { validate } from '../middleware/validate';
import { listOperations, operationDetail, listRuns, runDetail, listAuditHistory, listAllQuestions, listAdminModelUsage, questionDiagnostic, reproduceQuestion, type DiagnosticQuery } from '../services/admin-diagnostics.service';
import { listWorkflows, type WorkflowQuery } from '../services/admin-workflow.service';
import type { ModelUsageFilters } from '../types/model-usage';

export const adminDiagnosticsRouter = Router();
const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid record ID.');
const query = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  activity: z.enum(['all', 'actions']).optional(),
  actor: z.string().trim().max(128).optional(), courseId: id.optional(), q: z.string().trim().max(100).optional(),
  outcome: z.enum(['succeeded', 'accepted', 'failed', 'interrupted', 'partial']).optional(),
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed']).optional(),
  state: z.enum(['draft', 'pending-review', 'reviewed', 'approved', 'paused', 'archived']).optional(),
  from: z.string().datetime().optional(), until: z.string().datetime().optional(), requestId: z.string().uuid().optional(),
}).refine((value) => !value.from || !value.until || value.from <= value.until, 'Start must precede end.');
const usageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  actor: z.string().trim().min(1).max(128).optional(), courseId: id.optional(), runId: id.optional(), operationId: z.string().uuid().optional(),
  from: z.string().datetime().optional(), until: z.string().datetime().optional(),
}).refine(value => !value.from || !value.until || value.from <= value.until, 'Start must precede end.');
const workflowQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  actor: z.string().trim().min(1).max(128).optional(), courseId: id.optional(),
  from: z.string().datetime().optional(), until: z.string().datetime().optional(),
}).refine(value => Boolean(value.actor || value.courseId), 'Choose a user or course for the workflow timeline.')
  .refine(value => !value.from || !value.until || value.from <= value.until, 'Start must precede end.');
adminDiagnosticsRouter.get('/admin/model-usage', ensureAdmin(), validate({ query: usageQuery }), async (req, res) => {
  res.json(await listAdminModelUsage(req.query as unknown as ModelUsageFilters));
});
adminDiagnosticsRouter.get('/admin/workflows', ensureAdmin(), validate({ query: workflowQuery }), async (req, res) => {
  res.json(await listWorkflows(req.query as unknown as WorkflowQuery));
});
// Per-route guards: this router shares /api with non-Admin routers.
for (const [path, service] of [
  ['/admin/operations', listOperations], ['/admin/diagnostic-runs', listRuns],
  ['/admin/audit-history', listAuditHistory], ['/admin/all-questions', listAllQuestions],
] as const) {
  adminDiagnosticsRouter.get(path, ensureAdmin(), validate({ query }), async (req, res) => {
    res.json(await service(req.query as unknown as DiagnosticQuery));
  });
}
adminDiagnosticsRouter.get('/admin/operations/:requestId', ensureAdmin(), validate({ params: z.object({ requestId: z.string().uuid() }) }), async (req, res) => {
  res.json(await operationDetail(String(req.params.requestId)));
});
adminDiagnosticsRouter.get('/admin/diagnostic-runs/:id', ensureAdmin(), validate({ params: z.object({ id }) }), async (req, res) => {
  res.json(await runDetail(new ObjectId(String(req.params.id))));
});
adminDiagnosticsRouter.get('/admin/all-questions/:id', ensureAdmin(), validate({ params: z.object({ id }) }), async (req, res) => {
  res.json(await questionDiagnostic(new ObjectId(String(req.params.id))));
});
adminDiagnosticsRouter.get('/admin/all-questions/:id/reproduce', ensureAdmin(), validate({ params: z.object({ id }), query: z.object({
  versionId: id.optional(), seed: z.coerce.number().int().min(-2147483648).max(4294967295).default(1), attemptId: id.optional(),
}).refine((value) => !(value.versionId && value.attemptId), 'Choose a version or a recorded attempt.') }), async (req, res) => {
  res.json(await reproduceQuestion(new ObjectId(String(req.params.id)), req.query as unknown as { versionId?: string; seed: number; attemptId?: string }));
});
