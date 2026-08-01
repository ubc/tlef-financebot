import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureAdmin } from '../components/auth';
import { validate } from '../middleware/validate';
import {
  grantPlatformInstructor,
  assignRole,
  capabilityMatrix,
  deactivateUser,
  getPlatformSettings,
  listAdminAccounts,
  listUsers,
  reactivateUser,
  removeRole,
  revokePlatformInstructor,
  updateCapabilityMatrix,
  updatePlatformSettings,
} from '../services/admin.service';
import { CAPABILITIES } from '../services/capabilities.service';
import type { Capability, CapabilityRole } from '../types/domain';

export const adminRouter = Router();

const querySchema = z.object({
  query: z.string().trim().max(64).optional().default(''),
});
const puidParams = z.object({
  puid: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/, 'Invalid PUID.'),
});
const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const roles = ['student', 'instructor', 'ta'] as const;
const directoryQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(roles).optional(),
  courseId: objectId.optional(),
});
const roleParams = z.object({ puid: puidParams.shape.puid, courseId: objectId, role: z.enum(roles) });
const removeRoleQuery = z.object({ confirm: z.enum(['true', 'false']).optional().default('false') });
const capabilityQuery = z.object({ courseId: objectId.optional() });
const roleAssignments = z.object({
  student: z.boolean().optional(),
  instructor: z.boolean().optional(),
  ta: z.boolean().optional(),
  admin: z.boolean().optional(),
}).partial();
const assignmentsBody = z.object({
  courseId: objectId.optional(),
  assignments: z.record(z.enum(CAPABILITIES), roleAssignments).default({}),
});
const platformSettingsBody = z.object({
  models: z.object({
    generator: z.string().trim().min(1),
    validator: z.string().trim().min(1),
    reviewer: z.string().trim().min(1),
    masteryEvaluator: z.string().trim().min(1),
  }),
  costControls: z.object({ maxGenerationsPerDay: z.number().int().positive() }),
  featureFlags: z.object({ reviewerAgent: z.boolean(), layer2Evaluator: z.boolean() }),
  confirmQualityImpact: z.boolean().optional(),
});

adminRouter.get(
  '/admin/users',
  ensureAdmin(),
  validate({ query: querySchema }),
  async (req, res) => {
    const { query } = req.query as unknown as z.infer<typeof querySchema>;
    res.json(await listAdminAccounts(query));
  },
);

adminRouter.put(
  '/admin/platform-instructors/:puid',
  ensureAdmin(),
  validate({ params: puidParams }),
  async (req, res) => {
    res.json(await grantPlatformInstructor(String(req.params.puid), req.user!.puid));
  },
);

adminRouter.delete(
  '/admin/platform-instructors/:puid',
  ensureAdmin(),
  validate({ params: puidParams }),
  async (req, res) => {
    res.json(await revokePlatformInstructor(String(req.params.puid), req.user!.puid));
  },
);

adminRouter.get(
  '/admin/directory',
  ensureAdmin(),
  validate({ query: directoryQuery }),
  async (req, res) => {
    const query = req.query as unknown as z.infer<typeof directoryQuery>;
    res.json(await listUsers({
      ...(query.q ? { q: query.q } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.courseId ? { courseId: new ObjectId(query.courseId) } : {}),
    }));
  },
);

adminRouter.put(
  '/admin/users/:puid/courses/:courseId/roles/:role',
  ensureAdmin(),
  validate({ params: roleParams }),
  async (req, res) => {
    await assignRole(
      String(req.params.puid),
      new ObjectId(String(req.params.courseId)),
      String(req.params.role) as z.infer<typeof roleParams>['role'],
      req.user!.puid,
    );
    res.status(204).end();
  },
);

adminRouter.delete(
  '/admin/users/:puid/courses/:courseId/roles/:role',
  ensureAdmin(),
  validate({ params: roleParams, query: removeRoleQuery }),
  async (req, res) => {
    const { confirm } = req.query as unknown as z.infer<typeof removeRoleQuery>;
    const result = await removeRole(
      String(req.params.puid),
      new ObjectId(String(req.params.courseId)),
      String(req.params.role) as z.infer<typeof roleParams>['role'],
      req.user!.puid,
      confirm === 'true',
    );
    res.status(result.warning ? 409 : 200).json(result);
  },
);

for (const action of ['deactivate', 'reactivate'] as const) {
  adminRouter.post(
    `/admin/users/:puid/${action}`,
    ensureAdmin(),
    validate({ params: puidParams }),
    async (req, res) => {
      if (action === 'deactivate') await deactivateUser(String(req.params.puid), req.user!.puid);
      else await reactivateUser(String(req.params.puid), req.user!.puid);
      res.status(204).end();
    },
  );
}

adminRouter.get(
  '/admin/capabilities',
  ensureAdmin(),
  validate({ query: capabilityQuery }),
  async (req, res) => {
    const { courseId } = req.query as unknown as z.infer<typeof capabilityQuery>;
    res.json(await capabilityMatrix(courseId ? new ObjectId(courseId) : undefined));
  },
);

adminRouter.put(
  '/admin/capabilities',
  ensureAdmin(),
  validate({ body: assignmentsBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof assignmentsBody>;
    await updateCapabilityMatrix(
      body.assignments as Partial<Record<Capability, Partial<Record<CapabilityRole, boolean>>>>,
      req.user!.puid,
      body.courseId ? new ObjectId(body.courseId) : undefined,
    );
    res.status(204).end();
  },
);

adminRouter.get(
  '/admin/platform-settings',
  ensureAdmin(),
  async (_req, res) => res.json(await getPlatformSettings()),
);

adminRouter.put(
  '/admin/platform-settings',
  ensureAdmin(),
  validate({ body: platformSettingsBody }),
  async (req, res) => res.json(await updatePlatformSettings(
    req.body as z.infer<typeof platformSettingsBody>,
    req.user!.puid,
  )),
);

const ADMIN_ERROR_STATUS: Record<string, number> = {
  'admin-user-not-found': 404,
  'admin-cannot-deactivate-self': 409,
  'invalid-cost-controls': 400,
  'invalid-model-selector': 400,
  'reviewer-disable-confirmation-required': 409,
};

adminRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof Error && Object.hasOwn(ADMIN_ERROR_STATUS, error.message)) {
    res.status(ADMIN_ERROR_STATUS[error.message]).json({ error: error.message });
    return;
  }
  next(error);
});
