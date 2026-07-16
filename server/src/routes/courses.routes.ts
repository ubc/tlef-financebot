import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated } from '../components/auth';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  createCourse,
  getCourse,
  updateCourse,
  regenerateRegistrationCode,
  addTheme,
  updateTheme,
  archiveTheme,
  getThemeCourseId,
  addLo,
  updateLo,
  archiveLo,
  getLoCourseId,
  getCourseTree,
  publishChecklist,
  setPublished,
  putRoster,
  getRoster,
} from '../services/courses.service';

// Courses / Hierarchy / Roster endpoints (IN-S01/S02/S03, IN-L06) — the
// instructor authoring surface, exactly as specified in docs/api-contract.md.
// `POST /api/courses` is open to any authenticated user (any signed-in user
// may create a course in the pilot; tighten later via the Phase-3 capability
// model). Every other route below is instructor-only for that course.
export const coursesRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const themeIdParams = z.object({ themeId: objectIdParam });
const loIdParams = z.object({ loId: objectIdParam });

const createCourseBody = z.object({
  name: z.string().min(1),
  courseCode: z.string().min(1),
  term: z.string().min(1),
});

const autoPauseBody = z.object({
  minAttempts: z.number().int().positive(),
  flagPercent: z.number().min(0).max(100),
  flagCount: z.number().int().positive(),
});

const updateCourseBody = z.object({
  termStart: z.coerce.date().optional(),
  termEnd: z.coerce.date().optional(),
  feedbackStrategy: z.enum(['adaptive', 'strategy-a', 'strategy-b']).optional(),
  autoPause: autoPauseBody.optional(),
  published: z.boolean().optional(),
});

const rosterBody = z.object({ identifiers: z.array(z.string()) });

const themeBody = z.object({
  name: z.string().min(1),
  availableFrom: z.coerce.date().optional(),
});

const updateThemeBody = z.object({
  name: z.string().min(1).optional(),
  availableFrom: z.coerce.date().optional(),
  order: z.number().int().optional(),
});

const loBody = z.object({ name: z.string().min(1) });

const updateLoBody = z.object({
  name: z.string().min(1).optional(),
  order: z.number().int().optional(),
});

/**
 * Resolve `res.locals.courseId` from a child resource (theme/LO) before the
 * course-instructor guard runs — see course-guards.ts's `requestCourseId`.
 * 404s (as `theme-not-found` / `lo-not-found`) before the instructor-role
 * check even matters, matching the "404 not found" priority in the API
 * contract's error table. `ensureApiAuthenticated()` runs before this
 * middleware on every route that uses it (see below), so an unauthenticated
 * caller gets 401 without this DB lookup running at all, and can't use the
 * lookup's 404-vs-401 branching to probe whether an id exists.
 */
function stashCourseIdFromTheme(paramName: 'themeId'): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    getThemeCourseId(new ObjectId(String(req.params[paramName])))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'theme-not-found' });
          return;
        }
        res.locals.courseId = courseId.toString();
        next();
      })
      .catch(next);
  };
}

function stashCourseIdFromLo(paramName: 'loId'): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    getLoCourseId(new ObjectId(String(req.params[paramName])))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'lo-not-found' });
          return;
        }
        res.locals.courseId = courseId.toString();
        next();
      })
      .catch(next);
  };
}

// --- Courses -------------------------------------------------------------------

/** POST /api/courses { name, courseCode, term } -> 201 Course. Any signed-in user. */
coursesRouter.post(
  '/courses',
  ensureApiAuthenticated(),
  validate({ body: createCourseBody }),
  async (req, res) => {
    const course = await createCourse(req.user!.puid, req.body);
    res.status(201).json(course);
  },
);

/** GET /api/courses/:courseId -> Course + themes: [Theme & { los }]. Instructor-only. */
coursesRouter.get(
  '/courses/:courseId',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await getCourseTree(new ObjectId(String(req.params.courseId))));
  },
);

/**
 * PATCH /api/courses/:courseId { termStart?, termEnd?, feedbackStrategy?,
 * autoPause?, published? } -> Course. Instructor-only. `published` is routed
 * to setPublished() separately since updateCourse() only owns the term-date /
 * strategy fields (IN-S02); `published` publish/unpublish is IN-L06.
 */
coursesRouter.patch(
  '/courses/:courseId',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  validate({ body: updateCourseBody }),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const { published, ...patch } = req.body;
    let course = Object.keys(patch).length > 0 ? await updateCourse(courseId, patch) : undefined;
    if (published !== undefined) {
      course = await setPublished(courseId, published);
    }
    res.json(course ?? (await getCourse(courseId)));
  },
);

/** POST /api/courses/:courseId/registration-code -> { registrationCode } (regenerates). Instructor-only. */
coursesRouter.post(
  '/courses/:courseId/registration-code',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    const registrationCode = await regenerateRegistrationCode(new ObjectId(String(req.params.courseId)));
    res.json({ registrationCode });
  },
);

/** POST /api/courses/:courseId/publish -> { published, checklist }. Instructor-only. */
coursesRouter.post(
  '/courses/:courseId/publish',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const course = await setPublished(courseId, true);
    const checklist = await publishChecklist(courseId);
    res.json({ published: course.published, checklist });
  },
);

/** POST /api/courses/:courseId/unpublish -> { published, checklist }. Instructor-only. */
coursesRouter.post(
  '/courses/:courseId/unpublish',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const course = await setPublished(courseId, false);
    const checklist = await publishChecklist(courseId);
    res.json({ published: course.published, checklist });
  },
);

/** PUT /api/courses/:courseId/roster { identifiers } -> { count }. Instructor-only. */
coursesRouter.put(
  '/courses/:courseId/roster',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  validate({ body: rosterBody }),
  async (req, res) => {
    const count = await putRoster(new ObjectId(String(req.params.courseId)), req.body.identifiers);
    res.json({ count });
  },
);

/** GET /api/courses/:courseId/roster -> [{ identifier, extendedUntil? }]. Instructor-only. */
coursesRouter.get(
  '/courses/:courseId/roster',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    const roster = await getRoster(new ObjectId(String(req.params.courseId)));
    res.json(roster.map(({ identifier, extendedUntil }) => ({ identifier, extendedUntil })));
  },
);

// --- Hierarchy -------------------------------------------------------------------

/** POST /api/courses/:courseId/themes { name, availableFrom? } -> 201 Theme. Instructor-only. */
coursesRouter.post(
  '/courses/:courseId/themes',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  validate({ body: themeBody }),
  async (req, res) => {
    const theme = await addTheme(new ObjectId(String(req.params.courseId)), req.body);
    res.status(201).json(theme);
  },
);

/** PATCH /api/themes/:themeId { name?, availableFrom?, order? } -> Theme. Instructor-only. */
coursesRouter.patch(
  '/themes/:themeId',
  validate({ params: themeIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromTheme('themeId'),
  ensureCourseInstructor(),
  validate({ body: updateThemeBody }),
  async (req, res) => {
    res.json(await updateTheme(new ObjectId(String(req.params.themeId)), req.body));
  },
);

/** POST /api/themes/:themeId/archive -> Theme. Instructor-only. */
coursesRouter.post(
  '/themes/:themeId/archive',
  validate({ params: themeIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromTheme('themeId'),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await archiveTheme(new ObjectId(String(req.params.themeId))));
  },
);

/** POST /api/themes/:themeId/los { name } -> 201 LearningObjective. Instructor-only. */
coursesRouter.post(
  '/themes/:themeId/los',
  validate({ params: themeIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromTheme('themeId'),
  ensureCourseInstructor(),
  validate({ body: loBody }),
  async (req, res) => {
    const courseId = new ObjectId(res.locals.courseId as string);
    const lo = await addLo(courseId, new ObjectId(String(req.params.themeId)), req.body);
    res.status(201).json(lo);
  },
);

/** PATCH /api/los/:loId { name?, order? } -> LearningObjective. Instructor-only. */
coursesRouter.patch(
  '/los/:loId',
  validate({ params: loIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromLo('loId'),
  ensureCourseInstructor(),
  validate({ body: updateLoBody }),
  async (req, res) => {
    res.json(await updateLo(new ObjectId(String(req.params.loId)), req.body));
  },
);

/** POST /api/los/:loId/archive -> LearningObjective. Instructor-only. */
coursesRouter.post(
  '/los/:loId/archive',
  validate({ params: loIdParams }),
  ensureApiAuthenticated(),
  stashCourseIdFromLo('loId'),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await archiveLo(new ObjectId(String(req.params.loId))));
  },
);

// --- Error normalization -----------------------------------------------------

// Domain errors thrown by courses.service (plain `Error(message)`, per its
// contract) mapped to HTTP status here rather than in the service, so the
// service stays a pure data layer. Anything else falls through to the
// central errorHandler (500). Express 5 auto-forwards rejected async route
// handlers to error middleware, so no per-route try/catch is needed.
const COURSE_ERROR_STATUS: Record<string, number> = {
  'course-not-found': 404,
  'theme-not-found': 404,
  'lo-not-found': 404,
  'term-end-before-start': 400,
};

coursesRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && err.message in COURSE_ERROR_STATUS) {
    res.status(COURSE_ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
