// Question labels shared by the instructor Questions workspace, question
// detail, and the TA views. DOM-free so it unit-tests under node. Moved out of
// views/instructor/bank.ts (2026-11-09) ahead of that page's removal.
import type { CourseTree, PublicationState, QuestionType } from './api.js';
import type { BadgeVariant } from './instructor-ui.js';

/** Question status -> wireframe display label. `reviewed` reads as
 * "Pre-Approved" in the wireframe (see task-15-wireframe-reference.md's
 * "Status/badge vocabulary"), not the raw domain name. */
export const STATUS_LABEL: Record<PublicationState, string> = {
  draft: 'Draft',
  'pending-review': 'Pending Review',
  reviewed: 'Pre-Approved',
  approved: 'Approved',
  paused: 'Paused',
  archived: 'Archived',
};

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'MCQ',
  'true-false': 'True/False',
};

/** Question status -> `statusBadge` variant (instructor-ui.ts). Exported for
 * reuse by question-detail.ts's own state badge. */
export function statusToBadgeVariant(state: PublicationState): BadgeVariant {
  switch (state) {
    case 'draft':
      return 'draft';
    case 'pending-review':
      return 'pending';
    case 'reviewed':
      return 'reviewed';
    case 'approved':
      return 'approved';
    case 'paused':
      return 'paused';
    case 'archived':
      return 'archived';
  }
}

/** Names of the question's tagged Topics that are not released (no date, or
 * a date still ahead — the server's theme-release.ts rule). An Approved
 * question with any such Topic is held back from students everywhere, so
 * the bank row says so next to its status. Pure, tested. */
export function heldBackTopics(tree: CourseTree, themeIds: readonly string[], now: Date = new Date()): string[] {
  return tree.themes
    .filter((theme) => themeIds.includes(theme._id))
    .filter((theme) => {
      const date = theme.availableFrom ? new Date(theme.availableFrom) : null;
      return !date || Number.isNaN(date.getTime()) || date > now;
    })
    .map((theme) => theme.name);
}
