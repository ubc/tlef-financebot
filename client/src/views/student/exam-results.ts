import { getExamResults, type ExamBreakdown, type ExamResultQuestion } from '../../api.js';
import { el } from '../../dom.js';
import { renderRichText } from '../../render.js';
import { copyrightFooter, pageHeader } from '../../student-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function breakdownRow(
  label: string,
  item: ExamBreakdown,
  href: string | null,
): HTMLElement {
  const percent = item.possible ? Math.round((item.earned / item.possible) * 100) : 0;
  return el('div', { class: 'exam-breakdown-row' },
    el('div', { class: 'exam-breakdown-row__label' },
      el('span', { text: label }),
      el('span', { text: `${item.earned}/${item.possible} · ${percent}%` }),
    ),
    el('progress', { max: item.possible, value: item.earned, 'aria-label': `${label}: ${percent}%` }),
    href ? el('a', { class: 'exam-breakdown-row__link', href }, 'Practice this weak area →') : false,
  );
}

function reviewQuestion(question: ExamResultQuestion): HTMLElement {
  const stem = el('div', { class: 'exam-review__stem' });
  renderRichText(stem, question.stem);
  return el('article', { class: `exam-review${question.correct ? ' is-correct' : ' is-missed'}` },
    el('h3', { text: `Question ${question.index + 1} · ${question.correct ? 'Correct' : 'Missed'}` }),
    stem,
    ...question.options.map((option) => {
      const text = el('div', { class: 'exam-review-option__text' });
      renderRichText(text, option.text);
      const explanation = el('div', { class: 'exam-review-option__explanation' });
      renderRichText(explanation, option.explanation);
      return el('div', {
        class: `exam-review-option${option.correct ? ' is-answer' : ''}${question.selectedKey === option.key ? ' is-selected' : ''}`,
      },
      el('p', { class: 'exam-review-option__label', text: `${option.key} · ${option.role.replace(/-/g, ' ')}` }),
      text,
      explanation,
      );
    }),
  );
}

export async function renderExamResults(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const attemptId = params.attemptId;
  const root = el('div', { class: 'view' }, loadingState('Loading exam results…'));
  outlet.append(root);
  try {
    const result = await getExamResults(attemptId);
    root.replaceChildren(
      pageHeader(
        `${result.kind === 'midterm' ? 'Midterm' : 'Final'} results`,
        `Submitted ${new Date(result.submittedAt).toLocaleString()}`,
      ),
      el('section', { class: 'exam-score-card' },
        el('p', { class: 'exam-score-card__score', text: `${result.score} / ${result.maxScore}` }),
        el('p', { class: 'exam-score-card__label', text: 'Total score' }),
      ),
      el('section', {},
        el('h2', { class: 'section-title', text: 'By Topic' }),
        ...result.byTheme.map((item) => breakdownRow(
          item.name,
          item,
          item.practiceLink?.themeId
            ? `#/course/${encodeURIComponent(courseId)}/practice-theme/${encodeURIComponent(item.practiceLink.themeId)}`
            : null,
        )),
      ),
      ...(result.byLo ? [el('section', {},
        el('h2', { class: 'section-title', text: 'By Learning Objective' }),
        ...result.byLo.map((item) => breakdownRow(
          item.name,
          item,
          item.practiceLink?.loId
            ? `#/course/${encodeURIComponent(courseId)}/practice/${encodeURIComponent(item.practiceLink.loId)}`
            : null,
        )),
      )] : []),
      el('div', { class: 'view-actions' },
        el('a', { class: 'btn btn--ghost', href: `#/course/${encodeURIComponent(courseId)}/review-book` }, 'Open Review Book'),
        el('a', { class: 'btn btn--ghost', href: `#/course/${encodeURIComponent(courseId)}/exam-history` }, 'Exam history'),
        el('a', { class: 'btn btn--primary', href: `#/course/${encodeURIComponent(courseId)}/exams` }, 'Back to Exam Prep'),
      ),
      el('section', { class: 'exam-review-list' },
        el('h2', { class: 'section-title', text: 'Question review' }),
        ...result.questions.map(reviewQuestion),
      ),
      copyrightFooter(),
    );
  } catch (error) {
    root.replaceChildren(errorState(
      (error as Error).message,
      () => void renderExamResults(outlet, params),
    ));
  }
}
