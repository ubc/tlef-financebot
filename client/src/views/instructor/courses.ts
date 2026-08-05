// My Courses (N1) + Create Course (N2) — the instructor's landing page and
// the entry point into a course's dashboard/structure/materials/bank/queue
// (Task 15, Task B). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-ids `194:2` / `198:2`).
import { ApiError, createCourse, listInstructorCourses, type InstructorCourse } from '../../api.js';
import { getSession } from '../../auth.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

/** No standalone `navigate(path)` export exists on router.ts (its `navigate`
 * lives on the `RouterHandle` returned by `startRouter`) — mirror how other
 * views navigate imperatively (e.g. `views/student/practice.ts`'s "back"
 * link) by setting the hash directly; the router's `hashchange` listener
 * picks it up. */
function navigate(path: string): void {
  window.location.hash = path;
}

/**
 * Pure matcher behind N2's duplicate-section guard. A scheduled section is
 * identified by course code, section, and term, compared without case or
 * surrounding whitespace. Returns the first match, or `undefined` when the
 * identity is incomplete or unused.
 */
export function findDuplicateCourse(
  courses: InstructorCourse[],
  code: string,
  section: string,
  term: string,
): InstructorCourse | undefined {
  const normCode = code.trim().toLowerCase();
  const normSection = section.trim().toLowerCase();
  const normTerm = term.trim().toLowerCase();
  if (!normCode || !normTerm) return undefined;
  return courses.find(
    (course) =>
      course.courseCode.trim().toLowerCase() === normCode
      && (course.section ?? '').trim().toLowerCase() === normSection
      && course.term.trim().toLowerCase() === normTerm,
  );
}

/**
 * UBC's four teaching terms, in the order they occur inside one academic
 * year. `startMonth` is the 0-indexed calendar month the term begins, and
 * `inNextCalendarYear` says whether that month falls in the second half of
 * the academic year (2026/27's Winter Term 2 starts in January *2027*).
 */
const UBC_TERMS = [
  { name: 'Winter Term 1', startMonth: 8, inNextCalendarYear: false }, // Sep–Dec
  { name: 'Winter Term 2', startMonth: 0, inNextCalendarYear: true }, //  Jan–Apr
  { name: 'Summer Term 1', startMonth: 4, inNextCalendarYear: true }, //  May–Jun
  { name: 'Summer Term 2', startMonth: 6, inNextCalendarYear: true }, //  Jul–Aug
] as const;

/** The four term names alone, for the Term dropdown. */
export const UBC_TERM_NAMES = UBC_TERMS.map((term) => term.name);

/** FinanceBot's first academic year — nothing earlier is ever offered, since
 * no course predates it. The Academic Year dropdown starts here and only
 * moves forward as the calendar catches up. */
const FIRST_ACADEMIC_YEAR = 2026;

/** How many academic years the dropdown shows. Deliberately a short rolling
 * window rather than a long fixed list: courses get set up months, not
 * decades, ahead, and a short list stays glanceable and never needs
 * maintaining. */
const ACADEMIC_YEARS_SHOWN = 4;

/** `2026` -> `2026/27`. */
function academicYearLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The calendar year an academic year starts in. UBC's academic year runs
 * September through August, so anything before September still belongs to the
 * year that started the previous September. */
function academicYearStart(now: Date): number {
  return now.getMonth() >= UBC_TERMS[0].startMonth ? now.getFullYear() : now.getFullYear() - 1;
}

function termStart(startYear: number, term: (typeof UBC_TERMS)[number]): Date {
  return new Date(startYear + (term.inNextCalendarYear ? 1 : 0), term.startMonth, 1);
}

/**
 * The academic years offered on the Create Course form, earliest first — e.g.
 * `['2026/27', '2027/28', '2028/29', '2029/30']`. Never starts before
 * `FIRST_ACADEMIC_YEAR`, and rolls forward once the calendar passes it. Pure
 * and `now`-injected so it is unit-testable without faking the clock.
 */
export function academicYearOptions(now: Date): string[] {
  const first = Math.max(FIRST_ACADEMIC_YEAR, academicYearStart(now));
  return Array.from({ length: ACADEMIC_YEARS_SHOWN }, (_, i) => academicYearLabel(first + i));
}

/** How the two dropdowns combine into the single stored `term` string, e.g.
 * `Winter Term 1, 2026/27`. */
export function formatTerm(termName: string, academicYear: string): string {
  return `${termName}, ${academicYear}`;
}

/**
 * What the two dropdowns preselect: the next term to *begin*, since a course
 * is almost always being set up ahead of its term. Clamped into the offered
 * window, so it always names an option that actually exists.
 */
export function defaultTermSelection(now: Date): { academicYear: string; termName: string } {
  const years = academicYearOptions(now);
  for (const [index, academicYear] of years.entries()) {
    const startYear = Number(academicYear.slice(0, 4));
    for (const term of UBC_TERMS) {
      // The first offered year may already be under way (or, at launch, still
      // in the future) — only the earliest year needs the has-it-started
      // check; every later year is entirely ahead of `now`.
      if (index > 0 || termStart(startYear, term) > now) {
        return { academicYear, termName: term.name };
      }
    }
  }
  return { academicYear: years[years.length - 1]!, termName: UBC_TERMS[0].name };
}

function courseHref(courseId: string): string {
  return `#/instructor/course/${encodeURIComponent(courseId)}`;
}

function courseCard(course: InstructorCourse): HTMLElement {
  const lifecycle = course.lifecycle ?? (course.published ? 'published' : 'draft');
  const label = lifecycle === 'archived' ? 'Archived' : lifecycle === 'published' ? 'Published' : 'Sandbox';
  return el(
    'a',
    { class: 'course-card', href: courseHref(course._id) },
    el(
      'div',
      { class: 'course-card__main' },
      el('h3', { class: 'course-card__title', text: `${course.courseCode} — ${course.name}` }),
      el('p', {
        class: 'course-card__meta',
        text: [course.term, course.section ? `Section ${course.section}` : ''].filter(Boolean).join(' · '),
      }),
    ),
    statusBadge(label, lifecycle === 'published' ? 'approved' : lifecycle === 'archived' ? 'archived' : 'neutral'),
  );
}

/** My Courses (N1): the instructor's courses, or an empty state when they
 * hold no `instructor` courseRoles (see the Task A "known limitation" note —
 * an admin with no explicit courseRoles legitimately sees an empty list
 * here). */
export async function renderMyCourses(outlet: HTMLElement): Promise<void> {
  const user = getSession().user;
  const canCreateCourse = Boolean(user?.isAdmin || user?.platformInstructor);
  const body = el('div', {}, loadingState('Loading your courses…'));
  const root = el(
    'div',
    { class: 'view' },
    pageHeader(
      'My Courses',
      canCreateCourse
        ? 'Select a course to manage, or create a new one.'
        : 'Select a course you have been assigned to manage.',
      canCreateCourse
        ? {
            text: '+ Create course',
            onClick: () => navigate('/instructor/courses/new'),
          }
        : undefined,
    ),
    body,
  );
  mount(outlet, root);

  try {
    const courses = await listInstructorCourses();
    body.replaceChildren(
      courses.length
        ? el('div', { class: 'course-list' }, ...courses.map(courseCard))
        : emptyState('You have no courses yet — create one to get started.'),
    );
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderMyCourses(outlet)));
  }
}

function fieldLabel(text: string, htmlFor: string): HTMLElement {
  return el('label', { class: 'form-field__label', for: htmlFor, text });
}

export interface CourseIdentity {
  courseCode: string;
  name: string;
}

/** Split the instructor-facing combined label without changing the API's
 * normalized courseCode/name contract. Requiring whitespace around the
 * separator keeps hyphenated course codes and titles intact. */
export function parseCourseIdentity(value: string): CourseIdentity | undefined {
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(value.trim());
  if (!match) return undefined;
  const courseCode = match[1]?.trim() ?? '';
  const name = match[2]?.trim() ?? '';
  return courseCode && name ? { courseCode, name } : undefined;
}

/** Create Course (N2): combined course identity/section/term form, with an
 * immediate client-side duplicate guard backed by server/database enforcement. */
export async function renderCreateCourse(outlet: HTMLElement): Promise<void> {
  const user = getSession().user;
  if (!user?.isAdmin && !user?.platformInstructor) {
    mount(
      outlet,
      el(
        'div',
        { class: 'view' },
        pageHeader('Create Course', ''),
        errorState('Platform Instructor access is required to create a course.'),
      ),
    );
    return;
  }

  const root = el(
    'div',
    { class: 'view' },
    pageHeader('Create Course', "Set up a new course. You'll configure Topics, materials, and questions next."),
  );
  mount(outlet, root);

  const identityInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'course-identity',
    placeholder: 'COMM 298 - Introduction to Finance',
    required: 'required',
    'aria-describedby': 'course-identity-help',
  }) as HTMLInputElement;
  const sectionInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'course-section',
    placeholder: '101',
  }) as HTMLInputElement;
  // Academic year and term are both fixed vocabularies — UBC runs exactly
  // four teaching terms per academic year — so they are selects, not free
  // text. They are stored combined into the single `term` string the API
  // takes (see `formatTerm`), and both preselect the next term to begin.
  const now = new Date();
  const defaults = defaultTermSelection(now);
  const academicYearInput = el(
    'select',
    { class: 'input', id: 'course-academic-year', required: 'required' },
    ...academicYearOptions(now).map((academicYear) =>
      el('option', {
        value: academicYear,
        text: academicYear,
        selected: academicYear === defaults.academicYear ? 'selected' : undefined,
      }),
    ),
  ) as HTMLSelectElement;
  const termInput = el(
    'select',
    { class: 'input', id: 'course-term', required: 'required' },
    ...UBC_TERM_NAMES.map((termName) =>
      el('option', {
        value: termName,
        text: termName,
        selected: termName === defaults.termName ? 'selected' : undefined,
      }),
    ),
  ) as HTMLSelectElement;
  /** The two dropdowns as the single string the course record stores. */
  const currentTerm = (): string => formatTerm(termInput.value, academicYearInput.value);
  const errorSlot = el('div', {});
  const duplicateSlot = el('div', {});
  const createButton = el(
    'button',
    { class: 'btn btn--instr-primary', type: 'submit' },
    'Create course',
  ) as HTMLButtonElement;

  // The client explains the conflict immediately; the server remains the
  // race-safe source of truth through the unique normalized identity key.
  let existingCourses: InstructorCourse[] = [];

  const updateDuplicateCallout = (): void => {
    const identity = parseCourseIdentity(identityInput.value);
    const duplicate = findDuplicateCourse(
      existingCourses,
      identity?.courseCode ?? '',
      sectionInput.value,
      currentTerm(),
    );
    createButton.disabled = Boolean(duplicate);
    if (!duplicate) {
      duplicateSlot.replaceChildren();
      return;
    }
    duplicateSlot.replaceChildren(
      el(
        'div',
        { class: 'duplicate-callout' },
        el('p', {
          class: 'duplicate-callout__title',
          text: `Section ${duplicate.section || '—'} of ${duplicate.courseCode} for ${duplicate.term} already exists.`,
        }),
        el('p', {
          class: 'duplicate-callout__body',
          text: 'Change the section or term, or open the existing course.',
        }),
        el(
          'button',
          { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => navigate(`/instructor/course/${encodeURIComponent(duplicate._id)}`) },
          'Go to existing',
        ),
      ),
    );
  };

  identityInput.addEventListener('input', updateDuplicateCallout);
  academicYearInput.addEventListener('change', updateDuplicateCallout);
  sectionInput.addEventListener('input', updateDuplicateCallout);
  termInput.addEventListener('change', updateDuplicateCallout);

  void listInstructorCourses()
    .then((courses) => {
      existingCourses = courses;
      updateDuplicateCallout();
    })
    .catch(() => {
      // Best-effort client feedback. The server still rejects duplicates when
      // the course list cannot be loaded or another request wins a race.
    });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    errorSlot.replaceChildren();
    const identity = parseCourseIdentity(identityInput.value);
    const section = sectionInput.value.trim();
    // No trim/blank guard on term: both selects always carry one of their
    // generated option values, so it can never arrive empty or padded.
    const term = currentTerm();
    if (!identity) {
      errorSlot.replaceChildren(
        errorState('Enter the course as “COMM 298 - Introduction to Finance”.'),
      );
      return;
    }
    const duplicate = findDuplicateCourse(existingCourses, identity.courseCode, section, term);
    if (duplicate) {
      updateDuplicateCallout();
      errorSlot.replaceChildren(errorState('This course section already exists and cannot be created again.'));
      return;
    }
    try {
      const created = await createCourse({
        name: identity.name,
        courseCode: identity.courseCode,
        ...(section ? { section } : {}),
        term,
      });
      navigate(`/instructor/course/${encodeURIComponent(created._id)}`);
    } catch (error) {
      const rawMessage = error instanceof ApiError ? error.message : (error as Error).message;
      const message = rawMessage === 'course-already-exists'
        ? 'This course section already exists. Change the section or term.'
        : rawMessage;
      errorSlot.replaceChildren(errorState(message));
    }
  };

  root.append(
    el(
      'form',
      { class: 'form stack', onsubmit: (e: Event) => void submit(e) },
      el(
        'div',
        { class: 'form-field' },
        fieldLabel('Course name *', 'course-identity'),
        identityInput,
        el('span', {
          class: 'form-field__help',
          id: 'course-identity-help',
          text: 'Use the format course code - title.',
        }),
      ),
      el('div', { class: 'form-field' }, fieldLabel('Course section', 'course-section'), sectionInput),
      el(
        'div',
        { class: 'term-fields' },
        el('div', { class: 'form-field' }, fieldLabel('Academic Year *', 'course-academic-year'), academicYearInput),
        el('div', { class: 'form-field' }, fieldLabel('Term *', 'course-term'), termInput),
      ),
      duplicateSlot,
      errorSlot,
      el(
        'div',
        { class: 'row' },
        createButton,
        el(
          'button',
          { class: 'btn btn--ghost', type: 'button', onclick: () => navigate('/instructor/courses') },
          'Cancel',
        ),
      ),
    ),
  );
}

// Satisfies the `renderX(outlet, params)` view signature main.ts's route
// table expects; My Courses takes no route params.
export function renderCourses(outlet: HTMLElement, _params: RouteParams): void {
  void renderMyCourses(outlet);
}
