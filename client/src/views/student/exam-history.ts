import { getExamHistory } from '../../api.js';
import { el } from '../../dom.js';
import { copyrightFooter, pageHeader } from '../../student-ui.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

export async function renderExamHistory(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const root = el('div', { class: 'view' }, loadingState('Loading exam history…'));
  outlet.append(root);
  try {
    const history = await getExamHistory(courseId);
    root.replaceChildren(
      pageHeader('Exam history', 'Review scores and open any completed sitting.'),
      el('div', { class: 'view-actions' },
        el('a', { class: 'btn btn--ghost', href: `#/course/${encodeURIComponent(courseId)}/exams` }, 'Back to Exam Prep'),
      ),
      history.length
        ? el('div', { class: 'exam-history-list' }, ...history.map((item) => el(
            'a',
            {
              class: 'exam-history-row',
              href: `#/course/${encodeURIComponent(courseId)}/exam-attempt/${encodeURIComponent(item.attemptId)}/results`,
            },
            el('span', { class: 'exam-history-row__kind', text: item.kind === 'midterm' ? 'Midterm' : 'Final' }),
            el('span', { text: new Date(item.date).toLocaleString() }),
            el('strong', { text: `${item.score}/${item.maxScore}` }),
          )))
        : emptyState('No completed Exam Prep sittings yet.'),
      copyrightFooter(),
    );
  } catch (error) {
    root.replaceChildren(errorState(
      (error as Error).message,
      () => void renderExamHistory(outlet, params),
    ));
  }
}
