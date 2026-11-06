import { structureConsolidationProposalSchema } from '../services/structure-consolidation.service';
import { enqueueStructureConsolidationProposal, enqueueStructureConsolidationReview, getStructureConsolidationView } from '../services/structure-generation.service';
import { enqueueStructureGeneration, structureOptionsSchema, enqueueStructureOutlineRepair, enqueueStructureOutlineCoverageRepair,
  getStructureOutlineRepairView } from '../services/structure-generation.service';
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import multer from 'multer';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor, ensureCourseTeachingMember } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  createMaterials,
  createUrlMaterial,
  getMaterialWorkspaceDetail,
  listMaterials,
  listTrashedMaterials,
  retryMaterial,
  restoreMaterial,
  trashMaterial,
  assignMaterial,
  getMaterialCourseId,
  updateMaterialKind,
} from '../services/materials.service';
import {
  applyGeneratedHierarchy,
  resolveClassification,
  suggestHierarchy,
} from '../services/classification.service';
import {
  acceptMaterialUploadBatch, claimMaterialUploadBatch, prepareMaterialUploadBatch,
  prepareUploadBatchSchema, readMaterialUploadBatch, rejectMaterialUploadBatch,
} from '../services/material-upload-batches.service';
import { resolveSourceSelection } from '../services/source-readiness.service';
import { openVerifiedMaterialPdfSource, readMaterialSourceProvenance } from '../services/material-source-provenance.service';

// Material upload + async RAG ingestion endpoints (IN-S04/S05), plus Task 7's
// IN-S06 classification accept/reject (`POST .../classification`, in the
// contract) and AI-suggested hierarchy (`GET .../suggest-hierarchy`, a Task 7
// contract addition).
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
const courseMaterialParams = z.object({ courseId: objectIdParam, materialId: objectIdParam });
const courseBatchParams = z.object({ courseId: objectIdParam, batchId: objectIdParam });
const courseStructureRunParams = z.object({ courseId: objectIdParam, runId: objectIdParam });
const structureRepairQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(10).optional() }).strict();
const structureRepairBody = z.discriminatedUnion('version', [
  z.object({ version: z.literal('wording-only-outline-repair-v1'), targetIds: z.array(z.string().regex(/^L[1-9]\d*$/)).min(1).max(2) }).strict(),
  z.object({ version: z.literal('coverage-wording-outline-repair-v1'), targets: z.array(z.object({
    id: z.string().regex(/^L[1-9]\d*$/), evidenceIds: z.array(z.string().regex(/^E[1-9]\d*$/)).min(1).max(8),
  }).strict()).min(1).max(2) }).strict(),
]).superRefine((body, context) => {
  const ids = body.version === 'wording-only-outline-repair-v1' ? body.targetIds : body.targets.map(row => row.id);
  const points = body.version === 'coverage-wording-outline-repair-v1' ? body.targets.flatMap(row => row.evidenceIds) : [];
  if (new Set(ids).size !== ids.length || new Set(points).size !== points.length) context.addIssue({ code: 'custom', message: 'Repair targets and requested evidence IDs must be unique.' });
});
const materialKind = z.enum([
  'lecture',
  'reading',
  'assignment',
  'assessment',
  'solution',
  'reference',
  'other',
]);
const materialMetadataBody = z.object({ kind: materialKind, expectedRevision: z.number().int().nonnegative() });

function publicMaterial<T extends { storagePath?: string; rawTextStoragePath?: string }>(material: T): Omit<T, 'storagePath' | 'rawTextStoragePath'> {
  const safe = { ...material };
  delete safe.storagePath;
  delete safe.rawTextStoragePath;
  return safe;
}

const urlMaterialBody = z.object({ url: z.string().url() });

const assignmentsBody = z.object({
  expectedRevision: z.number().int().nonnegative(),
  assignments: z.array(z.object({ themeId: objectIdParam, loId: objectIdParam.optional() })),
});

const classificationBody = z.object({ action: z.enum(['accept', 'reject']), expectedRevision: z.number().int().nonnegative() });
const applySuggestedHierarchyBody = z.object({
  runId: objectIdParam,
  themes: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        los: z.array(
          z.object({
            name: z.string().trim().min(1),
            sourceThemeIndex: z.number().int().nonnegative(),
            sourceLoIndex: z.number().int().nonnegative(),
            materialIds: z.array(objectIdParam),
          }),
        ).min(1),
      }),
    )
    .min(1),
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

/** Versioned manifest preparation precedes multipart parsing/admission. */
materialsRouter.post('/courses/:courseId/material-upload-batches', validate({ params: courseIdParams }),
  ensureCourseInstructor(), validate({ body: prepareUploadBatchSchema }), async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const body = req.body as z.infer<typeof prepareUploadBatchSchema>;
    const batch = await prepareMaterialUploadBatch(courseId, req.user!.puid, body.requestId, body.files);
    res.status(201).json(await readMaterialUploadBatch(courseId, batch._id, req.user!.puid));
  });

materialsRouter.get('/courses/:courseId/material-upload-batches/:batchId', validate({ params: courseBatchParams }),
  ensureCourseInstructor(), async (req, res) => {
    res.json(await readMaterialUploadBatch(new ObjectId(String(req.params.courseId)), new ObjectId(String(req.params.batchId)), req.user!.puid));
  });

materialsRouter.post('/courses/:courseId/material-upload-batches/:batchId/files', validate({ params: courseBatchParams }),
  ensureCourseInstructor(), async (req, res, next) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const batchId = new ObjectId(String(req.params.batchId));
    const { owner } = await claimMaterialUploadBatch(courseId, batchId, req.user!.puid);
    if (!owner) { res.json(await readMaterialUploadBatch(courseId, batchId, req.user!.puid)); return; }
    upload.array('files')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) throw uploadError;
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        try {
          await acceptMaterialUploadBatch(courseId, batchId, req.user!.puid, owner, files);
        } catch (error) {
          if (error instanceof Error && (error.message.startsWith('unsupported-format:') || error.message === 'material-upload-manifest-mismatch')) {
            await Promise.all(files.map((file) => fs.rm(file.path, { force: true })));
          }
          throw error;
        }
        res.status(201).json(await readMaterialUploadBatch(courseId, batchId, req.user!.puid));
      })().catch(async (error: unknown) => {
        await rejectMaterialUploadBatch(courseId, batchId, owner, error instanceof Error ? error.message : 'material-upload-failed').catch(() => undefined);
        next(error);
      });
    });
    req.once('aborted', () => { void rejectMaterialUploadBatch(courseId, batchId, owner, 'material-upload-interrupted').catch(() => undefined); });
  });

/** Readiness is computed from indexed manifests and actual chunks, never just
 * the display status or the subset that happened to finish first. */
materialsRouter.post('/courses/:courseId/source-readiness', validate({ params: courseIdParams }),
  ensureCourseInstructor(), validate({ body: z.object({ sourceBatchId: objectIdParam.optional(), materialIds: z.array(objectIdParam).min(1).max(100).optional() }) }),
  async (req, res) => { res.json(await resolveSourceSelection(new ObjectId(String(req.params.courseId)), req.body)); });

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
        const materials = await createMaterials(courseId, files, req.user!.puid);
        res.status(201).json(materials.map(publicMaterial));
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
    res.status(201).json([publicMaterial(await createUrlMaterial(courseId, parsed.data.url, req.user!.puid))]);
  },
);

/** GET /api/courses/:courseId/materials -> [Material]. Teaching-team read. */
materialsRouter.get(
  '/courses/:courseId/materials',
  validate({ params: courseIdParams }),
  ensureCourseTeachingMember(),
  async (req, res) => {
    res.json((await listMaterials(new ObjectId(String(req.params.courseId)))).map(publicMaterial));
  },
);

/** GET active material, persisted chunks, AI metadata, and provenance. */
materialsRouter.get(
  '/courses/:courseId/materials/:materialId/workspace',
  validate({ params: courseMaterialParams }),
  ensureCourseTeachingMember(),
  async (req, res) => {
    const detail = await getMaterialWorkspaceDetail(
      new ObjectId(String(req.params.courseId)),
      new ObjectId(String(req.params.materialId)),
    );
    res.json({ ...detail, material: publicMaterial(detail.material) });
  },
);

/** Stream the original source only after course authorization and a realpath
 * containment check. URL sources redirect only to http(s). */
materialsRouter.get(
  '/courses/:courseId/materials/:materialId/source',
  validate({ params: courseMaterialParams, query: z.object({ provenanceId: objectIdParam.optional() }) }),
  ensureCourseTeachingMember(),
  async (req, res, next) => {
    const { material } = await getMaterialWorkspaceDetail(
      new ObjectId(String(req.params.courseId)),
      new ObjectId(String(req.params.materialId)),
    );
    const provenanceId = req.query.provenanceId;
    if (typeof provenanceId === 'string') {
      const record = await readMaterialSourceProvenance(new ObjectId(String(req.params.courseId)), new ObjectId(String(req.params.materialId)), new ObjectId(provenanceId));
      if (!record || material.format !== 'pdf' || !material.storagePath) throw new Error('material-source-unavailable');
      const [base, source] = await Promise.all([fs.realpath(UPLOAD_DIR), fs.realpath(material.storagePath)]);
      if (!source.startsWith(`${base}${path.sep}`)) throw new Error('material-source-unavailable');
      let handle;
      try { handle = await openVerifiedMaterialPdfSource(source, record.receipt); }
      catch { throw new Error('material-source-unavailable'); }
      res.type('application/pdf');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(material.name)}`);
      const stream = handle.createReadStream({ start: 0, autoClose: true });
      res.once('close', () => stream.destroy());
      stream.once('error', next);
      stream.pipe(res);
      return;
    }
    if (material.format === 'url' && material.sourceUrl) {
      const source = new URL(material.sourceUrl);
      if (source.protocol !== 'http:' && source.protocol !== 'https:') throw new Error('material-source-unavailable');
      res.redirect(source.toString());
      return;
    }
    if (!material.storagePath) throw new Error('material-source-unavailable');
    const [base, source] = await Promise.all([fs.realpath(UPLOAD_DIR), fs.realpath(material.storagePath)]);
    if (source !== base && !source.startsWith(`${base}${path.sep}`)) throw new Error('material-source-unavailable');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(material.name)}`);
    res.sendFile(source, (error) => {
      if (error) next(error);
    });
  },
);

materialsRouter.get(
  '/courses/:courseId/materials-trash',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json((await listTrashedMaterials(new ObjectId(String(req.params.courseId)))).map(publicMaterial));
  },
);

materialsRouter.delete(
  '/courses/:courseId/materials/:materialId',
  validate({ params: courseMaterialParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(
      publicMaterial(
        await trashMaterial(
          new ObjectId(String(req.params.courseId)),
          new ObjectId(String(req.params.materialId)),
          req.user!.puid,
        ),
      ),
    );
  },
);

materialsRouter.post(
  '/courses/:courseId/materials/:materialId/restore',
  validate({ params: courseMaterialParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(
      publicMaterial(
        await restoreMaterial(
          new ObjectId(String(req.params.courseId)),
          new ObjectId(String(req.params.materialId)),
          req.user!.puid,
        ),
      ),
    );
  },
);

/** PATCH course-scoped material metadata so cross-course intent is explicit. */
materialsRouter.patch(
  '/courses/:courseId/materials/:materialId',
  validate({ params: courseMaterialParams }),
  ensureCourseInstructor(),
  validate({ body: materialMetadataBody }),
  async (req, res) => {
    res.json(
      publicMaterial(await updateMaterialKind(
        new ObjectId(String(req.params.courseId)),
        new ObjectId(String(req.params.materialId)),
        (req.body as z.infer<typeof materialMetadataBody>).kind,
        (req.body as z.infer<typeof materialMetadataBody>).expectedRevision,
      )),
    );
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
    res.json(publicMaterial(await retryMaterial(new ObjectId(String(req.params.materialId)), req.user!.puid)));
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
    const { assignments, expectedRevision } = req.body as z.infer<typeof assignmentsBody>;
    const material = await assignMaterial(
      materialId,
      assignments.map((a) => ({
        themeId: new ObjectId(a.themeId),
        ...(a.loId ? { loId: new ObjectId(a.loId) } : {}),
      })),
      expectedRevision,
    );
    res.json(publicMaterial(material));
  },
);

/**
 * POST /api/materials/:materialId/classification { action: 'accept' | 'reject' }
 * -> Material (IN-S06). Instructor-only. Accept applies the material's pending
 * LLM classificationSuggestion to its assignments and clears it; reject clears
 * the suggestion. materialId-scoped, so it stashes res.locals.courseId first —
 * same guard order as retry/assignments above.
 */
materialsRouter.post(
  '/materials/:materialId/classification',
  validate({ params: materialIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromMaterial(),
  ensureCourseInstructor(),
  validate({ body: classificationBody }),
  async (req, res) => {
    const materialId = new ObjectId(String(req.params.materialId));
    const { action, expectedRevision } = req.body as z.infer<typeof classificationBody>;
    res.json(publicMaterial(await resolveClassification(materialId, action, expectedRevision)));
  },
);

/**
 * GET /api/courses/:courseId/suggest-hierarchy
 * -> { themes: [{ name, los }], assignments: [...] }
 * (IN-S06, slip candidate #3). Instructor-only: computes an
 * AI-suggested Theme/LO outline and per-LO source mappings from the course's
 * ingested materials and retains a durable run/source receipt for guarded Apply.
 */
materialsRouter.get(
  '/courses/:courseId/suggest-hierarchy',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await suggestHierarchy(new ObjectId(String(req.params.courseId)), req.user!.puid));
  },
);

/** Persisted generation uses the existing course SSE stream. */
materialsRouter.post(
  '/courses/:courseId/structure-generation',
  validate({ params: courseIdParams }), ensureCourseInstructor(),
  validate({ body: structureOptionsSchema }),
  async (req, res) => {
    const run = await enqueueStructureGeneration(new ObjectId(String(req.params.courseId)), req.user!.puid, req.body);
    res.status(202).json({ runId: run._id.toHexString() });
  },
);

/** Read-only bounded projection, including parent recovery for a failed child.
 * This endpoint never queues work or calls a model. */
materialsRouter.get('/courses/:courseId/structure-generation/:runId/repair',
  validate({ params: courseStructureRunParams }), ensureCourseInstructor(), validate({ query: structureRepairQuery }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getStructureOutlineRepairView(new ObjectId(String(req.params.courseId)), new ObjectId(String(req.params.runId)),
      req.query as unknown as z.infer<typeof structureRepairQuery>));
  });

/** Explicit teacher request. Models, budgets, preservation and verdicts remain
 * server-owned, and a successful child still requires separately reviewed Apply. */
materialsRouter.post('/courses/:courseId/structure-generation/:runId/repair',
  validate({ params: courseStructureRunParams }), ensureCourseInstructor(), validate({ body: structureRepairBody }), async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId)), parentRunId = new ObjectId(String(req.params.runId));
    const body = req.body as z.infer<typeof structureRepairBody>;
    const run = body.version === 'coverage-wording-outline-repair-v1'
      ? await enqueueStructureOutlineCoverageRepair(courseId, parentRunId, req.user!.puid, body.targets)
      : await enqueueStructureOutlineRepair(courseId, parentRunId, req.user!.puid, body.targetIds);
    res.status(202).json({ runId: run._id.toHexString(), parentRunId: parentRunId.toHexString() });
  });

/** Explicit prospective consolidation; no browser model, budget or verdict fields. */
materialsRouter.get('/courses/:courseId/structure-generation/:runId/consolidation',
  validate({ params: courseStructureRunParams }), ensureCourseInstructor(), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getStructureConsolidationView(new ObjectId(String(req.params.courseId)), new ObjectId(String(req.params.runId))));
  });
materialsRouter.post('/courses/:courseId/structure-generation/:runId/consolidation/propose',
  validate({ params: courseStructureRunParams }), ensureCourseInstructor(),
  validate({ body: z.object({ version: z.literal('durable-outline-consolidation-v1'),
    selectedIds: z.array(z.string().regex(/^L[1-9]\d*$/)).min(2).max(4).optional(), proposal: structureConsolidationProposalSchema.optional() }).strict() }),
  async (req, res) => {
    const run = await enqueueStructureConsolidationProposal(new ObjectId(String(req.params.courseId)), new ObjectId(String(req.params.runId)), req.user!.puid, req.body.selectedIds, req.body.proposal);
    res.status(202).json({ runId: run._id.toHexString() });
  });
materialsRouter.post('/courses/:courseId/structure-generation/:runId/consolidation/review',
  validate({ params: courseStructureRunParams }), ensureCourseInstructor(),
  validate({ body: z.object({ version: z.literal('durable-outline-consolidation-v1'), expectedRevision: z.number().int().min(0),
    expectedProposalHash: z.string().regex(/^[a-f0-9]{64}$/), proposal: structureConsolidationProposalSchema.optional() }).strict() }),
  async (req, res) => {
    const run = await enqueueStructureConsolidationReview(new ObjectId(String(req.params.courseId)), new ObjectId(String(req.params.runId)), req.user!.puid,
      req.body.expectedRevision, req.body.expectedProposalHash, req.body.proposal);
    res.status(202).json({ runId: run._id.toHexString() });
  });

/**
 * POST /api/courses/:courseId/apply-suggested-hierarchy
 * Creates the reviewed Topic/LO subset and automatically merges the AI source
 * mappings into each material's assignments. Existing assignments are kept.
 */
materialsRouter.post(
  '/courses/:courseId/apply-suggested-hierarchy',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  validate({ body: applySuggestedHierarchyBody }),
  async (req, res) => {
    res.status(201).json(
      await applyGeneratedHierarchy(
        new ObjectId(String(req.params.courseId)),
        req.body as z.infer<typeof applySuggestedHierarchyBody>,
      ),
    );
  },
);

// --- Error normalization -----------------------------------------------------

// Domain errors thrown by materials.service (plain `Error(message)`, per its
// contract) mapped to HTTP status here, matching courses.routes.ts's and
// questions.routes.ts's router-scoped normalizer pattern.
const MATERIAL_ERROR_STATUS: Record<string, number> = {
  'structure-no-materials': 409,
  'structure-material-unavailable': 409,
  'structure-chunks-missing': 409,
  'structure-corpus-too-large': 413,
  'structure-enqueue-failed': 503,
  'material-not-found': 404,
  'material-retry-conflict': 409,
  'material-restore-conflict': 409,
  'material-source-unavailable': 404,
  'no-classification-suggestion': 400, // accept with nothing to accept (IN-S06)
  'suggested-hierarchy-invalid': 400,
  'suggested-hierarchy-material-not-found': 409,
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
    if ('report' in err && typeof (err as { status?: unknown }).status === 'number') {
      res.status((err as unknown as { status: number }).status).json({ error: err.message, report: err.report });
      return;
    }
    if (Object.hasOwn(MATERIAL_ERROR_STATUS, err.message)) {
      res.status(MATERIAL_ERROR_STATUS[err.message]).json({ error: err.message });
      return;
    }
    if (err.message.startsWith('structure-consolidation-') || err.message.startsWith('structure-repair-') || err.message.startsWith('structure-review-') ||
      err.message === 'authoring-coordinated-commit-unavailable') {
      const status = ['structure-repair-view-run-unavailable', 'structure-repair-view-parent-unavailable'].includes(err.message) ? 404
        : err.message === 'structure-repair-proposal-input-cap' ? 413
          : err.message === 'structure-repair-view-page-invalid' ? 400
            : err.message === 'structure-consolidation-enqueue-failed' || err.message === 'structure-repair-enqueue-failed' || err.message === 'authoring-coordinated-commit-unavailable' ? 503 : 409;
      res.status(status).json({ error: err.message });
      return;
    }
    if (err.message.startsWith('unsupported-format:')) {
      res.status(400).json({ error: err.message });
      return;
    }
  }
  next(err);
});
