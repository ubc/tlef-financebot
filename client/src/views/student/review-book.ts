import type { RouteParams } from '../../router.js';
import { LIVE_STUDENT_EXPERIENCE, type StudentExperience } from './experience.js';
import { renderReviewLibrary } from './learning-workspace.js';

/** Live students and isolated Preview share the same released-question library. */
export function renderReviewBookWithExperience(outlet: HTMLElement, params: RouteParams, experience: StudentExperience): Promise<void> {
  return renderReviewLibrary(outlet, params.id, experience);
}

export function renderReviewBook(outlet: HTMLElement, params: RouteParams): Promise<void> {
  return renderReviewBookWithExperience(outlet, params, LIVE_STUDENT_EXPERIENCE);
}
