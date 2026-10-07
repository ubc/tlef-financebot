import { learningApi } from '../../student-learning-api.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { clearPracticeActions } from '../../practice-actions.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import { renderLinearLesson } from './learning-workspace.js';
import { renderTopicPracticeWorkspace } from './topic-practice-workspace.js';
import { LIVE_STUDENT_EXPERIENCE, type StudentExperience } from './experience.js';

/** Both teaching modes use the question workspace; settings select the engine. */
export async function renderPracticeWithExperience(
  outlet: HTMLElement, params: RouteParams, experience: StudentExperience,
): Promise<void> {
  clearPracticeActions();
  const loading = loadingState('Loading practice…');
  outlet.append(loading);
  try {
    const library = await learningApi(params.id, experience.preview).library();
    if (!loading.isConnected) return;
    loading.remove();
    const review = currentQuery().get('mode') === 'review-book';
    if (library.settings.mode === 'linear' && !review) {
      const themeId = params.themeId ?? library.questions.find(q => q.loId === params.loId)?.themeId;
      if (!themeId) { outlet.append(emptyState('No released questions are available for this objective.')); return; }
      await renderLinearLesson(outlet, params.id, themeId, experience);
    } else {
      await renderTopicPracticeWorkspace(outlet, params, experience, library, review ? 'review-book' : 'topic-practice');
    }
  } catch (error) {
    if (loading.isConnected) loading.replaceWith(errorState((error as Error).message));
  }
}

export function renderPractice(outlet: HTMLElement, params: RouteParams): Promise<void> {
  return renderPracticeWithExperience(outlet, params, LIVE_STUDENT_EXPERIENCE);
}
