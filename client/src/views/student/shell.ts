// client/src/views/student/shell.ts
// Student nav config for the blue shell (mirrors views/instructor/shell.ts).
export interface StudentNavItem {
  label: string;
  /** Path suffix appended to `/course/:id`, or a literal path for course-less items. */
  path: (courseId: string) => string;
  disabled?: boolean;
}

/** Static nav shown outside an active practice session. */
export const STUDENT_NAV: StudentNavItem[] = [
  { label: 'My Courses', path: () => '/' },
  { label: 'Review Book', path: (id) => `/course/${id}/review-book` },
  { label: 'Exam Prep', path: () => '#', disabled: true },
];

/** Extracts the courseId from a student path (`/course/:id...`), or undefined
 * when not inside a course (e.g. on `/`). */
export function courseIdFromPath(path: string): string | undefined {
  const match = /^\/course\/([^/]+)/.exec(path);
  return match ? match[1] : undefined;
}

/** True while `path` is a practice route (drives the sidebar's context-panel mode). */
export function isPracticePath(path: string): boolean {
  return /^\/course\/[^/]+\/practice(-theme)?\//.test(path);
}
