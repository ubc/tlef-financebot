import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  listTemplates,
  saveTemplate,
  type ExamTemplateInput,
} from '../services/exam-templates.service';

export const examsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectIdParam });
const templateParams = z.object({
  courseId: objectIdParam,
  kind: z.enum(['midterm', 'final']),
});
const themeConfig = z.object({
  themeId: objectIdParam,
  mcqCount: z.number().int().min(0),
  tfCount: z.number().int().min(0),
  pointsPerQuestion: z.number().positive(),
}).refine((theme) => theme.mcqCount + theme.tfCount > 0, {
  message: 'Each Theme must request at least one question.',
});
const templateBody = z.object({
  themes: z.array(themeConfig).min(1),
  timeLimitMinutes: z.number().int().positive().optional(),
  availabilityStart: z.string().datetime(),
  availabilityEnd: z.string().datetime(),
  loBreakdown: z.boolean(),
}).refine(
  (body) => new Date(body.availabilityEnd) >= new Date(body.availabilityStart),
  { message: 'Availability end must be on or after its start.', path: ['availabilityEnd'] },
);

examsRouter.get(
  '/courses/:courseId/exam-templates',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await listTemplates(new ObjectId(String(req.params.courseId))));
  },
);

examsRouter.put(
  '/courses/:courseId/exam-templates/:kind',
  validate({ params: templateParams }),
  ensureCourseInstructor(),
  validate({ body: templateBody }),
  async (req, res) => {
    const params = req.params as z.infer<typeof templateParams>;
    const body = req.body as z.infer<typeof templateBody>;
    const input: ExamTemplateInput = {
      kind: params.kind,
      themes: body.themes.map((theme) => ({
        themeId: new ObjectId(theme.themeId),
        mcqCount: theme.mcqCount,
        tfCount: theme.tfCount,
        pointsPerQuestion: theme.pointsPerQuestion,
      })),
      ...(body.timeLimitMinutes !== undefined
        ? { timeLimitMinutes: body.timeLimitMinutes }
        : {}),
      availabilityStart: new Date(body.availabilityStart),
      availabilityEnd: new Date(body.availabilityEnd),
      loBreakdown: body.loBreakdown,
    };
    res.json(await saveTemplate(new ObjectId(params.courseId), input));
  },
);

const BAD_REQUEST_ERRORS = new Set([
  'exam-template-invalid-kind',
  'exam-template-themes-required',
  'exam-template-invalid-counts',
  'exam-template-invalid-points',
  'exam-template-duplicate-theme',
  'exam-template-invalid-time-limit',
  'exam-template-invalid-availability',
  'exam-template-invalid-lo-breakdown',
  'exam-template-theme-not-in-course',
]);

examsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && BAD_REQUEST_ERRORS.has(err.message)) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});
