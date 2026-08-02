// Where a notification takes you when you click it in the bell (§4.3).
// Kept as a standalone pure module rather than a helper inside
// notifications-bell.ts so it can be unit-tested under Jest's Node
// environment -- the bell itself is DOM-bound and is covered by Playwright
// instead (tests/AGENTS.md).
import type { AppNotification } from './api.js';

export type NotificationAudience = 'instructor' | 'ta' | 'student';

/**
 * The in-app destination for a notification, or null when there isn't one:
 * students (whose bell is informational only), anything missing the
 * `courseId` every course-scoped route needs, or a kind with no staff
 * surface to land on.
 *
 * Flag-ish kinds all land on the FLAG QUEUE rather than the instructor
 * question editor: the queue is where the flag reasons and the
 * Return/Edit/Archive actions live, and it exists for TAs too (the question
 * editor does not). The subject is passed as a query param for the view to
 * scroll to and highlight -- `?flag=` when the ref is a flag, `?question=`
 * when it is a question. A kind whose ref is missing still routes to the
 * queue, just without a highlight; landing on the right surface beats doing
 * nothing.
 */
export function notificationTarget(n: AppNotification, audience: NotificationAudience): string | null {
  if (audience === 'student') return null;
  if (!n.courseId) return null;

  const course = encodeURIComponent(n.courseId);
  const flags = audience === 'ta' ? `/ta/course/${course}/flags` : `/instructor/course/${course}/flags`;
  const review = audience === 'ta' ? `/ta/course/${course}/review` : `/instructor/course/${course}/queue`;
  const ref = n.refId ? encodeURIComponent(n.refId) : undefined;

  switch (n.kind) {
    case 'flag':
    case 'flag-resolved':
      return ref ? `${flags}?flag=${ref}` : flags;
    case 'auto-pause':
    case 'correction':
      return ref ? `${flags}?question=${ref}` : flags;
    case 'review-backlog':
      return review;
    case 'daily-summary':
      return flags;
    // 'redirect' is student-facing; anything unrecognised is deliberately
    // inert rather than guessed at.
    default:
      return null;
  }
}
