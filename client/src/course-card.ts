import { el } from './dom.js';
import { statusBadge, type BadgeVariant } from './instructor-ui.js';

interface CourseCardOptions {
  courseCode: string;
  name: string;
  term: string;
  section?: string;
  status: { label: string; variant: BadgeVariant };
  actionLabel?: string;
  instructor?: string;
}

type CourseCardLink = CourseCardOptions & {
  href: string;
  /** Omit for teaching projects; null means student progress could not load. */
  coverage?: { covered: number; total: number } | null;
};

type CourseCardAction = CourseCardOptions & {
  onSelect: (event: Event) => void;
};

/** One course-project card for teaching, learning, and isolated Student Preview. */
export function courseCard(options: CourseCardLink): HTMLAnchorElement;
export function courseCard(options: CourseCardAction): HTMLButtonElement;
export function courseCard(options: CourseCardLink | CourseCardAction): HTMLElement {
  // Code is available in every role's course identity, including enrollments.
  // The same course therefore retains its cover color when switching roles.
  const tone = [...options.courseCode].reduce((total, character) => total + character.charCodeAt(0), 0) % 6;
  const actionLabel = options.actionLabel ?? 'Open →';
  const coverage = 'href' in options ? options.coverage : undefined;
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

  const isLink = 'href' in options;
  const block = isLink ? 'div' : 'span';
  const meta = isLink ? 'p' : 'span';
  const attrs = {
    class: `course-card course-card--tone-${tone}`,
    'aria-label': [
      `${actionLabel.replace(/\s*→$/, '')} ${options.courseCode} ${options.name}`,
      ...(!isLink ? [options.term, options.section ? `Section ${options.section}` : '', options.instructor] : []),
    ].filter(Boolean).join(', '),
  };
  const content = [
    el(
      block,
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
      block,
      { class: 'course-card__main' },
      el(isLink ? 'h3' : 'strong', { class: 'course-card__title', text: options.name }),
      el(meta, {
        class: 'course-card__meta',
        text: [options.term, options.section ? `Section ${options.section}` : ''].filter(Boolean).join(' · '),
      }),
      options.instructor ? el(meta, { class: 'course-card__meta course-card__owner', text: `Instructor: ${options.instructor}` }) : undefined,
      progress,
    ),
    el(
      block,
      { class: 'course-card__footer' },
      isLink ? el('span', { text: 'Course project' }) : undefined,
      el('strong', { text: actionLabel }),
    ),
  ];
  return isLink
    ? el('a', { ...attrs, href: options.href }, ...content)
    : el('button', { ...attrs, type: 'button', onclick: options.onSelect }, ...content);
}
