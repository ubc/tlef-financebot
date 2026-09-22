import { el } from './dom.js';
import { statusBadge, type BadgeVariant } from './instructor-ui.js';

export interface CourseCardOptions {
  courseCode: string;
  name: string;
  term: string;
  section?: string;
  href: string;
  status: { label: string; variant: BadgeVariant };
  actionLabel?: string;
  /** Omit for teaching projects; null means student progress could not load. */
  coverage?: { covered: number; total: number } | null;
}

/** One course-project card for teaching, learning, and isolated Student Preview. */
export function courseCard(options: CourseCardOptions): HTMLAnchorElement {
  // Code is available in every role's course identity, including enrollments.
  // The same course therefore retains its cover color when switching roles.
  const tone = [...options.courseCode].reduce((total, character) => total + character.charCodeAt(0), 0) % 6;
  const actionLabel = options.actionLabel ?? 'Open →';
  const coverage = options.coverage;
  const progress = coverage === undefined ? undefined : el(
    'div',
    { class: 'course-card__progress' },
    coverage === null ? false : el(
      'div',
      {
        class: 'coverage-bar',
        role: 'progressbar',
        'aria-label': 'Learning objectives covered',
        'aria-valuemin': '0',
        'aria-valuemax': String(Math.max(coverage.total, 1)),
        'aria-valuenow': String(coverage.covered),
        'aria-valuetext': `${coverage.covered} of ${coverage.total} learning objectives covered`,
      },
      el('div', {
        class: 'coverage-bar__fill',
        style: `width:${coverage.total ? Math.min(100, Math.max(0, coverage.covered / coverage.total * 100)) : 0}%`,
      }),
    ),
    el('span', {
      class: 'course-card__progress-label',
      text: coverage ? `${coverage.covered}/${coverage.total} LOs covered` : 'Progress unavailable',
    }),
  );

  return el(
    'a',
    {
      class: `course-card course-card--tone-${tone}`,
      href: options.href,
      'aria-label': `${actionLabel.replace(/\s*→$/, '')} ${options.courseCode} ${options.name}`,
    },
    el(
      'div',
      { class: 'course-card__cover' },
      el('span', { class: 'course-card__code', text: options.courseCode }),
      statusBadge(options.status.label, options.status.variant),
      el('span', {
        class: 'course-card__monogram',
        'aria-hidden': 'true',
        text: options.courseCode.split(/\s+/).map((part) => part[0]).join('').slice(0, 3),
      }),
    ),
    el(
      'div',
      { class: 'course-card__main' },
      el('h3', { class: 'course-card__title', text: options.name }),
      el('p', {
        class: 'course-card__meta',
        text: [options.term, options.section ? `Section ${options.section}` : ''].filter(Boolean).join(' · '),
      }),
      progress,
    ),
    el(
      'div',
      { class: 'course-card__footer' },
      el('span', { text: 'Course project' }),
      el('strong', { text: actionLabel }),
    ),
  );
}
