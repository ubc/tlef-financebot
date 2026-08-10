import type { Filter, WithId, ObjectId } from 'mongodb';
import { customAlphabet } from 'nanoid';
import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  rosterCol,
  usersCol,
} from '../components/mongodb/collections';
import type {
  Course,
  CourseLifecycle,
  Theme,
  LearningObjective,
  RosterEntry,
} from '../types/domain';

// -----------------------------------------------------------------------------
// Courses service (IN-S01/S02/S03, IN-L06): course creation, Theme/LO hierarchy
// CRUD, term dates, registration code, roster, and the publish checklist. This
// is the instructor authoring surface — routes/courses.routes.ts is the only
// caller. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

// Unambiguous alphabet (no 0/O/1/I) — codes are read aloud / typed by students.
const registrationCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/** Fetch a course or throw 'course-not-found' (404 at the route layer). */
export function courseLifecycle(course: Pick<Course, 'published' | 'lifecycle' | 'archivedAt'>): CourseLifecycle {
  if (course.lifecycle) return course.lifecycle;
  if (course.archivedAt) return 'archived';
  return course.published ? 'published' : 'draft';
}

function normalizeCourse(course: WithId<Course>): WithId<Course> {
  const publicCourse = { ...course };
  delete publicCourse.identityKey;
  return { ...publicCourse, lifecycle: courseLifecycle(course) };
}

function normalizeIdentityPart(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-CA');
}

/** Stable, case/whitespace-insensitive identity for one scheduled section. */
export function courseIdentityKey(
  input: Pick<Course, 'courseCode' | 'section' | 'term'>,
): string {
  return JSON.stringify([
    normalizeIdentityPart(input.courseCode),
    normalizeIdentityPart(input.section),
    normalizeIdentityPart(input.term),
  ]);
}

function duplicateCourseError(cause?: unknown): Error & { status: number } {
  return Object.assign(new Error('course-already-exists', cause ? { cause } : undefined), { status: 409 });
}

function throwCourseWriteError(error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  ) {
    throw duplicateCourseError(error);
  }
  throw error;
}

export async function getCourse(courseId: ObjectId): Promise<WithId<Course>> {
  const course = await coursesCol().findOne({ _id: courseId });
  if (!course) throw new Error('course-not-found');
  return normalizeCourse(course);
}

/**
 * ST-instructor authoring entry point: create a sandboxed (unpublished) course
 * with the standard feedback/auto-pause defaults, a fresh registration code,
 * and grant the creator the 'instructor' role on it.
 */
export async function createCourse(
  ownerPuid: string,
  input: { name: string; courseCode: string; section?: string; term: string },
): Promise<WithId<Course>> {
  const normalizedInput = {
    name: input.name.trim(),
    courseCode: input.courseCode.trim(),
    ...(input.section?.trim() ? { section: input.section.trim() } : {}),
    term: input.term.trim(),
  };
  const identityKey = courseIdentityKey(normalizedInput);
  const legacyIdentity: Filter<Course> = {
    courseCode: normalizedInput.courseCode,
    term: normalizedInput.term,
    ...(normalizedInput.section
      ? { section: normalizedInput.section }
      : { $or: [{ section: { $exists: false } }, { section: '' }] }),
  };
  const duplicate = await coursesCol().findOne(
    { $or: [{ identityKey }, legacyIdentity] },
    { projection: { _id: 1 }, collation: { locale: 'en', strength: 2 } },
  );
  if (duplicate) throw duplicateCourseError();

  const now = new Date();
  const course: Course = {
    ...normalizedInput,
    identityKey,
    ownerPuid,
    registrationCode: registrationCode(),
    published: false,
    lifecycle: 'draft',
    feedbackStrategy: 'adaptive',
    autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
    redirectFailureThreshold: 3,
    reviewBacklogThreshold: 10, // §9.1 default
    createdAt: now,
    updatedAt: now,
  };
  let insertedId: ObjectId;
  try {
    ({ insertedId } = await coursesCol().insertOne(course));
  } catch (error) {
    throwCourseWriteError(error);
  }
  await usersCol().updateOne(
    { puid: ownerPuid },
    { $addToSet: { courseRoles: { courseId: insertedId, role: 'instructor' as const } } },
  );
  return normalizeCourse({ _id: insertedId, ...course });
}

/**
 * IN-S02: update term dates / feedback strategy / auto-pause thresholds.
 * Rejects an end date on/before the effective start date without touching
 * the stored document.
 */
export async function updateCourse(
  courseId: ObjectId,
  patch: Partial<
    Pick<
      Course,
      | 'name'
      | 'courseCode'
      | 'term'
      | 'termStart'
      | 'termEnd'
      | 'feedbackStrategy'
      | 'autoPause'
      | 'reviewBacklogThreshold'
    >
  > & { section?: string | null },
): Promise<WithId<Course>> {
  const course = await getCourse(courseId);
  const termStart = patch.termStart ?? course.termStart;
  const termEnd = patch.termEnd ?? course.termEnd;
  if (termStart && termEnd && termEnd <= termStart) {
    throw new Error('term-end-before-start');
  }
  const updatedAt = new Date();
  const { section, ...setPatch } = patch;
  const identityChanged = patch.courseCode !== undefined || patch.section !== undefined || patch.term !== undefined;
  const identityKey = identityChanged
    ? courseIdentityKey({
        courseCode: patch.courseCode?.trim() ?? course.courseCode,
        section: section === null ? undefined : section?.trim() ?? course.section,
        term: patch.term?.trim() ?? course.term,
      })
    : undefined;
  try {
    await coursesCol().updateOne(
      { _id: courseId },
      {
        $set: {
          ...setPatch,
          ...(section !== undefined && section !== null ? { section } : {}),
          ...(identityKey ? { identityKey } : {}),
          updatedAt,
        },
        ...(section === null ? { $unset: { section: '' } } : {}),
      },
    );
  } catch (error) {
    throwCourseWriteError(error);
  }
  return {
    ...course,
    ...setPatch,
    ...(section === null ? { section: undefined } : section !== undefined ? { section } : {}),
    updatedAt,
  };
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

export interface UpsertCourseOutlineInput {
  themes: Array<{ name: string; los: string[] }>;
}

export interface UpsertCourseOutlineResult {
  themesCreated: number;
  losCreated: number;
  themes: Array<{
    _id: ObjectId;
    name: string;
    created: boolean;
    los: Array<{ _id: ObjectId; name: string; created: boolean }>;
  }>;
}

function normalizedOutlineName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Idempotent-by-name outline creation for bulk paste/import and reviewed AI
 * suggestions. Existing active Topics and LOs are reused, so retrying after a
 * partial network/write failure fills the missing tail instead of duplicating
 * everything that already succeeded.
 */
export async function upsertCourseOutline(
  courseId: ObjectId,
  input: UpsertCourseOutlineInput,
): Promise<UpsertCourseOutlineResult> {
  const requested = input.themes.map((theme) => ({
    name: theme.name.trim(),
    los: [...new Map(
      theme.los
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [normalizedOutlineName(name), name]),
    ).values()],
  }));
  if (
    requested.length === 0
    || requested.some((theme) => theme.name === '' || theme.los.length === 0)
  ) {
    throw new Error('course-outline-invalid');
  }

  const existingThemes = await themesCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .sort({ order: 1 })
    .toArray();
  const activeLos = await losCol()
    .find({ courseId, archivedAt: { $exists: false } })
    .sort({ order: 1 })
    .toArray();
  const themesByName = new Map(existingThemes.map((theme) => [normalizedOutlineName(theme.name), theme]));

  let themesCreated = 0;
  let losCreated = 0;
  const themes: UpsertCourseOutlineResult['themes'] = [];
  for (const requestedTheme of requested) {
    const themeKey = normalizedOutlineName(requestedTheme.name);
    let theme = themesByName.get(themeKey);
    let themeCreated = false;
    if (!theme) {
      theme = await addTheme(courseId, { name: requestedTheme.name });
      themesByName.set(themeKey, theme);
      themesCreated += 1;
      themeCreated = true;
    }

    const themeLos = activeLos.filter((lo) => lo.themeId.equals(theme!._id));
    const losByName = new Map(themeLos.map((lo) => [normalizedOutlineName(lo.name), lo]));
    const resultLos: UpsertCourseOutlineResult['themes'][number]['los'] = [];
    for (const requestedLo of requestedTheme.los) {
      const loKey = normalizedOutlineName(requestedLo);
      let lo = losByName.get(loKey);
      let created = false;
      if (!lo) {
        lo = await addLo(courseId, theme._id, { name: requestedLo });
        losByName.set(loKey, lo);
        activeLos.push(lo);
        losCreated += 1;
        created = true;
      }
      resultLos.push({ _id: lo._id, name: lo.name, created });
    }
    themes.push({ _id: theme._id, name: theme.name, created: themeCreated, los: resultLos });
  }

  return { themesCreated, losCreated, themes };
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

export interface CourseOutlineTheme {
  _id: ObjectId;
  name: string;
  order: number;
  los: Array<{ _id: ObjectId; name: string; order: number }>;
}

export interface CourseOutlineIdentity {
  name: string;
  courseCode: string;
  section?: string;
  term: string;
}

/** Safe course identity plus Theme/LO names and order — the minimum a
 * `question.review` holder needs to understand which course project they are
 * working in and label a question "Topic 1 / LO 2". This deliberately
 * projects rather than returning the course record: registrationCode, dates,
 * lifecycle, autoPause and feedbackStrategy never reach a TA. */
export async function getCourseOutline(
  courseId: ObjectId,
): Promise<{ course: CourseOutlineIdentity; themes: CourseOutlineTheme[] }> {
  const [course, themes, los] = await Promise.all([
    getCourse(courseId),
    themesCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
  ]);
  return {
    course: {
      name: course.name,
      courseCode: course.courseCode,
      ...(course.section ? { section: course.section } : {}),
      term: course.term,
    },
    themes: themes.map((theme) => ({
      _id: theme._id,
      name: theme.name,
      order: theme.order,
      los: los
        .filter((lo) => lo.themeId.equals(theme._id))
        .map((lo) => ({ _id: lo._id, name: lo.name, order: lo.order })),
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
      ok: los.length > 0 && thinLos.length === 0,
    },
  ];
}

/** Publish is allowed even with checklist warnings (thin LOs) — IN-L06. */
export async function setPublished(courseId: ObjectId, published: boolean): Promise<WithId<Course>> {
  const course = await getCourse(courseId);
  if (course.lifecycle === 'archived') throw new Error('course-archived');
  await coursesCol().updateOne(
    { _id: courseId },
    {
      $set: {
        published,
        lifecycle: published ? 'published' : 'draft',
        updatedAt: new Date(),
      },
    },
  );
  return getCourse(courseId);
}

/** Archive is reversible, but restoration always returns to an unpublished draft. */
export async function archiveCourse(courseId: ObjectId): Promise<WithId<Course>> {
  await getCourse(courseId);
  const now = new Date();
  await coursesCol().updateOne(
    { _id: courseId },
    {
      $set: {
        published: false,
        lifecycle: 'archived',
        archivedAt: now,
        updatedAt: now,
      },
    },
  );
  return getCourse(courseId);
}

export async function restoreCourse(courseId: ObjectId): Promise<WithId<Course>> {
  const course = await getCourse(courseId);
  if (course.lifecycle !== 'archived') throw new Error('course-not-archived');
  const updatedAt = new Date();
  await coursesCol().updateOne(
    { _id: courseId },
    {
      $set: { published: false, lifecycle: 'draft', updatedAt },
      $unset: { archivedAt: '' },
    },
  );
  return getCourse(courseId);
}

// --- Roster (ST-E02) -----------------------------------------------------------

/**
 * Reconcile the roster to the given identifiers: lower-cased, trimmed,
 * deduped. This is deliberately NOT a delete-then-insert (the brief's literal
 * "replaces" wording) — human-approved deviation, data-integrity motivated.
 *
 * `RosterEntry.extendedUntil` (IN-S02) is an instructor-granted per-student
 * access extension. A wipe-and-rewrite on every re-upload would silently
 * destroy every extension in the course the next time an instructor added
 * one name to the roster. Instead:
 *  - identifiers no longer in the list are removed;
 *  - identifiers still in the list are left untouched (their `extendedUntil`
 *    and original `addedAt` survive) via `$setOnInsert`, which only takes
 *    effect on the documents the upsert actually creates;
 *  - new identifiers are inserted with `addedAt` = now.
 * An empty/all-blank list still clears the whole roster (there is nothing to
 * preserve), returning 0.
 */
export async function putRoster(courseId: ObjectId, identifiers: string[]): Promise<number> {
  const unique = Array.from(new Set(identifiers.map((id) => id.trim().toLowerCase()).filter(Boolean)));
  if (unique.length === 0) {
    await rosterCol().deleteMany({ courseId });
    return 0;
  }
  // Safe only because `unique` is non-empty here — `{ $nin: [] }` matches
  // every document, which would wipe the roster in the empty-list case
  // (handled separately above).
  await rosterCol().deleteMany({ courseId, identifier: { $nin: unique } });
  const now = new Date();
  await rosterCol().bulkWrite(
    unique.map((identifier) => ({
      updateOne: {
        filter: { courseId, identifier },
        update: { $setOnInsert: { courseId, identifier, addedAt: now } satisfies RosterEntry },
        upsert: true,
      },
    })),
  );
  return unique.length;
}

export async function getRoster(courseId: ObjectId): Promise<WithId<RosterEntry>[]> {
  return rosterCol().find({ courseId }).sort({ identifier: 1 }).toArray();
}
