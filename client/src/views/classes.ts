// EXAMPLE (Academic API demo): the Classes view. Faculty see the classes they
// teach (click one for its class list); students see the classes they are
// enrolled in; dual-role people (TAs) see both sections. Data comes from the
// role-gated /api/classes endpoints, which the server builds live from the
// Academic API (FakeAcademicAPI locally). Safe to delete along with its NAV
// entry (config.ts), route (main.ts), api.ts block, and main.css block.
import {
  ApiError,
  fetchClassList,
  fetchMyClasses,
  type ClassList,
  type ClassSummary,
  type MyClasses,
  type PeriodGroup,
} from '../api.js';
import { el } from '../dom.js';
import { badge, emptyState, errorState, eyebrow, loadingState } from '../ui.js';

/** Add the local-dev hint when the Academic API itself is down (502). */
function apiHint(error: unknown): string {
  const message = (error as Error).message;
  if (error instanceof ApiError && error.status === 502) {
    return `${message} Is the FakeAcademicAPI container running? (docker compose up in the FakeAcademicAPI checkout)`;
  }
  return message;
}

/** Badge for a non-Open section status (Open is the norm: no badge). */
function sectionStatusBadge(status: string): HTMLElement | false {
  if (status === 'Open') return false;
  return badge(status.toUpperCase(), status === 'Waitlist' ? 'muted' : 'down');
}

/** Badge for a registration status (REGISTERED is good news: green). */
function registrationBadge(status: string): HTMLElement {
  return badge(status, status === 'REGISTERED' ? 'up' : 'muted');
}

function classRow(cls: ClassSummary, onOpen?: () => void): HTMLElement {
  const children = [
    el(
      'span',
      { class: 'class-row__main' },
      el('span', { class: 'class-row__code mono', text: cls.courseCode }),
      el('span', { class: 'class-row__title', text: cls.title }),
    ),
    el(
      'span',
      { class: 'class-row__meta' },
      cls.schedule ? el('span', { class: 'class-row__schedule mono', text: cls.schedule }) : false,
      sectionStatusBadge(cls.sectionStatus),
      cls.registrationStatus ? registrationBadge(cls.registrationStatus) : false,
    ),
  ];
  // Teaching rows open the class list; enrolled rows are informational only.
  return onOpen
    ? el('button', { class: 'class-row class-row--link', type: 'button', onclick: onOpen }, ...children)
    : el('div', { class: 'class-row' }, ...children);
}

function periodSection(group: PeriodGroup, onOpen?: (cls: ClassSummary) => void): HTMLElement {
  return el(
    'div',
    { class: 'class-period' },
    el('h3', { class: 'class-period__name', text: group.periodName }),
    ...group.classes.map((cls) => classRow(cls, onOpen && (() => onOpen(cls)))),
  );
}

function classesBody(data: MyClasses, onOpen: (cls: ClassSummary) => void): HTMLElement {
  if (!data.teaching.length && !data.enrolled.length) {
    return el(
      'div',
      {},
      emptyState('You have no classes for any term.'),
      data.personFound
        ? false
        : el('p', {
            class: 'classes__note',
            text: 'This account has no Academic API person record, so there is nothing to look up.',
          }),
    );
  }
  return el(
    'div',
    {},
    data.teaching.length
      ? el(
          'section',
          {},
          el('h2', { class: 'classes__heading', text: 'Teaching' }),
          ...data.teaching.map((group) => periodSection(group, onOpen)),
        )
      : false,
    data.enrolled.length
      ? el(
          'section',
          {},
          el('h2', { class: 'classes__heading', text: 'Enrolled in' }),
          ...data.enrolled.map((group) => periodSection(group)),
        )
      : false,
  );
}

function rosterBody(roster: ClassList): HTMLElement {
  if (!roster.students.length) {
    return emptyState('No students are enrolled in this section.');
  }
  return el(
    'div',
    { class: 'roster' },
    el(
      'div',
      { class: 'roster__row roster__row--head', 'aria-hidden': 'true' },
      el('span', { text: 'Name' }),
      el('span', { text: 'Student #' }),
      el('span', { text: 'Email' }),
      el('span', { text: 'Status' }),
    ),
    ...roster.students.map((student) =>
      el(
        'details',
        { class: 'roster__student' },
        el(
          'summary',
          { class: 'roster__row' },
          el('span', { text: student.name }),
          el('span', { class: 'mono', text: student.studentId }),
          el('span', { text: student.email || '—' }),
          el('span', {}, registrationBadge(student.registrationStatus)),
        ),
        // "Everything the API returns": the raw person + registration records.
        el('pre', {
          class: 'roster__raw mono',
          text: JSON.stringify(
            { person: student.person, registration: student.registration },
            null,
            2,
          ),
        }),
      ),
    ),
  );
}

export function renderClasses(outlet: HTMLElement): void {
  const body = el('div', { class: 'card__body' });

  const showClasses = async (): Promise<void> => {
    body.replaceChildren(loadingState('Loading your classes…'));
    try {
      const data = await fetchMyClasses();
      body.replaceChildren(classesBody(data, (cls) => void showRoster(cls)));
    } catch (error) {
      body.replaceChildren(errorState(apiHint(error), () => void showClasses()));
    }
  };

  const showRoster = async (cls: ClassSummary): Promise<void> => {
    body.replaceChildren(loadingState(`Loading the class list for ${cls.courseCode}…`));
    try {
      const roster = await fetchClassList(cls.sectionId);
      body.replaceChildren(
        el(
          'div',
          {},
          el(
            'button',
            { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => void showClasses() },
            '← Back to classes',
          ),
          el('h2', { class: 'classes__heading', text: `${roster.courseCode} — ${roster.title}` }),
          el('p', {
            class: 'roster__meta',
            text: `${roster.periodName} · ${roster.students.length} enrolled`,
          }),
          rosterBody(roster),
        ),
      );
    } catch (error) {
      body.replaceChildren(errorState(apiHint(error), () => void showClasses()));
    }
  };

  outlet.append(
    el(
      'div',
      { class: 'view' },
      el(
        'div',
        { class: 'view__intro' },
        el('div', { class: 'view__eyebrow-row' }, eyebrow('Example'), badge('DEMO', 'demo')),
        el('h1', { class: 'view__title', text: 'Classes' }),
        el('p', {
          class: 'view__lead',
          text:
            'Live from the Academic API: instructors see the classes they teach ' +
            '(click one for its class list); students see the classes they are enrolled in.',
        }),
      ),
      el('section', { class: 'card' }, body),
    ),
  );

  void showClasses();
}
