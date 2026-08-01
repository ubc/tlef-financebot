import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor, ensureCourseStudent } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  activeTemplates,
  listTemplates,
  saveTemplate,
  type ExamTemplateInput,
} from '../services/exam-templates.service';
import {
  answerQuestion,
  examState,
  getExamAttemptCourseId,
  startExam,
  submitExam,
} from '../services/exam-attempts.service';

export const examsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectIdParam });
const templateParams = z.object({
  courseId: objectIdParam,
  kind: z.enum(['midterm', 'final']),
});
const startParams = z.object({ courseId: objectIdParam, templateId: objectIdParam });
const attemptParams = z.object({ attemptId: objectIdParam });
const answerParams = z.object({
  attemptId: objectIdParam,
  index: z.coerce.number().int().min(0),
});
const answerBody = z.object({ selectedKey: z.string().trim().min(1) });
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

/** Resolve an attempt's course before the course-scoped Student guard runs. */
function stashCourseIdFromAttempt(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    getExamAttemptCourseId(new ObjectId(String(req.params.attemptId)))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'exam-attempt-not-found' });
          return;
        }
        res.locals.courseId = courseId.toHexString();
        next();
      })
      .catch(next);
  };
}

examsRouter.get(
  '/courses/:courseId/exams',
  validate({ params: courseParams }),
  ensureCourseStudent(),
  async (req, res) => {
    res.json(await activeTemplates(new ObjectId(String(req.params.courseId))));
  },
);

examsRouter.post(
  '/courses/:courseId/exams/:templateId/start',
  validate({ params: startParams }),
  ensureCourseStudent(),
  async (req, res) => {
    const params = req.params as z.infer<typeof startParams>;
    const attempt = await startExam(
      req.user!,
      new ObjectId(params.courseId),
      new ObjectId(params.templateId),
    );
    res.status(201).json(attempt);
  },
);

examsRouter.get(
  '/exam-attempts/:attemptId',
  validate({ params: attemptParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromAttempt(),
  ensureCourseStudent(),
  async (req, res) => {
    res.json(await examState(new ObjectId(String(req.params.attemptId)), req.user!.puid));
  },
);

examsRouter.put(
  '/exam-attempts/:attemptId/answers/:index',
  validate({ params: answerParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromAttempt(),
  ensureCourseStudent(),
  validate({ body: answerBody }),
  async (req, res) => {
    const params = req.params as unknown as z.infer<typeof answerParams>;
    const body = req.body as z.infer<typeof answerBody>;
    await answerQuestion(
      new ObjectId(params.attemptId),
      req.user!.puid,
      params.index,
      body.selectedKey,
    );
    res.status(204).end();
  },
);

examsRouter.post(
  '/exam-attempts/:attemptId/submit',
  validate({ params: attemptParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromAttempt(),
  ensureCourseStudent(),
  async (req, res) => {
    res.json(await submitExam(
      new ObjectId(String(req.params.attemptId)),
      req.user!.puid,
    ));
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
  'invalid-selected-key',
]);

const NOT_FOUND_ERRORS = new Set([
  'course-not-found',
  'exam-attempt-not-found',
  'exam-question-not-found',
  'exam-template-not-found',
  'exam-version-not-found',
]);

const CONFLICT_ERRORS = new Set([
  'exam-already-submitted',
  'exam-submit-conflict',
  'exam-template-not-active',
]);

examsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && BAD_REQUEST_ERRORS.has(err.message)) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error && NOT_FOUND_ERRORS.has(err.message)) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof Error && CONFLICT_ERRORS.has(err.message)) {
    res.status(409).json({ error: err.message });
    return;
  }
  next(err);
});
