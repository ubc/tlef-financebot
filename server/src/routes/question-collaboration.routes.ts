import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { validate } from '../middleware/validate';
import { commitQuestionDraft, getQuestionDraft, leaveQuestionDraft, mergeQuestionDraft, rebaseQuestionDraft, updateQuestionPresence } from '../services/question-collaboration.service';

export const questionCollaborationRouter = Router();
const path = '/courses/:courseId/questions/:questionId/draft';
const params = z.object({ courseId: z.string().regex(/^[0-9a-f]{24}$/), questionId: z.string().regex(/^[0-9a-f]{24}$/) });
const ids = (req: Request) => [new ObjectId(String(req.params.courseId)), new ObjectId(String(req.params.questionId)), req.user!.puid] as const;
questionCollaborationRouter.get(path, ensureApiAuthenticated(), validate({ params }), async (req, res) => res.json(await getQuestionDraft(...ids(req))));
questionCollaborationRouter.post(`${path}/updates`, ensureApiAuthenticated(), validate({ params, body: z.object({ update: z.string().min(1).max(90_000) }) }), async (req, res) => res.json(await mergeQuestionDraft(...ids(req), req.body.update)));
questionCollaborationRouter.post(`${path}/commit`, ensureApiAuthenticated(), validate({ params, body: z.object({ expectedRevision: z.number().int().nonnegative(), requestId: z.string().uuid() }) }), async (req, res) => res.json(await commitQuestionDraft(...ids(req), req.body.expectedRevision, req.body.requestId)));
questionCollaborationRouter.post(`${path}/rebase`, ensureApiAuthenticated(), validate({ params, body: z.object({ expectedRevision: z.number().int().nonnegative(), expectedVersionId: z.string().regex(/^[0-9a-f]{24}$/) }) }), async (req, res) => res.json(await rebaseQuestionDraft(...ids(req), req.body.expectedRevision, new ObjectId(req.body.expectedVersionId))));
questionCollaborationRouter.put(`${path}/presence`, ensureApiAuthenticated(), validate({ params, body: z.object({ clientId: z.string().uuid(), field: z.string().max(100) }) }), async (req, res) => { await updateQuestionPresence(...ids(req), req.body.clientId, req.body.field); res.status(204).end(); });
questionCollaborationRouter.delete(`${path}/presence/:clientId`, ensureApiAuthenticated(), validate({ params: params.extend({ clientId: z.string().uuid() }) }), async (req, res) => { await leaveQuestionDraft(new ObjectId(String(req.params.questionId)), req.user!.puid, String(req.params.clientId)); res.status(204).end(); });
questionCollaborationRouter.get(`${path}/events`, ensureApiAuthenticated(), validate({ params }), async (req, res) => {
  const context = ids(req);
  const first = await getQuestionDraft(...context);
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('snapshot', first);
  let stopped = false; let busy = false; let last = JSON.stringify(first);
  // Durable polling also works across app processes and after server restarts.
  const timer = setInterval(() => { if (stopped || busy) return; busy = true;
    void getQuestionDraft(...context).then(snapshot => { if (stopped) return; const next = JSON.stringify(snapshot); if (next !== last) { last = next; send('snapshot', snapshot); } else res.write(': keepalive\n\n'); })
      .catch((error: unknown) => {
        if (stopped) return;
        const status = (error as { status?: number }).status;
        // Authorization/lifecycle failures require intervention. A temporary
        // database/network failure should let EventSource reconnect and retry.
        if (status && [401, 403, 404, 409].includes(status)) {
          send('unavailable', { error: error instanceof Error ? error.message : 'Shared editing unavailable.' });
        }
        res.end(); stopped = true; clearInterval(timer);
      })
      .finally(() => { busy = false; });
  }, 1000);
  // The incoming request stream can close as soon as its headers are consumed;
  // the SSE subscription remains alive until the response/socket closes.
  res.on('close', () => { stopped = true; clearInterval(timer); });
});
questionCollaborationRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  const status = (error as { status?: number }).status;
  if (status && error instanceof Error) { res.status(status).json({ error: error.message }); return; }
  if (error instanceof Error && error.message === 'question-conflict') { res.status(409).json({ error: 'The saved question changed. Your shared draft is retained.' }); return; }
  next(error);
});
