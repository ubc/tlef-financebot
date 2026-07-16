import type { WithId, ObjectId } from 'mongodb';
import { customAlphabet } from 'nanoid';
import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  rosterCol,
  usersCol,
} from '../components/mongodb/collections';
import type { Course, Theme, LearningObjective, RosterEntry } from '../types/domain';

// -----------------------------------------------------------------------------
// Courses service (IN-S01/S02/S03, IN-L06): course creation, Theme/LO hierarchy
// CRUD, term dates, registration code, roster, and the publish checklist. This
// is the instructor authoring surface — routes/courses.routes.ts is the only
// caller. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

// Unambiguous alphabet (no 0/O/1/I) — codes are read aloud / typed by students.
const registrationCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/** Fetch a course or throw 'course-not-found' (404 at the route layer). */
export async function getCourse(courseId: ObjectId): Promise<WithId<Course>> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) throw new Error('course-not-found');
  return course;
}

/**
 * ST-instructor authoring entry point: create a sandboxed (unpublished) course
 * with the standard feedback/auto-pause defaults, a fresh registration code,
 * and grant the creator the 'instructor' role on it.
 */
export async function createCourse(
  ownerPuid: string,
  input: { name: string; courseCode: string; term: string },
): Promise<WithId<Course>> {
  const course: Course = {
    ...input,
    ownerPuid,
    registrationCode: registrationCode(),
    published: false,
    feedbackStrategy: 'adaptive',
    autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
    redirectFailureThreshold: 3,
    createdAt: new Date(),
  };
  const { insertedId } = await coursesCol().insertOne(course);
  await usersCol().updateOne(
    { puid: ownerPuid },
    { $addToSet: { courseRoles: { courseId: insertedId, role: 'instructor' as const } } },
  );
  return { _id: insertedId, ...course };
}

/**
 * IN-S02: update term dates / feedback strategy / auto-pause thresholds.
 * Rejects an end date on/before the effective start date without touching
 * the stored document.
 */
export async function updateCourse(
  courseId: ObjectId,
  patch: Partial<Pick<Course, 'termStart' | 'termEnd' | 'feedbackStrategy' | 'autoPause'>>,
): Promise<WithId<Course>> {
  const course = await getCourse(courseId);
  const termStart = patch.termStart ?? course.termStart;
  const termEnd = patch.termEnd ?? course.termEnd;
  if (termStart && termEnd && termEnd <= termStart) {
    throw new Error('term-end-before-start');
  }
  await coursesCol().updateOne({ _id: courseId }, { $set: patch });
  return { ...course, ...patch };
}

/** IN-S03: regenerate the course's registration code. */
export async function regenerateRegistrationCode(courseId: ObjectId): Promise<string> {
  const code = registrationCode();
  await coursesCol().updateOne({ _id: courseId }, { $set: { registrationCode: code } });
  return code;
}

// --- Hierarchy: Themes / Learning Objectives ---------------------------------

export async function addTheme(
  courseId: ObjectId,
  input: { name: string; availableFrom?: Date },
): Promise<WithId<Theme>> {
  const [last] = await themesCol().find({ courseId }).sort({ order: -1 }).limit(1).toArray();
  const order = (last?.order ?? 0) + 1;
  const theme: Theme = { courseId, name: input.name, order, ...(input.availableFrom ? { availableFrom: input.availableFrom } : {}) };
  const { insertedId } = await themesCol().insertOne(theme);
  return { _id: insertedId, ...theme };
}

export async function updateTheme(
  themeId: ObjectId,
  patch: Partial<Pick<Theme, 'name' | 'availableFrom' | 'order'>>,
): Promise<WithId<Theme>> {
  const theme = await themesCol().findOneAndUpdate({ _id: themeId }, { $set: patch }, { returnDocument: 'after' });
  if (!theme) throw new Error('theme-not-found');
  return theme;
}

/**
 * Archive a Theme and cascade the same `archivedAt` to its still-live LOs.
 *
 * Deliberate deviation from the brief (human-approved): the brief's
 * `archiveTheme` touches only the Theme. Left that way, `getCourseTree` (which
 * joins LOs to non-archived Themes only) hides the theme's LOs from the UI
 * while `publishChecklist` (which queries LOs by `courseId` regardless of
 * their theme's archive state) keeps counting them — an instructor could never
 * clear the publish checklist for a course with an archived theme. Cascading
 * the archive stamp at write time keeps `publishChecklist`'s brief-specified
 * query correct without special-casing it for archived themes.
 *
 * Already-archived LOs keep their original `archivedAt` — only LOs still
 * missing the field are touched, and with the theme's own timestamp so both
 * carry one consistent archive time.
 */
export async function archiveTheme(themeId: ObjectId): Promise<WithId<Theme>> {
  const archivedAt = new Date();
  const theme = await themesCol().findOneAndUpdate(
    { _id: themeId },
    { $set: { archivedAt } },
    { returnDocument: 'after' },
  );
  if (!theme) throw new Error('theme-not-found');
  await losCol().updateMany({ themeId, archivedAt: { $exists: false } }, { $set: { archivedAt } });
  return theme;
}

/**
 * The course a Theme belongs to — used by routes to resolve
 * `res.locals.courseId` for `ensureCourseInstructor()` on Theme-scoped
 * endpoints (`PATCH /themes/:themeId`, etc.) that have no `:courseId` in
 * their path. Keeps the lookup in the service layer per routes/AGENTS.md
 * ("no database or SDK calls directly in a route").
 */
export async function getThemeCourseId(themeId: ObjectId): Promise<ObjectId | null> {
  const theme = await themesCol().findOne({ _id: themeId }, { projection: { courseId: 1 } });
  return theme?.courseId ?? null;
}

export async function addLo(
  courseId: ObjectId,
  themeId: ObjectId,
  input: { name: string },
): Promise<WithId<LearningObjective>> {
  const [last] = await losCol().find({ themeId }).sort({ order: -1 }).limit(1).toArray();
  const order = (last?.order ?? 0) + 1;
  const lo: LearningObjective = { courseId, themeId, name: input.name, order };
  const { insertedId } = await losCol().insertOne(lo);
  return { _id: insertedId, ...lo };
}

export async function updateLo(
  loId: ObjectId,
  patch: Partial<Pick<LearningObjective, 'name' | 'order'>>,
): Promise<WithId<LearningObjective>> {
  const lo = await losCol().findOneAndUpdate({ _id: loId }, { $set: patch }, { returnDocument: 'after' });
  if (!lo) throw new Error('lo-not-found');
  return lo;
}

export async function archiveLo(loId: ObjectId): Promise<WithId<LearningObjective>> {
  const lo = await losCol().findOneAndUpdate(
    { _id: loId },
    { $set: { archivedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!lo) throw new Error('lo-not-found');
  return lo;
}

/** The course a Learning Objective belongs to — see getThemeCourseId(). */
export async function getLoCourseId(loId: ObjectId): Promise<ObjectId | null> {
  const lo = await losCol().findOne({ _id: loId }, { projection: { courseId: 1 } });
  return lo?.courseId ?? null;
}

/** Full hierarchy for the course-detail view: non-archived Themes/LOs, ordered. */
export async function getCourseTree(
  courseId: ObjectId,
): Promise<WithId<Course> & { themes: Array<WithId<Theme> & { los: WithId<LearningObjective>[] }> }> {
  const course = await getCourse(courseId);
  const themes = await themesCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .sort({ order: 1 })
    .toArray();
  const los = await losCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .sort({ order: 1 })
    .toArray();
  return {
    ...course,
    themes: themes.map((theme) => ({
      ...theme,
      los: los.filter((lo) => lo.themeId.equals(theme._id)),
    })),
  };
}

/**
 * Non-blocking duplicate-name check for the "add Theme/LO" flow — the client
 * warns the instructor but does not prevent the save (brief: warn, don't
 * block).
 */
export async function duplicateNameWarning(
  courseId: ObjectId,
  scope: 'theme' | 'lo',
  parentId: ObjectId | null,
  name: string,
): Promise<boolean> {
  if (scope === 'theme') {
    const existing = await themesCol().countDocuments({ courseId, name, archivedAt: { $exists: false } });
    return existing > 0;
  }
  const filter: Record<string, unknown> = { courseId, name, archivedAt: { $exists: false } };
  if (parentId) filter.themeId = parentId;
  const existing = await losCol().countDocuments(filter);
  return existing > 0;
}

// --- Publish checklist (IN-L06) -----------------------------------------------

export async function publishChecklist(courseId: ObjectId): Promise<Array<{ item: string; ok: boolean }>> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) throw new Error('course-not-found');
  const themes = await themesCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .toArray();
  const los = await losCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .toArray();
  const thinLos: string[] = [];
  for (const lo of los) {
    const approved = await questionsCol().countDocuments({ courseId, loIds: lo._id, state: 'approved' });
    if (approved < 3) thinLos.push(lo.name);
  }
  return [
    { item: 'Term dates set', ok: Boolean(course.termStart && course.termEnd) },
    { item: 'At least one Theme', ok: themes.length > 0 },
    { item: 'At least one Learning Objective', ok: los.length > 0 },
    { item: 'Registration code generated', ok: Boolean(course.registrationCode) },
    {
      item: `Every LO has ≥3 Approved questions${thinLos.length ? ` (thin: ${thinLos.join(', ')})` : ''}`,
      ok: thinLos.length === 0,
    },
  ];
}

/** Publish is allowed even with checklist warnings (thin LOs) — IN-L06. */
export async function setPublished(courseId: ObjectId, published: boolean): Promise<WithId<Course>> {
  await coursesCol().updateOne({ _id: courseId }, { $set: { published } });
  return getCourse(courseId);
}

// --- Roster (ST-E02) -----------------------------------------------------------

/** Replace the roster with the given identifiers: lower-cased, trimmed, deduped. */
export async function putRoster(courseId: ObjectId, identifiers: string[]): Promise<number> {
  const unique = Array.from(new Set(identifiers.map((id) => id.trim().toLowerCase()).filter(Boolean)));
  await rosterCol().deleteMany({ courseId });
  if (unique.length === 0) return 0;
  const now = new Date();
  const entries: RosterEntry[] = unique.map((identifier) => ({ courseId, identifier, addedAt: now }));
  await rosterCol().insertMany(entries);
  return unique.length;
}

export async function getRoster(courseId: ObjectId): Promise<WithId<RosterEntry>[]> {
  return rosterCol().find({ courseId }).sort({ identifier: 1 }).toArray();
}
