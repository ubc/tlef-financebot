import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { validate } from '../middleware/validate';
import { operationContext } from '../services/operation-context';
import { recordOperation, safeDiagnostic } from '../services/operation-audit.service';

export const clientDiagnosticsRouter = Router();
const reportLimit = rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: (req) => req.user!.puid, standardHeaders: true, legacyHeaders: false });
clientDiagnosticsRouter.post('/diagnostics/client-error', ensureApiAuthenticated(), reportLimit,
  validate({ body: z.object({ kind: z.enum(['runtime', 'unhandled-rejection', 'network']), message: z.string().max(2000), page: z.string().max(250) }) }),
  async (req, res) => {
    const user = req.user!;
    const requestId = operationContext.getStore();
    if (!requestId) throw new Error('Missing operation context.');
    // Only known route words survive; identities and arbitrary text become :id.
    const words = new Set(['admin', 'instructor', 'student', 'ta', 'course', 'courses', 'questions', 'operations', 'requests', 'runs', 'bank', 'queue', 'materials', 'structure', 'settings', 'practice', 'review-book', 'summary', 'exams', 'analytics', 'users', 'help', 'flags', 'import', 'preseeding', 'tas', 'exam-templates']);
    const route = String(req.body.page).split('?')[0].replace(/^#/, '').split('/').filter(Boolean).map((part) => words.has(part) ? part : ':id').join('/');
    await recordOperation({ requestId, createdAt: new Date(), durationMs: 0, method: 'CLIENT', route: `/${route}`, statusCode: 0,
      outcome: 'failed', actor: { puid: user.puid, uid: user.uid, displayName: user.displayName }, targets: {}, input: { kind: req.body.kind },
      response: { error: safeDiagnostic(req.body.message), reportedBy: 'browser', note: 'Client-reported evidence; not a server-verified failure.' } });
    res.sendStatus(204);
  });
