import {
  listActiveExams,
  startExamAttempt,
  type ExamTemplate,
} from '../../api.js';
import { el } from '../../dom.js';
import { copyrightFooter, pageHeader } from '../../student-ui.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function totalQuestions(template: ExamTemplate): number {
  return template.themes.reduce(
    (sum, theme) => sum + theme.mcqCount + theme.tfCount,
    0,
  );
}

function templateCard(courseId: string, template: ExamTemplate): HTMLElement {
  const start = el('button', { class: 'btn btn--primary', type: 'button' }, 'Start exam');
  start.addEventListener('click', () => {
    start.setAttribute('disabled', 'disabled');
    start.textContent = 'Opening…';
    void startExamAttempt(courseId, template._id)
      .then((attempt) => {
        window.location.hash = `/course/${encodeURIComponent(courseId)}/exam-attempt/${encodeURIComponent(attempt._id)}`;
      })
      .catch((error: Error) => {
        start.removeAttribute('disabled');
        start.textContent = 'Start exam';
        window.alert(error.message);
      });
  });
  return el(
    'article',
    { class: 'exam-card' },
    el('div', { class: 'exam-card__head' },
      el('div', {},
        el('p', { class: 'eyebrow', text: 'EXAM PREP' }),
        el('h2', { class: 'exam-card__title', text: template.kind === 'midterm' ? 'Midterm' : 'Final' }),
      ),
      start,
    ),
    el('p', {
      class: 'exam-card__meta',
      text: `${totalQuestions(template)} questions · ${template.timeLimitMinutes ? `${template.timeLimitMinutes} minutes` : 'No time limit'}`,
    }),
    el('p', {
      class: 'exam-card__meta',
      text: `Available until ${new Date(template.availabilityEnd).toLocaleString()}`,
    }),
  );
}

export async function renderExamSelect(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const root = el('div', { class: 'view' }, loadingState('Loading Exam Prep…'));
  outlet.append(root);
  try {
    const templates = await listActiveExams(courseId);
    root.replaceChildren(
      pageHeader('Exam Prep', 'Choose an available midterm or final practice sitting.'),
      el('div', { class: 'view-actions' },
        el('a', {
          class: 'btn btn--ghost',
          href: `#/course/${encodeURIComponent(courseId)}/exam-history`,
        }, 'View exam history'),
        el('a', {
          class: 'btn btn--ghost',
          href: `#/course/${encodeURIComponent(courseId)}`,
        }, 'Back to course'),
      ),
      templates.length
        ? el('div', { class: 'exam-card-grid' }, ...templates.map((template) => templateCard(courseId, template)))
        : emptyState('No Exam Prep sitting is available right now.'),
      copyrightFooter(),
    );
  } catch (error) {
    root.replaceChildren(errorState((error as Error).message, () => void renderExamSelect(outlet, params)));
  }
}
