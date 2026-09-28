import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { canvas, canvasEnabled, canvasConfig, CANVAS_SCOPES, tokenStore } from '../components/canvas';
import { env } from '../config/env';
import { validate } from '../middleware/validate';
import { CanvasError, listCanvasCourses, saveCanvasLink, canvasLinkStatus, syncCanvasLink, unlinkCanvas,
  disconnectCanvas, listCanvasFiles, importCanvasFile } from '../services/canvas.service';

declare module 'express-session' { interface SessionData { financeCanvasOAuth?: { state: string; puid: string; expires: number; returnTo: string }; } }
export const canvasRouter = Router();
const teacher: RequestHandler = (req, res, next) => {
  if (req.user && (req.user.isAdmin || req.user.platformInstructor || req.user.courseRoles.some(r => r.role === 'instructor'))) next();
  else res.status(403).json({ error: 'Instructor access required.' });
};
// JSON requests and the same-origin browser check protect cookie-authenticated mutations.
const sameOrigin: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  const expected = new URL(env.canvasRedirectUri || `${req.protocol}://${req.get('host')}`).origin;
  if (req.get('origin') !== expected || !req.is('application/json')) {
    res.status(403).json({ error: 'A same-origin JSON request is required.' }); return;
  }
  next();
};
canvasRouter.use(['/canvas', '/courses/:courseId/canvas'], ensureApiAuthenticated(), sameOrigin);
canvasRouter.get('/canvas/status', teacher, async (req, res) => {
  const tokens = canvasEnabled() ? await tokenStore.get(req.user!.puid) : null;
  res.json({ configured: canvasEnabled(), connected: Boolean(tokens), domain: env.canvasDomain, canvasUserId: tokens?.canvasUserId });
});
canvasRouter.post('/canvas/connect', teacher, async (req, res) => {
  if (!canvasEnabled()) throw new CanvasError('Canvas has not been configured on this server.', 503);
  const returnTo = typeof req.body.returnTo === 'string' && /^\/#\/instructor\/(?:canvas|course\/[a-f0-9]{24}\/canvas)$/.test(req.body.returnTo)
    ? req.body.returnTo : '/#/instructor/canvas';
  const state = randomBytes(32).toString('hex');
  req.session.financeCanvasOAuth = { state, puid: req.user!.puid, expires: Date.now() + 10 * 60000, returnTo };
  await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  res.json({ url: canvas.buildAuthorizeUrl(canvasConfig(), { state, scopes: CANVAS_SCOPES }) });
});
canvasRouter.get('/canvas/callback', teacher, async (req, res) => {
  const expected = req.session.financeCanvasOAuth;
  delete req.session.financeCanvasOAuth;
  await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  if (!expected || expected.puid !== req.user!.puid || expected.expires < Date.now() || req.query.state !== expected.state) {
    throw new CanvasError('Canvas authorization expired. Return to FinanceBot and connect again.');
  }
  if (typeof req.query.code !== 'string') return res.redirect(`${expected.returnTo}?canvas=cancelled`);
  const exchanged = await canvas.exchangeCodeForTokens(canvasConfig(), req.query.code);
  const old = await tokenStore.get(req.user!.puid);
  if (old && old.canvasUserId !== exchanged.canvasUserId) throw new CanvasError('Disconnect your previous Canvas account before connecting a different account.');
  const refreshToken = exchanged.refreshToken || old?.refreshToken;
  if (!refreshToken) throw new CanvasError('Canvas did not return a refresh token. Revoke FinanceBot in Canvas settings, then reconnect.');
  await tokenStore.set(req.user!.puid, { ...exchanged, refreshToken });
  res.redirect(expected.returnTo);
});
canvasRouter.post('/canvas/disconnect', teacher, async (req, res) => { await disconnectCanvas(req.user!.puid); res.sendStatus(204); });
canvasRouter.get('/canvas/courses', teacher, async (req, res) => { res.json(await listCanvasCourses(req.user!.puid)); });
const params = z.object({ courseId: z.string().regex(/^[a-f\d]{24}$/i) });
canvasRouter.use('/courses/:courseId/canvas', validate({ params }), ensureCourseInstructor());
canvasRouter.get('/courses/:courseId/canvas', async (req, res) => { res.json(await canvasLinkStatus(new ObjectId(String(req.params.courseId)))); });
canvasRouter.put('/courses/:courseId/canvas', validate({ body: z.object({ sourceIds: z.array(z.string().regex(/^\d+$/)).min(1).max(20), revision: z.string().nullable(), autoEnroll: z.boolean() }) }), async (req, res) => {
  await saveCanvasLink(new ObjectId(String(req.params.courseId)), req.user!.puid, req.body.sourceIds, req.body.revision, req.body.autoEnroll); res.sendStatus(204);
});
canvasRouter.post('/courses/:courseId/canvas/sync', async (req, res) => { await syncCanvasLink(new ObjectId(String(req.params.courseId))); res.sendStatus(204); });
canvasRouter.delete('/courses/:courseId/canvas', validate({ body: z.object({ revision: z.string() }) }), async (req, res) => {
  await unlinkCanvas(new ObjectId(String(req.params.courseId)), req.body.revision); res.sendStatus(204);
});
canvasRouter.get('/courses/:courseId/canvas/files', async (req, res) => { res.json(await listCanvasFiles(new ObjectId(String(req.params.courseId)), req.user!.puid)); });
canvasRouter.post('/courses/:courseId/canvas/import', validate({ body: z.object({ sourceId: z.string().regex(/^\d+$/), fileId: z.string().regex(/^\d+$/) }) }), async (req, res) => {
  res.status(201).json(await importCanvasFile(new ObjectId(String(req.params.courseId)), req.user!.puid, req.body.sourceId, req.body.fileId));
});
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  // Never pass toolkit payloads/OAuth error responses into application logs.
  res.status(error instanceof CanvasError ? error.status : 502).json({ error: error instanceof CanvasError ? error.message : 'Canvas request failed. Check your connection and Canvas permissions, then retry.' });
};
canvasRouter.use(errors);
