import { Router } from 'express';
import { z } from 'zod';
import { ensureAdmin } from '../components/auth';
import { validate } from '../middleware/validate';
import {
  grantPlatformInstructor,
  listAdminAccounts,
  revokePlatformInstructor,
} from '../services/admin.service';

export const adminRouter = Router();

const querySchema = z.object({
  query: z.string().trim().max(64).optional().default(''),
});
const puidParams = z.object({
  puid: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/, 'Invalid PUID.'),
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
