import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { validate } from '../middleware/validate';
import { enrollByCode, listEnrollments, EnrollmentError } from '../services/enrollment.service';

// Authenticated CWL users redeem a supplemental one-time code. Atomic code
// claims and course publication/date checks live in the enrollment service.
export const enrollmentRouter = Router();

const enrollBody = z.object({ code: z.string().trim().min(1).max(32) });

/** POST /api/enrollments { code } -> 201 { courseId, name, courseCode }. */
enrollmentRouter.post(
  '/enrollments',
  ensureApiAuthenticated(),
  validate({ body: enrollBody }),
  async (req, res) => {
    const result = await enrollByCode(req.user!, req.body.code);
    res.status(201).json(result);
  },
);

/** GET /api/enrollments -> [{ courseId, name, courseCode, term, active }]. */
enrollmentRouter.get('/enrollments', ensureApiAuthenticated(), async (req, res) => {
  res.json(await listEnrollments(req.user!));
});

// --- Error normalization -----------------------------------------------------

// EnrollmentError.code -> HTTP status + the exact user-facing message from
// ST-E02. Mapped here rather than in the service so the service stays a pure
// data layer. Express 5 auto-forwards rejected async route handlers to error
// middleware, so no per-route try/catch is needed.
const ENROLLMENT_ERROR_STATUS: Record<EnrollmentError['code'], number> = {
  'not-recognized': 404,
  'not-on-roster': 403,
  'course-ended': 410,
  'already-enrolled': 409,
};

const ENROLLMENT_ERROR_MESSAGE: Record<EnrollmentError['code'], string> = {
  'not-recognized': 'Code not recognized.',
  'not-on-roster': "You're not on the roster for this course — contact your instructor.",
  'course-ended': 'This course has ended.',
  'already-enrolled': "You're already enrolled in this course.",
};

enrollmentRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof EnrollmentError) {
    res.status(ENROLLMENT_ERROR_STATUS[err.code]).json({ error: ENROLLMENT_ERROR_MESSAGE[err.code] });
    return;
  }
  next(err);
});
