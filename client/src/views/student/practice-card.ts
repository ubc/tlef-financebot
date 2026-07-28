// The single-question card: selectable options, submit/lock/reveal, and the
// Strategy-A retry-in-place recursion. Factored out of practice.ts (which
// owns the LO/theme walking loop) to keep each file under the house style's
// ~200-line guideline — see client/AGENTS.md.
import {
  flagPracticeQuestion,
  submitAttempt,
  type AttemptResult,
  type CourseHomeLo,
  type CourseHomeTheme,
  type PracticeMode,
  type PracticeQuestion,
} from '../../api.js';
import type { PracticeSession } from '../../practice-session.js';
import { el, mount } from '../../dom.js';
import { errorState, optionButton, watermark } from '../../ui.js';
import { renderRichText } from '../../render.js';

export interface PracticeCtx {
  courseId: string;
  theme: CourseHomeTheme['theme'];
  los: CourseHomeLo[];
  loIndex: number;
  isThemeMode: boolean;
  mode: PracticeMode;
}

export interface Callbacks {
  onTranscriptChange: () => void;
  onNext: () => void;
  onAdvanceLo: () => void;
  onSkip: () => void;
}

export const currentLo = (ctx: PracticeCtx): CourseHomeLo => ctx.los[ctx.loIndex];

function retryAsQuestion(retry: NonNullable<AttemptResult['feedback']['retry']>, watermarkUid: string, difficulty: PracticeQuestion['difficulty']): PracticeQuestion {
  return { ...retry, difficulty, degraded: 'none', watermark: watermarkUid };
}

/** Builds one question card. Recurses once for a Strategy-A retry question,
 * embedded in place below the original's chosen-only reveal — `isRetry` is
 * passed explicitly (not inferred) so `POST /api/attempts { isRetry }` is
 * accurate regardless of submission order. */
export function makeQuestionCard(
  ctx: PracticeCtx,
  session: PracticeSession,
  question: PracticeQuestion,
  callbacks: Callbacks,
  isRetry = false,
): HTMLElement {
  const card = el('div', { class: 'practice-card' });
  let selectedKey: string | undefined;
  let result: AttemptResult | undefined;
  let submitting = false;
  let flagState: 'idle' | 'editing' | 'submitting' | 'flagged' = 'idle';
  let flagReason = '';
  let flagError: string | undefined;
  // Q-numbering (Figma 4/5/6): fixed at card-construction time, not
  // recomputed on every `draw()` — `submit()` pushes this same question
  // into `session.transcript` partway through this card's life, so reading
  // `session.transcript.length` inside `draw()` would relabel this card
  // (e.g. "Q1" pre-submit becoming "Q2" post-submit) once its own attempt
  // is recorded. A retry-in-place recursion still gets the next number
  // correctly, since its `makeQuestionCard` call happens (and captures
  // this) after the original's attempt is already recorded.
  const questionNumber = session.transcript.length + 1;

  const submit = async (): Promise<void> => {
    if (!selectedKey || submitting) return;
    submitting = true;
    draw();
    try {
      result = await submitAttempt({
        questionVersionId: question.questionVersionId,
        loId: currentLo(ctx).lo._id,
        selectedKey,
        mode: ctx.mode,
        sessionServedIds: session.sessionServedIds,
        ...(isRetry ? { isRetry: true } : {}),
        ...(question.paramValues !== undefined ? { paramValues: question.paramValues } : {}),
      });
      session.recordAttempt({ question, selectedKey, result, loId: currentLo(ctx).lo._id });
      callbacks.onTranscriptChange();
    } catch (error) {
      submitting = false;
      card.replaceChildren(errorState((error as Error).message, () => void submit()));
      return;
    }
    submitting = false;
    draw();
  };

  const submitFlag = async (): Promise<void> => {
    if (flagState === 'submitting' || flagState === 'flagged') return;
    flagState = 'submitting';
    flagError = undefined;
    draw();
    try {
      await flagPracticeQuestion(question.questionId, flagReason);
      flagState = 'flagged';
    } catch (error) {
      flagState = 'editing';
      flagError = (error as Error).message;
    }
    draw();
  };

  const draw = (): void => {
    const typeLabel = question.type === 'mcq' ? 'Multiple Choice' : 'True/False';
    const qLabel = el('p', { class: 'eyebrow practice-card__qlabel', text: `Q${questionNumber} — ${typeLabel}` });

    const stemEl = el('div', { class: 'practice-card__stem' });
    renderRichText(stemEl, question.stem);

    const locked = result !== undefined;
    const revealed = result?.feedback.revealed;
    const options = question.options.map((o) => {
      let state: 'idle' | 'selected' | 'correct' | 'incorrect' | 'hidden-choice' = 'idle';
      if (locked) {
        const rev = revealed?.find((r) => r.key === o.key);
        if (rev) state = rev.correct ? 'correct' : 'incorrect';
        else state = 'hidden-choice';
      } else if (o.key === selectedKey) {
        state = 'selected';
      }
      return optionButton(
        o.key,
        o.text,
        state,
        locked
          ? undefined
          : () => {
              selectedKey = o.key;
              draw();
            },
      );
    });

    const feedback = result
      ? el('p', {
          class: `practice-card__result practice-card__result--${result.correct ? 'correct' : 'incorrect'}`,
          text: result.correct ? 'Correct!' : 'Not quite — see the explanation below.',
        })
      : false;

    const explanations =
      locked && revealed
        ? el(
            'div',
            { class: 'practice-card__explanations' },
            ...revealed.map((r) => el('p', { class: 'practice-card__explanation', text: `${r.key}. ${r.explanation}` })),
          )
        : false;

    const retry = result?.feedback.retry;
    let retryCard: HTMLElement | false = false;
    let footer: HTMLElement;

    const flagFormId = `flag-${question.questionVersionId}-${questionNumber}`;
    const flagControl = (): HTMLElement => {
      if (flagState === 'flagged') {
        return el(
          'span',
          { class: 'btn btn--ghost btn--sm', role: 'status', 'aria-live': 'polite' },
          'Flagged ✓',
        );
      }

      const toggle = el(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          disabled: flagState === 'submitting',
          'aria-expanded': flagState === 'editing',
          'aria-controls': flagState === 'editing' ? flagFormId : undefined,
          onclick: () => {
            flagState = flagState === 'editing' ? 'idle' : 'editing';
            flagError = undefined;
            draw();
          },
        },
        flagState === 'submitting' ? 'Flagging…' : flagState === 'editing' ? 'Cancel flag' : '🏳 Flag this question',
      );

      if (flagState !== 'editing') return toggle;

      const reasonInput = el('textarea', {
        class: 'input input--area',
        rows: 2,
        maxlength: 500,
        placeholder: 'Optional: tell the instructor what looks wrong',
        value: flagReason,
        oninput: (event: Event) => {
          flagReason = (event.target as HTMLTextAreaElement).value;
        },
      });
      reasonInput.value = flagReason;

      const form = el(
        'form',
        {
          id: flagFormId,
          class: 'stack',
          onsubmit: (event: Event) => {
            event.preventDefault();
            void submitFlag();
          },
        },
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Why are you flagging this question? (optional)' }), reasonInput),
        flagError ? el('p', { class: 'form-error', role: 'alert', text: flagError }) : false,
        el(
          'div',
          { class: 'row' },
          el('button', { class: 'btn btn--ghost btn--sm', type: 'submit' }, 'Send flag'),
        ),
      );

      return el('div', { class: 'stack' }, toggle, form);
    };

    if (!locked) {
      footer = el(
        'div',
        { class: 'row practice-card__footer' },
        flagControl(),
        el('button', { class: 'btn btn--primary', type: 'button', disabled: !selectedKey || submitting, onclick: () => void submit() }, 'Submit'),
      );
    } else if (retry) {
      // Strategy-A retry-in-place: the original explanations for the
      // withheld options stay withheld — this recursive card is a fresh
      // question with its own reveal, not a re-render of the original's.
      footer = el('div', { class: 'row practice-card__footer' }, flagControl());
      const retryQuestion = retryAsQuestion(retry, question.watermark, question.difficulty);
      session.recordServed(retryQuestion);
      retryCard = makeQuestionCard(ctx, session, retryQuestion, callbacks, true);
    } else {
      const recommendation = result?.mastery.recommendation;
      const label = recommendation === 'advance-theme' ? 'Theme complete — continue' : recommendation === 'advance-lo' ? 'Next LO' : 'Next question';
      footer = el(
        'div',
        { class: 'row practice-card__footer' },
        flagControl(),
        el(
          'button',
          { class: 'btn btn--primary', type: 'button', onclick: () => (recommendation ? callbacks.onAdvanceLo() : callbacks.onNext()) },
          label,
        ),
      );
    }

    mount(
      card,
      watermark(question.watermark),
      qLabel,
      stemEl,
      el('div', { class: 'practice-card__options' }, ...options),
      feedback,
      explanations,
      footer,
      retryCard ? el('div', { class: 'practice-card__retry' }, el('p', { class: 'eyebrow', text: 'Try a similar question' }), retryCard) : false,
    );
  };

  draw();
  return card;
}
