import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  commitImport,
  migrateScript,
  parseImport,
  previewScriptMigration,
  type ImportFormat,
} from '../services/import.service';

export const importRouter = Router();

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectId });
const optionRole = z.enum([
  'correct',
  'common-misconception',
  'partially-correct',
  'clearly-wrong',
]);
const candidate = z.object({
  type: z.enum(['mcq', 'true-false', 'other']),
  stem: z.string(),
  options: z.array(
    z.object({
      key: z.string(),
      text: z.string(),
      role: optionRole.optional(),
      explanation: z.string().optional(),
    }),
  ),
  correctKey: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  parameterizable: z.boolean(),
});
const commitBody = z.object({
  candidates: z.array(candidate).min(1).max(1000),
  format: z.enum(['csv', 'json', 'qti']).optional(),
  sourceName: z.string().trim().min(1).max(255).optional(),
  themeId: objectId.optional(),
  loId: objectId.optional(),
});
const scriptOption = z.object({
  key: z.string().min(1).max(10),
  text: z.string().min(1).max(20_000),
  role: optionRole.optional(),
  explanation: z.string().max(20_000).optional(),
});
const scriptMigrationBody = z.object({
  type: z.enum(['mcq', 'true-false']),
  stem: z.string().min(1).max(20_000),
  options: z.array(scriptOption).min(2).max(4),
  correctKey: z.string().min(1).max(10),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  script: z.string().min(1).max(100_000),
  themeId: objectId.optional(),
  loId: objectId.optional(),
  sourceName: z.string().trim().min(1).max(255).optional(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function formatFromFilename(filename: string): ImportFormat | undefined {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.csv') return 'csv';
  if (extension === '.json') return 'json';
  if (extension === '.xml' || extension === '.qti') return 'qti';
  return undefined;
}

/** POST /api/courses/:courseId/import/preview (multipart field `file`). */
importRouter.post(
  '/courses/:courseId/import/preview',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  upload.single('file'),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'import-file-required' });
      return;
    }
    const format = formatFromFilename(req.file.originalname);
    if (!format) {
      const extension = path.extname(req.file.originalname).toLowerCase() || '(none)';
      res.status(400).json({ error: `unsupported-import-format:${extension}` });
      return;
    }
    res.json({ format, ...parseImport(format, req.file.buffer.toString('utf8')) });
  },
);

/** POST /api/courses/:courseId/import/commit -> Draft questions only. */
importRouter.post(
  '/courses/:courseId/import/commit',
  validate({ params: courseParams, body: commitBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    const { candidates, themeId, loId, format, sourceName } = req.body as z.infer<typeof commitBody>;
    res.status(201).json(
      await commitImport(new ObjectId(String(req.params.courseId)), candidates, {
        ...(themeId ? { themeId: new ObjectId(themeId) } : {}),
        ...(loId ? { loId: new ObjectId(loId) } : {}),
        ...(format ? { format } : {}),
        ...(sourceName ? { sourceName } : {}),
        byPuid: req.user!.puid,
      }),
    );
  },
);

/** POST /api/courses/:courseId/import/script/preview -> sandboxed review data. */
importRouter.post(
  '/courses/:courseId/import/script/preview',
  validate({ params: courseParams, body: scriptMigrationBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(
      await previewScriptMigration(req.body as z.infer<typeof scriptMigrationBody>),
    );
  },
);

/** POST /api/courses/:courseId/import/script/commit -> one parameterized Draft. */
importRouter.post(
  '/courses/:courseId/import/script/commit',
  validate({ params: courseParams, body: scriptMigrationBody }),
  ensureCourseInstructor(),
  async (req, res) => {
    const { themeId, loId, ...input } = req.body as z.infer<typeof scriptMigrationBody>;
    const result = await migrateScript(new ObjectId(String(req.params.courseId)), {
      ...input,
      ...(themeId ? { themeId: new ObjectId(themeId) } : {}),
      ...(loId ? { loId: new ObjectId(loId) } : {}),
      byPuid: req.user!.puid,
    });
    res.status(result.questionId ? 201 : 200).json({
      ...result,
      ...(result.questionId ? { questionId: result.questionId.toHexString() } : {}),
    });
  },
);

// Normalize upload resource-limit errors into the route's inline 400 contract.
importRouter.use(
  (error: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: `invalid-import-upload:${error.code}` });
      return;
    }
    next(error);
  },
);
