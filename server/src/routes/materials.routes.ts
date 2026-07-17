import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import multer from 'multer';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  createMaterials,
  createUrlMaterial,
  listMaterials,
  retryMaterial,
  assignMaterial,
  getMaterialCourseId,
} from '../services/materials.service';

// Material upload + async RAG ingestion endpoints (IN-S04/S05), exactly as
// specified in docs/api-contract.md's "Materials" section. `POST .../classification`
// (line 44 of the contract) is Task 7's, not this router's.
//
// Course-scoped routes (`:courseId` directly in the path) are guarded the same
// way as courses.routes.ts's Theme/LO create routes: `validate(params)` then
// `ensureCourseInstructor()` (which checks authentication itself). materialId-
// scoped routes (retry, assignments) have no `:courseId`, so they stash
// `res.locals.courseId` from the target material first — mirroring
// questions.routes.ts's `stashCourseIdFromQuestion` — with
// `ensureApiAuthenticated()` running BEFORE that DB lookup so a signed-out
// caller can't trigger it or use it as an existence oracle.
export const materialsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const materialIdParams = z.object({ materialId: objectIdParam });

const urlMaterialBody = z.object({ url: z.string().url() });

const assignmentsBody = z.object({
  assignments: z.array(z.object({ themeId: objectIdParam, loId: objectIdParam.optional() })),
});

// Disk storage under uploads/ (gitignored), capped at 50MB per the contract.
// The filename callback preserves the original extension: document-parsing's
// parseFile() (server/src/components/genai/document-parsing/index.ts) detects
// the input format from the file's extension on disk and has no way to
// specify the input type explicitly (it only accepts a file path) — a random
// name with no extension would make every pdf/docx/pptx/md ingest fail at job
// time. This mirrors routes/rag.routes.ts's own upload config, for the same
// documented reason.
//
// Resolved relative to this file (not process.cwd()) so uploads always land
// in the same place — repoRoot/uploads/ — regardless of the directory the
// process happens to be started from. `server/dist/routes` and
// `server/src/routes` are both exactly 3 levels below the repo root, so this
// path is correct for both the compiled output and ts-jest's direct
// compilation of the source.
const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');

// multer's diskStorage does not create `destination` itself — on a fresh
// clone/CI, uploads/ is gitignored and won't exist yet, so the first upload
// would 500 with ENOENT without this. One-time, synchronous, cheap enough to
// do at module load.
mkdirSync(UPLOAD_DIR, { recursive: true });

// Per-request cap on the number of files a single multipart upload may
// contain (I5) — multer has no default, so an unbounded `files[]` field is a
// resource-exhaustion vector (disk + one enqueued job per file) with no limit
// today.
const MAX_FILES_PER_UPLOAD = 20;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: MAX_FILES_PER_UPLOAD },
});

/**
 * Resolve `res.locals.courseId` from the material a child route targets,
 * before `ensureCourseInstructor()` runs — see courses.routes.ts's
 * `stashCourseIdFromTheme` and questions.routes.ts's
 * `stashCourseIdFromQuestion`, whose 404-before-guard convention this
 * mirrors.
 */
function stashCourseIdFromMaterial(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    getMaterialCourseId(new ObjectId(String(req.params.materialId)))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'material-not-found' });
          return;
        }
        res.locals.courseId = courseId.toString();
        next();
      })
      .catch(next);
  };
}

/**
 * POST /api/courses/:courseId/materials -> 201 [Material] (status
 * 'processing'). Instructor-only. Accepts EITHER a multipart upload (field
 * `files`, one Material per file) OR a JSON `{ url }` body (one URL
 * Material) — the two are mutually exclusive request shapes, so the body
 * can't be validated by a single static `validate({ body })` schema the way
 * other routes are. `upload.array('files')` only intercepts multipart
 * requests (it no-ops when Content-Type isn't multipart/form-data, letting
 * the already-mounted express.json() body through untouched), and the URL
 * body is validated inline below with the same zod-issue response shape
 * `validate()` produces.
 */
materialsRouter.post(
  '/courses/:courseId/materials',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  upload.array('files'),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    if (files.length > 0) {
      try {
        const materials = await createMaterials(courseId, files);
        res.status(201).json(materials);
      } catch (err) {
        // Only clean up when NO material could have been persisted (I4).
        // createMaterials validates every file's format BEFORE writing
        // anything, so an `unsupported-format:` rejection is the one error
        // that is still fully atomic — no material exists yet, so every
        // uploaded file here is orphaned and safe to delete. Any OTHER
        // failure (e.g. insertOne/enqueueJob throwing mid-loop) may have
        // already persisted materials 1..k pointing at these files'
        // storagePath — deleting them then would leave those materials
        // permanently unrecoverable (retryMaterial would ENOENT forever).
        if (err instanceof Error && err.message.startsWith('unsupported-format:')) {
          await Promise.all(files.map((file) => fs.rm(file.path, { force: true })));
        }
        throw err;
      }
      return;
    }

    const parsed = urlMaterialBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request.',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
      return;
    }
    res.status(201).json([await createUrlMaterial(courseId, parsed.data.url)]);
  },
);

/** GET /api/courses/:courseId/materials -> [Material]. Instructor-only. */
materialsRouter.get(
  '/courses/:courseId/materials',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await listMaterials(new ObjectId(String(req.params.courseId))));
  },
);

/** POST /api/materials/:materialId/retry -> Material. Instructor-only. */
materialsRouter.post(
  '/materials/:materialId/retry',
  validate({ params: materialIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromMaterial(),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await retryMaterial(new ObjectId(String(req.params.materialId))));
  },
);

/** PUT /api/materials/:materialId/assignments { assignments } -> Material.
 * Instructor-only. IN-S05: replaces assignments; never deletes the material
 * or its questions. */
materialsRouter.put(
  '/materials/:materialId/assignments',
  validate({ params: materialIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromMaterial(),
  ensureCourseInstructor(),
  validate({ body: assignmentsBody }),
  async (req, res) => {
    const materialId = new ObjectId(String(req.params.materialId));
    const { assignments } = req.body as z.infer<typeof assignmentsBody>;
    const material = await assignMaterial(
      materialId,
      assignments.map((a) => ({
        themeId: new ObjectId(a.themeId),
        ...(a.loId ? { loId: new ObjectId(a.loId) } : {}),
      })),
    );
    res.json(material);
  },
);

// --- Error normalization -----------------------------------------------------

// Domain errors thrown by materials.service (plain `Error(message)`, per its
// contract) mapped to HTTP status here, matching courses.routes.ts's and
// questions.routes.ts's router-scoped normalizer pattern.
const MATERIAL_ERROR_STATUS: Record<string, number> = {
  'material-not-found': 404,
};

materialsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  // multer's errors carry a `code` (e.g. `LIMIT_FILE_SIZE`), not a `status` —
  // left unhandled, the central errorHandler defaults them to 500, so an
  // over-limit upload was returning "500 File too large" instead of a 4xx
  // (I5). LIMIT_FILE_SIZE is the client sending too much data -> 413; every
  // other MulterError (bad field name, too many files via MAX_FILES_PER_UPLOAD,
  // etc.) is a malformed request -> 400.
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    if (Object.hasOwn(MATERIAL_ERROR_STATUS, err.message)) {
      res.status(MATERIAL_ERROR_STATUS[err.message]).json({ error: err.message });
      return;
    }
    if (err.message.startsWith('unsupported-format:')) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
  next(err);
});
