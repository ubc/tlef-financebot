import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import { z } from 'zod';
import { ensureApiAuthenticated, ensureCapability, ensurePlatformInstructor } from '../components/auth';
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
  getCourseOutline,
  publishChecklist,
  setPublished,
  archiveCourse,
  restoreCourse,
  putRoster,
  getRoster,
} from '../services/courses.service';
import { instructorWorkflowSummary } from '../services/instructor-workflow.service';
import { classifyIdentifierList, parseRosterFile } from '../services/roster-import.service';

// Courses / Hierarchy / Roster endpoints (IN-S01/S02/S03, IN-L06) — the
// instructor authoring surface, exactly as specified in docs/api-contract.md.
// `POST /api/courses` requires the global platform-Instructor capability (or
// Admin); courses.service then grants the creator the course Instructor role.
// Every other route below is instructor-only for that course.
export const coursesRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const themeIdParams = z.object({ themeId: objectIdParam });
const loIdParams = z.object({ loId: objectIdParam });

const createCourseBody = z.object({
  name: z.string().trim().min(1),
  courseCode: z.string().trim().min(1),
  section: z.string().trim().min(1).max(40).optional(),
  term: z.string().trim().min(1),
});

const autoPauseBody = z.object({
  minAttempts: z.number().int().positive(),
  flagPercent: z.number().min(0).max(100),
  flagCount: z.number().int().positive(),
});

const updateCourseBody = z.object({
  name: z.string().trim().min(1).optional(),
  courseCode: z.string().trim().min(1).optional(),
  section: z.string().trim().max(40).nullable().optional(),
  term: z.string().trim().min(1).optional(),
  termStart: z.coerce.date().optional(),
  termEnd: z.coerce.date().optional(),
  feedbackStrategy: z.enum(['adaptive', 'strategy-a', 'strategy-b']).optional(),
  autoPause: autoPauseBody.optional(),
  reviewBacklogThreshold: z.number().int().positive().optional(),
  published: z.boolean().optional(),
});

const rosterBody = z.object({ identifiers: z.array(z.string()) });

// A roster is a list of short strings; 2MB is far past the biggest UBC class
// and still small enough that a stray PDF is rejected rather than parsed.
const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

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

/** POST /api/courses { name, courseCode, term } -> 201 Course. Platform-Instructor-only. */
coursesRouter.post(
  '/courses',
  ensurePlatformInstructor(),
  validate({ body: createCourseBody }),
  async (req, res) => {
    const course = await createCourse(req.user!.puid, req.body);
    res.status(201).json(course);
  },
);

/** GET /api/courses/:courseId/publish-checklist -> ChecklistItem[]. */
coursesRouter.get(
  '/courses/:courseId/publish-checklist',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await publishChecklist(new ObjectId(String(req.params.courseId))));
  },
);

/** GET /api/courses/:courseId/instructor-workflow -> task-driven cockpit summary. */
coursesRouter.get(
  '/courses/:courseId/instructor-workflow',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await instructorWorkflowSummary(new ObjectId(String(req.params.courseId))));
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

/** GET /api/courses/:courseId/outline -> safe course identity plus ordered
 * Theme/LO names. TA-accessible subset of `GET /api/courses/:courseId` — it
 * carries name/code/section/term for workspace context, but never registration
 * code, dates, lifecycle, autoPause or feedbackStrategy. `ensureCapability`
 * performs its own authentication check, so no `ensureApiAuthenticated()`
 * precedes it here. */
coursesRouter.get(
  '/courses/:courseId/outline',
  validate({ params: courseIdParams }),
  ensureCapability('question.review'),
  async (req, res) => {
    res.json(await getCourseOutline(new ObjectId(String(req.params.courseId))));
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

/** POST /api/courses/:courseId/archive -> Course. Historical instructor access remains. */
coursesRouter.post(
  '/courses/:courseId/archive',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await archiveCourse(new ObjectId(String(req.params.courseId))));
  },
);

/** POST /api/courses/:courseId/restore -> draft Course. */
coursesRouter.post(
  '/courses/:courseId/restore',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await restoreCourse(new ObjectId(String(req.params.courseId))));
  },
);

/**
 * PUT /api/courses/:courseId/roster { identifiers } -> { count, rejected }.
 * Instructor-only.
 *
 * Identifiers that cannot ever match a login are dropped here rather than
 * stored, and returned as `rejected` so the UI can say which rows and why.
 * Storing them was worse than useless: `putRoster` accepted any non-empty
 * string, so a roster of student numbers saved cleanly and reported its count
 * while guaranteeing every enrolment would fail "not on roster" — see
 * roster-import.service.ts for why a student number can never match.
 *
 * `rejected` is additive, so the previous `{ count }` shape still holds.
 */
coursesRouter.put(
  '/courses/:courseId/roster',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  validate({ body: rosterBody }),
  async (req, res) => {
    const { identifiers, rejects } = classifyIdentifierList(req.body.identifiers);
    const count = await putRoster(new ObjectId(String(req.params.courseId)), identifiers);
    res.json({ count, rejected: rejects });
  },
);

/**
 * POST /api/courses/:courseId/roster/preview (multipart field `file`, optional
 * `column`) -> RosterParseResult. Instructor-only.
 *
 * Parse-only: nothing is written. The instructor reviews the detected column
 * and the rejected rows, then saves through PUT above — so a file whose
 * identifier column was guessed wrong is caught before it replaces a roster.
 */
coursesRouter.post(
  '/courses/:courseId/roster/preview',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  rosterUpload.single('file'),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'roster-file-required' });
      return;
    }
    const column = typeof req.body?.column === 'string' && req.body.column ? req.body.column : undefined;
    res.json(parseRosterFile(req.file.buffer.toString('utf8'), column));
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
  'course-archived': 409,
  'course-not-archived': 409,
};

coursesRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  // multer errors carry a `code`, not a `status`; unhandled they reach the
  // central errorHandler as a 500, so an oversized roster file would report
  // "500 File too large" instead of a 4xx. Same mapping as materials.routes.ts.
  if (err instanceof multer.MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    return;
  }
  if (err instanceof Error && err.message in COURSE_ERROR_STATUS) {
    res.status(COURSE_ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  // csv-parse throws on input it cannot tokenize at all (a PDF renamed .csv,
  // a truncated quoted field). That is a bad upload, not a server fault.
  if (err instanceof Error && 'code' in err && String((err as { code: unknown }).code).startsWith('CSV_')) {
    res.status(400).json({ error: 'roster-file-unreadable' });
    return;
  }
  next(err);
});
