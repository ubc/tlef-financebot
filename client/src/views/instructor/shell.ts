// Instructor sidebar nav data + active-state resolution. Kept DOM-free (same
// spirit as route-match.ts) so it's usable from main.ts's DOM-building code
// without pulling any browser globals into this module — main.ts turns this
// data into the actual green sidebar. See
// docs/superpowers/plans/phase-1/Saurav/task-15-wireframe-reference.md
// ("Shell (all instructor screens)") for the nav-group layout this mirrors.
import { matchRoute } from '../../route-match.js';

export interface InstructorNavItem {
  /** Sidebar label. */
  label: string;
  /** Route pattern (matches the ROUTES table in main.ts), e.g.
   * '/instructor/course/:id' or '/instructor/course/:id/materials'. `null`
   * for out-of-scope items that have no destination yet. */
  path: string | null;
  /** Out-of-scope nav (Analytics, TAs, Co-instructors, Import) — renders
   * visible but inactive so the shell matches the wireframe (Task-15 Global
   * Constraints). */
  disabled?: boolean;
}

export interface InstructorNavGroup {
  /** '' for the ungrouped top-level entries (My Courses). */
  label: string;
  items: InstructorNavItem[];
}

/** The instructor sidebar's nav groups, in wireframe order. Course-scoped
 * items carry a `:id` segment in their path pattern — `resolveHref` fills it
 * in from the current route's courseId. */
export const INSTRUCTOR_NAV: InstructorNavGroup[] = [
  {
    label: '',
    items: [{ label: 'My Courses', path: '/instructor/courses' }],
  },
  {
    label: '',
    items: [
      { label: 'Course Dashboard', path: '/instructor/course/:id' },
      { label: 'Course Structure', path: '/instructor/course/:id/structure' },
      { label: 'Course Materials', path: '/instructor/course/:id/materials' },
    ],
  },
  {
    label: 'Question Bank',
    items: [
      { label: 'Review Queue', path: '/instructor/course/:id/queue' },
      { label: 'Question Bank', path: '/instructor/course/:id/bank' },
      { label: 'Import', path: null, disabled: true },
    ],
  },
  {
    label: '',
    items: [{ label: 'Student Analytics', path: null, disabled: true }],
  },
  {
    label: 'Course Settings',
    items: [
      { label: 'Settings', path: '/instructor/course/:id/settings' },
      { label: 'Teaching Assistants', path: null, disabled: true },
      { label: 'Co-instructors', path: null, disabled: true },
    ],
  },
];

/**
 * Extracts the current course id from a hash path, e.g.
 * '/instructor/course/abc123/materials' -> 'abc123'. `null` outside any
 * course context (e.g. '/instructor/courses'). `matchRoute` requires an exact
 * segment count, so it can't match every course-scoped sub-route pattern
 * ('.../materials', '.../bank/:questionId', ...) at once — they all share the
 * same leading '/instructor/course/:id' segment at a fixed position, so pull
 * it positionally instead.
 */
export function courseIdFromPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'instructor' && segments[1] === 'course' && segments[2]) {
    return decodeURIComponent(segments[2]);
  }
  return null;
}

/** The href for a nav item given the current course context, or `null` when
 * it has nowhere to go yet (a course-scoped item before any course is
 * selected, or a disabled out-of-scope item). */
export function resolveHref(item: InstructorNavItem, courseId: string | null): string | null {
  if (item.disabled || !item.path) return null;
  if (!item.path.includes(':id')) return `#${item.path}`;
  if (!courseId) return null;
  return `#${item.path.replace(':id', encodeURIComponent(courseId))}`;
}

/** Whether `item` is the active nav entry for the current hash `path`. */
export function isNavItemActive(item: InstructorNavItem, path: string): boolean {
  if (item.disabled || !item.path) return false;
  return matchRoute(item.path, path) !== null;
}
