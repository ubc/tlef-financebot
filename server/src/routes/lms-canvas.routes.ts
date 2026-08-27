import { Router, type Request, type Response } from 'express';
import { canvas, LmsError } from '@ubc/ubc-genai-toolkit-lms-integration';
import { ensureApiAuthenticated } from '../components/auth';
import { getCanvasConfig } from '../components/lms';

// Canvas LMS integration routes (Phase 6). Mounted under /api only when the
// four CANVAS_* variables are set (see app.ts); an unconfigured deployment
// 404s the whole family, which the client reads as "no Canvas here".
//
// Guard order on course-scoped routes (Tasks 2–4):
//   ensureApiAuthenticated() -> ensureCourseInstructor() -> canvas.requireAuth()
// A stored Canvas token proves a credential exists, not that its owner is an
// instructor of anything — that is FinanceBot's check, and it runs first.

/**
 * Map package errors to fixed response codes. Bodies never carry
 * `err.message`, `raw`, headers, or a PUID; the log line is class + status.
 */
export function mapCanvasError(err: unknown, res: Response): boolean {
  if (err instanceof canvas.CanvasGradeExportError && err.reason === 'roster-coverage') {
    res.status(409).json({ error: 'roster-coverage' });
    return true;
  }
  if (err instanceof canvas.CanvasApiError) {
    console.error(`[lms-canvas] CanvasApiError ${err.statusCode}`);
    if (err.statusCode === 401) {
      res.status(401).json({ error: 'canvas-reconnect' });
      return true;
    }
    if (err.statusCode === 403) {
      res.status(403).json({ error: 'canvas-forbidden' });
      return true;
    }
    res.status(502).json({ error: 'canvas-unavailable' });
    return true;
  }
  if (err instanceof LmsError) {
    console.error(`[lms-canvas] ${err.constructor.name}`);
    res.status(502).json({ error: 'canvas-unavailable' });
    return true;
  }
  return false;
}

export function createLmsCanvasRouter(): Router {
  const config = getCanvasConfig();
  const router = Router();

  // Connecting is per person, not per course: no course guard here.
  router.use('/lms/canvas/auth', ensureApiAuthenticated(), canvas.createAuthRouter(config));

  /**
   * GET /api/lms/canvas/status -> 200 { connected }. Deliberately not behind
   * canvas.requireAuth: "configured, not connected" is a state the Settings
   * card renders, not an error.
   */
  router.get('/lms/canvas/status', ensureApiAuthenticated(), async (req: Request, res: Response) => {
    const tokens = await config.tokenStore.get(req.user!.puid);
    res.json({ connected: tokens !== null });
  });

  return router;
}
