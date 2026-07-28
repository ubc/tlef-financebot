import { Router } from 'express';
import { z } from 'zod';
import { ensureAdmin } from '../components/auth';
import { validate } from '../middleware/validate';
import {
  grantPlatformInstructor,
  listPlatformInstructors,
  revokePlatformInstructor,
} from '../services/admin.service';

export const adminRouter = Router();

const querySchema = z.object({
  query: z.string().trim().max(64).optional().default(''),
});
const uidParams = z.object({
  uid: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, 'Invalid CWL username.'),
});

adminRouter.get(
  '/admin/platform-instructors',
  ensureAdmin(),
  validate({ query: querySchema }),
  async (req, res) => {
    const { query } = req.query as unknown as z.infer<typeof querySchema>;
    res.json(await listPlatformInstructors(query));
  },
);

adminRouter.put(
  '/admin/platform-instructors/:uid',
  ensureAdmin(),
  validate({ params: uidParams }),
  async (req, res) => {
    res.json(await grantPlatformInstructor(String(req.params.uid), req.user!.puid));
  },
);

adminRouter.delete(
  '/admin/platform-instructors/:uid',
  ensureAdmin(),
  validate({ params: uidParams }),
  async (req, res) => {
    res.json(await revokePlatformInstructor(String(req.params.uid), req.user!.puid));
  },
);
