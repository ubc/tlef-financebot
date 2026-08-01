import {
  getExamAttempt,
  saveExamAnswer,
  submitExamAttempt,
} from '../../api.js';
import { el } from '../../dom.js';
import { renderRichText } from '../../render.js';
import { copyrightFooter } from '../../student-ui.js';
import { errorState, loadingState, optionButton } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function resultHash(courseId: string, attemptId: string): string {
  return `/course/${encodeURIComponent(courseId)}/exam-attempt/${encodeURIComponent(attemptId)}/results`;
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export async function renderExamAttempt(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  const attemptId = params.attemptId;
  const root = el('div', { class: 'view exam-live' }, loadingState('Loading your exam…'));
  outlet.append(root);

  try {
    const state = await getExamAttempt(attemptId);
    if (state.submitted) {
      window.location.hash = resultHash(courseId, attemptId);
      return;
    }
    let current = Math.max(0, state.answers.findIndex((answer) => answer === null));
    if (current < 0) current = 0;
    let remaining = state.remainingSeconds;
    let submitting = false;

    const finish = async (): Promise<void> => {
      if (submitting) return;
      submitting = true;
      try {
        await submitExamAttempt(attemptId);
        window.location.hash = resultHash(courseId, attemptId);
      } catch (error) {
        submitting = false;
        window.alert((error as Error).message);
      }
    };

    const render = (): void => {
      const question = state.questions[current];
      if (!question) {
        root.replaceChildren(errorState('This exam contains no questions.'));
        return;
      }
      const stem = el('div', { class: 'exam-question__stem' });
      renderRichText(stem, question.stem);
      const timer = remaining === undefined
        ? false
        : el('p', {
            class: `exam-timer${remaining <= 300 ? ' exam-timer--warning' : ''}`,
            role: 'timer',
            'aria-live': remaining <= 300 ? 'polite' : 'off',
            text: `Time remaining ${formatClock(remaining)}`,
          });
      const nav = el(
        'div',
        { class: 'exam-question-grid', 'aria-label': 'Question navigation' },
        ...state.questions.map((_item, index) => el(
          'button',
          {
            class: `exam-question-grid__item${state.answers[index] !== null ? ' is-answered' : ''}${index === current ? ' is-current' : ''}`,
            type: 'button',
            'aria-current': index === current ? 'step' : undefined,
            onclick: () => {
              current = index;
              render();
            },
          },
          String(index + 1),
        )),
      );
      const options = el(
        'div',
        { class: 'exam-options' },
        ...question.options.map((option) => optionButton(
          option.key,
          option.text,
          state.answers[current] === option.key ? 'selected' : 'idle',
          () => {
            const answerIndex = current;
            const previous = state.answers[answerIndex];
            state.answers[answerIndex] = option.key;
            question.answered = true;
            render();
            void saveExamAnswer(attemptId, answerIndex, option.key).catch((error: Error) => {
              state.answers[answerIndex] = previous;
              question.answered = previous !== null;
              render();
              window.alert(error.message);
            });
          },
        )),
      );
      const unanswered = state.answers.flatMap((answer, index) => answer === null ? [index + 1] : []);
      root.replaceChildren(
        el('header', { class: 'exam-live__header' },
          el('div', {},
            el('p', { class: 'eyebrow', text: 'EXAM PREP · SINGLE SITTING' }),
            el('h1', { text: state.kind === 'midterm' ? 'Midterm Exam Prep' : 'Final Exam Prep' }),
            el('p', { class: 'muted', text: 'Answers are saved as you work. Feedback appears only after submission.' }),
          ),
          timer,
        ),
        nav,
        ...(state.shortfalls.length
          ? [el('p', {
              class: 'banner',
              text: 'This sitting contains fewer questions than configured because the Approved bank is short.',
            })]
          : []),
        el('article', { class: 'exam-question' },
          el('p', { class: 'exam-question__number', text: `Question ${current + 1} of ${state.questions.length} · ${question.points} point${question.points === 1 ? '' : 's'}` }),
          stem,
          options,
        ),
        el('div', { class: 'exam-controls' },
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            disabled: current === 0 ? 'disabled' : undefined,
            onclick: () => { current -= 1; render(); },
          }, 'Previous'),
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            disabled: current === state.questions.length - 1 ? 'disabled' : undefined,
            onclick: () => { current += 1; render(); },
          }, 'Next'),
          el('button', {
            class: 'btn btn--primary',
            type: 'button',
            onclick: () => {
              const warning = unanswered.length
                ? `Questions ${unanswered.join(', ')} are unanswered. Submit anyway?`
                : 'Submit this exam? You cannot change answers afterward.';
              if (window.confirm(warning)) void finish();
            },
          }, `Submit exam${unanswered.length ? ` (${unanswered.length} unanswered)` : ''}`),
        ),
        copyrightFooter(),
      );
    };

    render();
    if (remaining !== undefined) {
      const timerId = window.setInterval(() => {
        if (!root.isConnected) {
          window.clearInterval(timerId);
          return;
        }
        remaining = Math.max(0, (remaining ?? 0) - 1);
        if (remaining === 0) {
          window.clearInterval(timerId);
          void finish();
          return;
        }
        render();
      }, 1000);
    }
  } catch (error) {
    root.replaceChildren(errorState(
      (error as Error).message,
      () => void renderExamAttempt(outlet, params),
    ));
  }
}
