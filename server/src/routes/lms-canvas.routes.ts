import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { canvas, LmsError } from '@ubc/ubc-genai-toolkit-lms-integration';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { getCanvasConfig } from '../components/lms';
import { MAX_FILES_PER_UPLOAD } from '../services/materials.service';
import { getLink, importFiles, linkCourse, listImportableFiles, listTeacherCourses, unlinkCourse } from '../services/lms-canvas.service';

// Canvas LMS integration routes (Phase 6). Mounted under /api only when the
// four CANVAS_* variables are set (see app.ts); an unconfigured deployment
// 404s the whole family, which the client reads as "no Canvas here".
//
// Guard order on course-scoped routes (Tasks 2–4):
//   ensureApiAuthenticated() -> ensureCourseInstructor() -> canvas.requireAuth()
// A stored Canvas token proves a credential exists, not that its owner is an
// instructor of anything — that is FinanceBot's check, and it runs first.

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const linkBody = z.object({ canvasCourseId: z.string().min(1) });
const importBody = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(MAX_FILES_PER_UPLOAD) });

/** Same directory materials.routes writes multer uploads to. */
const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');

function notLinked(err: unknown, res: Response): boolean {
  if (err instanceof Error && err.message === 'not-linked') {
    res.status(400).json({ error: 'not-linked' });
    return true;
  }
  return false;
}

/** Public shape of a link: `linkedBy` (a PUID) stays server-side. */
function publicLink(link: { courseId: string; name: string; code: string; linkedAt: Date }) {
  return { courseId: link.courseId, name: link.name, code: link.code, linkedAt: link.linkedAt };
}

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

  const courseGuards = [validate({ params: courseIdParams }), ensureApiAuthenticated(), ensureCourseInstructor()];
  const withCanvas = canvas.requireAuth(config);

  /** GET /api/lms/canvas/courses -> [{ id, name, code }] the connected identity teaches. */
  router.get('/lms/canvas/courses', ensureApiAuthenticated(), withCanvas, async (req, res) => {
    try {
      res.json(await listTeacherCourses(req.canvasApi!));
    } catch (err) {
      if (!mapCanvasError(err, res)) throw err;
    }
  });

  router.get('/lms/canvas/courses/:courseId/link', ...courseGuards, async (req, res) => {
    const link = await getLink(new ObjectId(String(req.params.courseId)));
    res.json(link ? { linked: true, canvas: publicLink(link) } : { linked: false });
  });

  /** PUT link { canvasCourseId } — 403 not-teacher unless the id is in the teacher list. */
  router.put('/lms/canvas/courses/:courseId/link', ...courseGuards, validate({ body: linkBody }), withCanvas, async (req, res) => {
    try {
      const link = await linkCourse(req.canvasApi!, new ObjectId(String(req.params.courseId)), req.body.canvasCourseId, req.user!.puid);
      res.json({ linked: true, canvas: publicLink(link) });
    } catch (err) {
      if (err instanceof Error && err.message === 'not-teacher') {
        res.status(403).json({ error: 'not-teacher' });
        return;
      }
      if (!mapCanvasError(err, res)) throw err;
    }
  });

  /** GET files -> importable Canvas Files, with alreadyImported flagged. */
  router.get('/lms/canvas/courses/:courseId/files', ...courseGuards, withCanvas, async (req, res) => {
    try {
      res.json(await listImportableFiles(req.canvasApi!, new ObjectId(String(req.params.courseId))));
    } catch (err) {
      if (!notLinked(err, res) && !mapCanvasError(err, res)) throw err;
    }
  });

  /** POST files/import { fileIds } -> 201 { created, skipped, failed }. Per-file independent. */
  router.post('/lms/canvas/courses/:courseId/files/import', ...courseGuards, validate({ body: importBody }), withCanvas, async (req, res) => {
    try {
      const result = await importFiles(
        req.canvasApi!,
        new ObjectId(String(req.params.courseId)),
        req.body.fileIds,
        req.user!.puid,
        UPLOAD_DIR,
      );
      res.status(201).json({
        created: result.created.map(({ storagePath: _omit, ...rest }) => rest),
        skipped: result.skipped,
        failed: result.failed,
      });
    } catch (err) {
      if (!notLinked(err, res) && !mapCanvasError(err, res)) throw err;
    }
  });

  /** DELETE link — also clears the course's synced Canvas roster entries. */
  router.delete('/lms/canvas/courses/:courseId/link', ...courseGuards, async (req, res) => {
    await unlinkCourse(new ObjectId(String(req.params.courseId)));
    res.status(204).end();
  });

  return router;
}
