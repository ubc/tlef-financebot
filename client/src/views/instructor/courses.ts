// My Courses (N1) + Create Course (N2) — the instructor's landing page and
// the entry point into a course's dashboard/structure/materials/bank/queue
// (Task 15, Task B). See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// (node-ids `194:2` / `198:2`).
import { ApiError, createCourse, listInstructorCourses, type InstructorCourse } from '../../api.js';
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
 * Pure matcher behind N2's non-blocking duplicate-term callout: an existing
 * course "matches" `code`/`term` when its course code and term are equal to
 * the given ones ignoring case and surrounding whitespace. Never blocks
 * submit — callers only use this to decide whether to show the amber
 * callout. Returns the first match, or `undefined` for no match (including
 * an empty course list, or a blank `code`/`term`).
 */
export function findDuplicateCourse(
  courses: InstructorCourse[],
  code: string,
  term: string,
): InstructorCourse | undefined {
  const normCode = code.trim().toLowerCase();
  const normTerm = term.trim().toLowerCase();
  if (!normCode || !normTerm) return undefined;
  return courses.find(
    (course) => course.courseCode.trim().toLowerCase() === normCode && course.term.trim().toLowerCase() === normTerm,
  );
}

function courseHref(courseId: string): string {
  return `#/instructor/course/${encodeURIComponent(courseId)}`;
}

function courseCard(course: InstructorCourse): HTMLElement {
  return el(
    'a',
    { class: 'course-card', href: courseHref(course._id) },
    el(
      'div',
      { class: 'course-card__main' },
      el('h3', { class: 'course-card__title', text: `${course.courseCode} — ${course.name}` }),
      el('p', { class: 'course-card__meta', text: course.term }),
    ),
    statusBadge(course.published ? 'Published' : 'Sandbox', course.published ? 'approved' : 'neutral'),
  );
}

/** My Courses (N1): the instructor's courses, or an empty state when they
 * hold no `instructor` courseRoles (see the Task A "known limitation" note —
 * an admin with no explicit courseRoles legitimately sees an empty list
 * here). */
export async function renderMyCourses(outlet: HTMLElement): Promise<void> {
  const body = el('div', {}, loadingState('Loading your courses…'));
  const root = el(
    'div',
    { class: 'view' },
    pageHeader('My Courses', "Select a course to manage, or create a new one.", {
      text: '+ Create course',
      onClick: () => navigate('/instructor/courses/new'),
    }),
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

function fieldLabel(text: string): HTMLElement {
  return el('label', { class: 'form-field__label', text });
}

/** Create Course (N2): name/code/term form, with a non-blocking client-side
 * duplicate-term callout (see `findDuplicateCourse`). */
export async function renderCreateCourse(outlet: HTMLElement): Promise<void> {
  const root = el(
    'div',
    { class: 'view' },
    pageHeader('Create Course', "Set up a new course. You'll configure Topics, materials, and questions next."),
  );
  mount(outlet, root);

  const nameInput = el('input', { class: 'input', type: 'text', id: 'course-name', required: 'required' }) as HTMLInputElement;
  const codeInput = el('input', { class: 'input', type: 'text', id: 'course-code', required: 'required' }) as HTMLInputElement;
  const termInput = el('input', { class: 'input', type: 'text', id: 'course-term', required: 'required' }) as HTMLInputElement;
  const errorSlot = el('div', {});
  const duplicateSlot = el('div', {});

  // Existing courses, loaded once, used purely to drive the client-derived
  // duplicate-term callout — never blocks submit (Task-15 Task B).
  let existingCourses: InstructorCourse[] = [];

  const updateDuplicateCallout = (): void => {
    const duplicate = findDuplicateCourse(existingCourses, codeInput.value, termInput.value);
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
          text: `A course with code ${duplicate.courseCode} for term ${duplicate.term} already exists.`,
        }),
        el('p', {
          class: 'duplicate-callout__body',
          text: 'Continue creating a separate new course, or go to the existing one.',
        }),
        el(
          'button',
          { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => navigate(`/instructor/course/${encodeURIComponent(duplicate._id)}`) },
          'Go to existing',
        ),
      ),
    );
  };

  codeInput.addEventListener('input', updateDuplicateCallout);
  termInput.addEventListener('input', updateDuplicateCallout);

  void listInstructorCourses()
    .then((courses) => {
      existingCourses = courses;
      updateDuplicateCallout();
    })
    .catch(() => {
      // Best-effort: the callout is a non-blocking hint, so a failed load
      // just means it never appears — the form itself still works.
    });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    errorSlot.replaceChildren();
    const name = nameInput.value.trim();
    const courseCode = codeInput.value.trim();
    const term = termInput.value.trim();
    if (!name || !courseCode || !term) {
      errorSlot.replaceChildren(errorState('Course name, code, and term are all required.'));
      return;
    }
    try {
      const created = await createCourse({ name, courseCode, term });
      navigate(`/instructor/course/${encodeURIComponent(created._id)}`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      errorSlot.replaceChildren(errorState(message));
    }
  };

  root.append(
    el(
      'form',
      { class: 'form stack', onsubmit: (e: Event) => void submit(e) },
      el('div', { class: 'form-field' }, fieldLabel('Course name *'), nameInput),
      el('div', { class: 'form-field' }, fieldLabel('Course code *'), codeInput),
      el('div', { class: 'form-field' }, fieldLabel('Term *'), termInput),
      duplicateSlot,
      errorSlot,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn btn--instr-primary', type: 'submit' }, 'Create course'),
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
