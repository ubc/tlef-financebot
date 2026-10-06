import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import { clearPeopleImport, commitPeopleImport, getPeopleImport, previewPeopleChanges } from '../services/people-import.service';

export const peopleImportRouter = Router();
const params = z.object({ courseId: z.string().regex(/^[0-9a-f]{24}$/) });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const revision = z.coerce.number().int().nonnegative();
const commitBody = z.object({ expectedRevision: revision,
  confirmedTeachingAccess: z.enum(['true', 'false']).default('false').transform(v => v === 'true') });

peopleImportRouter.get('/courses/:courseId/people-import', ensureApiAuthenticated(), validate({ params }), ensureCourseInstructor(), async (req, res) => {
  res.json(await getPeopleImport(new ObjectId(String(req.params.courseId)), req.user!));
});

peopleImportRouter.post('/courses/:courseId/people-import/preview', ensureApiAuthenticated(), validate({ params }), ensureCourseInstructor(), upload.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'CSV file required.' }); return; }
  res.json(await previewPeopleChanges(new ObjectId(String(req.params.courseId)), req.user!, req.file.buffer.toString('utf8')));
});

peopleImportRouter.put('/courses/:courseId/people-import', ensureApiAuthenticated(), validate({ params }), ensureCourseInstructor(), upload.single('file'), validate({ body: commitBody }), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'CSV file required.' }); return; }
  res.json(await commitPeopleImport(new ObjectId(String(req.params.courseId)), req.user!, req.file.buffer.toString('utf8'), req.file.originalname,
    req.body.expectedRevision as number, req.body.confirmedTeachingAccess as boolean));
});

peopleImportRouter.delete('/courses/:courseId/people-import', ensureApiAuthenticated(), validate({ params, body: z.object({ expectedRevision: z.number().int().nonnegative() }) }), ensureCourseInstructor(), async (req, res) => {
  res.json(await clearPeopleImport(new ObjectId(String(req.params.courseId)), req.user!, req.body.expectedRevision as number));
});

peopleImportRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) { res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'CSV must be smaller than 2 MB.' : 'Upload one CSV file.' }); return; }
  next(error);
});
