// The signed-in user's academic record, read from GET /api/academic/me — which
// the server looks up in the Academic API (or the local FakeAcademicAPI) by the
// user's CWL PUID. Auth-gated: the nav item shows only while signed in and the
// endpoint returns 401 otherwise (dropping the app back to the landing screen).
import { getAcademicProfile, type AcademicCourse, type AcademicProfile } from '../api.js';
import { el } from '../dom.js';
import { eyebrow, badge, loadingState, emptyState, errorState } from '../ui.js';

function kv(key: string, value: string, mono = false): HTMLElement {
  return el(
    'div',
    { class: 'kv' },
    el('span', { class: 'kv__key', text: key }),
    el('span', mono ? { class: 'mono' } : {}, value || '—'),
  );
}

function courseCard(course: AcademicCourse): HTMLElement {
  const heading = [course.subject, course.courseNumber].filter(Boolean).join(' ');
  const section = course.sectionNumber ? `Section ${course.sectionNumber}` : '';
  const meta = [section, course.period, course.status].filter(Boolean).join(' · ');
  return el(
    'div',
    { class: 'kv-list' },
    el(
      'div',
      { class: 'kv' },
      el('span', { class: 'kv__key', text: heading || course.courseSectionId }),
      el('span', { text: course.title || '—' }),
    ),
    meta ? el('p', { class: 'state__text mono', text: meta }) : false,
    course.instructors.length
      ? el('p', { class: 'state__text', text: `Instructor: ${course.instructors.join(', ')}` })
      : false,
  );
}

function courseSection(title: string, courses: AcademicCourse[], emptyMsg: string): HTMLElement {
  return el(
    'div',
    {},
    el('p', { class: 'members__attrs-label', text: title }),
    courses.length
      ? el('div', { class: 'stack' }, ...courses.map(courseCard))
      : emptyState(emptyMsg),
  );
}

function renderProfile(data: AcademicProfile): HTMLElement {
  if (!data.found) {
    return emptyState(data.note ?? 'No academic record is available for your account.');
  }

  const identity = el(
    'div',
    { class: 'kv-list' },
    kv('Name', data.displayName),
    kv('PUID', data.puid, true),
    // PUID is already shown above; the identifiers list repeats it, so drop it here.
    ...data.identifiers
      .filter((id) => id.type !== 'PUID')
      .map((id) => kv(id.type.replace(/_/g, ' '), id.value, true)),
    ...data.emails.map((e) => kv(`${e.type} email`, e.address)),
  );

  return el(
    'div',
    {},
    identity,
    el('div', { class: 'divider' }),
    courseSection('Courses you teach', data.teaching, 'No teaching assignments on record.'),
    el('div', { class: 'divider' }),
    courseSection("Courses you're enrolled in", data.enrolled, 'No course registrations on record.'),
  );
}

export function renderAcademic(outlet: HTMLElement): void {
  const body = el('div', { class: 'card__body' });

  const load = async (): Promise<void> => {
    body.replaceChildren(loadingState('Looking up your academic record…'));
    try {
      body.replaceChildren(renderProfile(await getAcademicProfile()));
    } catch (error) {
      body.replaceChildren(errorState((error as Error).message, () => void load()));
    }
  };

  outlet.append(
    el(
      'div',
      { class: 'view' },
      el(
        'div',
        { class: 'view__intro' },
        el('div', { class: 'view__eyebrow-row' }, eyebrow('Academic'), badge('GATED', 'up')),
        el('h1', { class: 'view__title', text: 'Academic record' }),
        el('p', {
          class: 'view__lead',
          text:
            'Your person record and courses, looked up from the UBC Academic API by your CWL ' +
            'PUID. Available only while signed in.',
        }),
      ),
      el('section', { class: 'card' }, body),
    ),
  );

  void load();
}
