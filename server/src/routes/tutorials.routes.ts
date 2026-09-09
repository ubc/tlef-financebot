import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { validate } from '../middleware/validate';
import {
  listTutorials,
  resetTutorialProgress,
  saveTutorialProgress,
} from '../services/tutorials.service';

export const tutorialsRouter = Router();

const roleSchema = z.enum(['student', 'instructor', 'ta', 'admin']);
const tutorialIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid tutorial id.');
const listQuery = z.object({ role: roleSchema });
const tutorialParams = z.object({ tutorialId: tutorialIdSchema });
const progressBody = z.object({
  role: roleSchema,
  status: z.enum(['completed', 'dismissed']),
});

tutorialsRouter.get(
  '/tutorials',
  validate({ query: listQuery }),
  ensureApiAuthenticated(),
  async (req, res) => {
    const { role } = req.query as unknown as z.infer<typeof listQuery>;
    if (role === 'admin' && !req.user!.isAdmin) {
      res.status(403).json({ error: 'Admin access required.' });
      return;
    }
    res.json(await listTutorials(req.user!.puid, role));
  },
);

tutorialsRouter.put(
  '/tutorials/:tutorialId',
  validate({ params: tutorialParams, body: progressBody }),
  ensureApiAuthenticated(),
  async (req, res) => {
    const { tutorialId } = req.params as z.infer<typeof tutorialParams>;
    const { role, status } = req.body as z.infer<typeof progressBody>;
    if (role === 'admin' && !req.user!.isAdmin) {
      res.status(403).json({ error: 'Admin access required.' });
      return;
    }
    res.json(await saveTutorialProgress(req.user!.puid, role, tutorialId, status));
  },
);

tutorialsRouter.delete(
  '/tutorials',
  validate({ query: listQuery }),
  ensureApiAuthenticated(),
  async (req, res) => {
    const { role } = req.query as unknown as z.infer<typeof listQuery>;
    if (role === 'admin' && !req.user!.isAdmin) {
      res.status(403).json({ error: 'Admin access required.' });
      return;
    }
    res.json({ count: await resetTutorialProgress(req.user!.puid, role) });
  },
);

tutorialsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && err.message === 'tutorial-not-found') {
    res.status(404).json({ error: err.message });
    return;
  }
  next(err);
});
