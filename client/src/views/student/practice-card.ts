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
  type SubmitAttemptInput,
} from '../../api.js';
import type { PracticeSession } from '../../practice-session.js';
import { el, mount } from '../../dom.js';
import { errorState, helpTip, optionButton, watermark } from '../../ui.js';
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

export interface PracticeCardAdapter {
  submit: (input: SubmitAttemptInput) => Promise<AttemptResult>;
  flag?: (
    questionId: string,
    reason?: string,
    options?: { sendToInstructorQueue?: boolean },
  ) => Promise<{ flagged: true; duplicate?: boolean }>;
  bookmark?: (questionId: string) => Promise<{ bookmarked: boolean }>;
  allowsInstructorTestFlag?: boolean;
  updatesMastery: boolean;
  materialHref?: (courseId: string, loId: string, materialId: string) => string;
}

const LIVE_PRACTICE_ADAPTER: PracticeCardAdapter = {
  submit: submitAttempt,
  flag: flagPracticeQuestion,
  updatesMastery: true,
  materialHref: (courseId, loId, materialId) =>
    `/api/courses/${encodeURIComponent(courseId)}` +
    `/los/${encodeURIComponent(loId)}` +
    `/materials/${encodeURIComponent(materialId)}/source`,
};

// The label alone did not tell a PI reviewer what either state of the TEST
// checkbox does (2026-08-08) — least of all the unchecked one, whose effect is
// invisible from the card. A trailing sentence beside the label read as part of
// the label; this says the same thing behind a ⓘ, where it is on demand.
const TEST_FLAG_HELP =
  'Checked, this files the flag in your Flag Queue tagged as a Preview test — it will not '
  + 'pause the question, count toward student analytics, or notify any student. Unchecked, '
  + 'nothing is filed anywhere — the flag is not sent to your queue and is discarded when this '
  + 'preview session ends.';

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
  adapter: PracticeCardAdapter = LIVE_PRACTICE_ADAPTER,
): HTMLElement {
  const card = el('div', { class: 'practice-card' });
  let selectedKey: string | undefined;
  let result: AttemptResult | undefined;
  let submitting = false;
  // 'duplicate' is a distinct terminal state from 'flagged', not a cosmetic
  // variant: it means the server recorded NOTHING because this student already
  // has an open flag on this version. Collapsing the two is what let a dedupe
  // bug masquerade as a broken notification bell (see flags.service.ts).
  let flagState: 'idle' | 'editing' | 'submitting' | 'flagged' | 'duplicate' = 'idle';
  let flagReason = '';
  let bookmarkState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  let bookmarkError: string | undefined;
  // Default ON in Preview, because Preview exists to exercise the real flag
  // loop end to end — an instructor who wants a preview-session-only flag
  // unchecks it. Live student practice never renders the control at all
  // (`allowsInstructorTestFlag` is set only by the preview adapter), so the
  // student path stays false. This deliberately reverses f08913c on Jose's PI
  // feedback (2026-08-08); read
  // docs/superpowers/plans/phase-4/Saurav/2026-08-08-preview-flag-ux-pi-feedback.md
  // before flipping it back a third time.
  let sendToInstructorQueue = Boolean(adapter.allowsInstructorTestFlag);
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
      result = await adapter.submit({
        questionVersionId: question.questionVersionId,
        loId: currentLo(ctx).lo._id,
        selectedKey,
        mode: ctx.mode,
        sessionServedIds: session.sessionServedIds,
        ...(isRetry ? { isRetry: true } : {}),
        ...(question.paramValues !== undefined ? { paramValues: question.paramValues } : {}),
      });
      session.recordAttempt({ question, selectedKey, result, loId: currentLo(ctx).lo._id });
      // Keep the persistent sidebar's current-LO badge in sync with the
      // just-computed mastery response instead of showing the stale status
      // captured when the practice page first loaded.
      if (adapter.updatesMastery) currentLo(ctx).status = result.mastery.loStatus;
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
    if (
      !adapter.flag ||
      flagState === 'submitting' ||
      flagState === 'flagged' ||
      flagState === 'duplicate'
    )
      return;
    flagState = 'submitting';
    flagError = undefined;
    draw();
    try {
      const result = await adapter.flag(question.questionId, flagReason, { sendToInstructorQueue });
      flagState = result.duplicate ? 'duplicate' : 'flagged';
    } catch (error) {
      flagState = 'editing';
      flagError = (error as Error).message;
    }
    draw();
  };

  const saveBookmark = async (): Promise<void> => {
    if (!adapter.bookmark || bookmarkState === 'saving' || bookmarkState === 'saved') return;
    bookmarkState = 'saving';
    bookmarkError = undefined;
    draw();
    try {
      await adapter.bookmark(question.questionId);
      bookmarkState = 'saved';
    } catch (error) {
      bookmarkState = 'error';
      bookmarkError = (error as Error).message;
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
    const recommendation = result?.mastery.recommendation;
    const redirect = result?.redirect;
    let retryCard: HTMLElement | false = false;
    let progressionPanel: HTMLElement | false = false;
    let footer: HTMLElement;

    const flagFormId = `flag-${question.questionVersionId}-${questionNumber}`;
    const testFlagId = `${flagFormId}-test`;
    // Derived from `flagFormId`, which is already unique per card — the retry
    // recursion renders a second card into the same DOM, so a shared literal id
    // here would produce duplicates and point both checkboxes at one bubble.
    const testFlagHelpId = `${testFlagId}-help`;
    const bookmarkControl = (): HTMLElement | false => {
      // Review Book entries retain the attempt/LO/theme context needed for
      // later repractice, so bookmarking becomes available as soon as this
      // question has been answered.
      if (!adapter.bookmark || !result) return false;
      return el(
        'div',
        { class: 'stack stack--compact' },
        el(
          'button',
          {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            disabled: bookmarkState === 'saving' || bookmarkState === 'saved',
            'aria-live': 'polite',
            onclick: () => void saveBookmark(),
          },
          bookmarkState === 'saving'
            ? 'Saving bookmark…'
            : bookmarkState === 'saved'
              ? 'Bookmarked'
              : 'Bookmark',
        ),
        bookmarkError
          ? el('span', { class: 'form-error', role: 'alert', text: bookmarkError })
          : false,
      );
    };
    const flagControl = (): HTMLElement | false => {
      if (!adapter.flag) return false;
      if (flagState === 'flagged') {
        return el(
          'span',
          { class: 'btn btn--ghost btn--sm', role: 'status', 'aria-live': 'polite' },
          'Flagged ✓',
        );
      }
      // Deliberately different wording from 'Flagged ✓' — nothing was recorded
      // by this call, and telling the student otherwise is what made the
      // original bug invisible from the practice surface.
      if (flagState === 'duplicate') {
        return el(
          'span',
          { class: 'btn btn--ghost btn--sm', role: 'status', 'aria-live': 'polite' },
          'Already flagged — under review',
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
        // The label is associated by `for=` rather than wrapping the row, so the
        // ⓘ can sit outside it: a <button> inside a <label> makes the label's
        // click target ambiguous and toggles the checkbox — the same trap
        // `fieldLabelWithHelp` in instructor/settings.ts documents.
        adapter.allowsInstructorTestFlag
          ? el(
              'div',
              { class: 'flag-test-option' },
              el('input', {
                id: testFlagId,
                type: 'checkbox',
                checked: sendToInstructorQueue ? 'checked' : undefined,
                // The box is pre-checked in Preview, so sending is the DEFAULT
                // action — a screen-reader user must hear what that does on
                // focus, not only if they go looking for the ⓘ. Before the row
                // was un-wrapped from its <label>, the explanation was part of
                // the accessible NAME; describedby is how it survives.
                'aria-describedby': testFlagHelpId,
                onchange: (event: Event) => {
                  sendToInstructorQueue = (event.target as HTMLInputElement).checked;
                },
              }),
              el('label', { for: testFlagId }, el('strong', { text: 'Send as a test flag to Instructor Queue' })),
              helpTip('the test flag option', TEST_FLAG_HELP, testFlagHelpId),
            )
          : false,
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
      // While the flag form is open the card shows two submit-looking buttons,
      // and a PI reviewer clicked the answer one expecting it to send the flag
      // (2026-08-08). Hide it until the flag resolves — to 'flagged',
      // 'duplicate' or back to 'idle' via Cancel flag — so 'Send flag' is the
      // only submit on screen.
      const flagFormOpen = flagState === 'editing' || flagState === 'submitting';
      footer = el(
        'div',
        { class: 'row practice-card__footer' },
        bookmarkControl(),
        flagControl(),
        flagFormOpen
          ? false
          : el('button', { class: 'btn btn--primary', type: 'button', disabled: !selectedKey || submitting, onclick: () => void submit() }, 'Submit'),
      );
    } else if (retry) {
      // Strategy-A retry-in-place: the original explanations for the
      // withheld options stay withheld — this recursive card is a fresh
      // question with its own reveal, not a re-render of the original's.
      footer = el('div', { class: 'row practice-card__footer' }, bookmarkControl(), flagControl());
      const retryQuestion = retryAsQuestion(retry, question.watermark, question.difficulty);
      session.recordServed(retryQuestion);
      retryCard = makeQuestionCard(ctx, session, retryQuestion, callbacks, true, adapter);
    } else if (redirect) {
      const materialItems = redirect.materials.map((material) =>
        el(
          'li',
          {},
          el(
            'a',
            {
              href: adapter.materialHref?.(
                ctx.courseId,
                currentLo(ctx).lo._id,
                material.materialId,
              ) ?? '#',
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            material.name,
          ),
        ),
      );
      progressionPanel = el(
        'section',
        { class: 'practice-redirect', 'aria-labelledby': `redirect-${question.questionVersionId}` },
        el('p', { class: 'eyebrow', text: 'Suggested review' }),
        el('h3', { id: `redirect-${question.questionVersionId}`, text: 'Pause and reinforce this learning objective' }),
        el('p', { text: redirect.message }),
        materialItems.length > 0
          ? el('ul', { class: 'practice-redirect__materials' }, ...materialItems)
          : el('p', { class: 'muted', text: 'No course materials are linked to this LO yet.' }),
        el(
          'button',
          { class: 'btn btn--primary', type: 'button', onclick: callbacks.onNext },
          'Continue practicing',
        ),
      );
      footer = el('div', { class: 'row practice-card__footer' }, bookmarkControl(), flagControl());
    } else if (recommendation) {
      const themeComplete = recommendation === 'advance-theme';
      const hasNextLo = ctx.isThemeMode && ctx.loIndex + 1 < ctx.los.length;
      progressionPanel = el(
        'section',
        { class: 'practice-recommendation', 'aria-labelledby': `recommendation-${question.questionVersionId}` },
        el('p', { class: 'eyebrow', text: themeComplete ? 'Theme milestone' : 'LO covered' }),
        el('h3', {
          id: `recommendation-${question.questionVersionId}`,
          text: themeComplete
            ? 'You covered every learning objective in this theme.'
            : hasNextLo
              ? 'Ready to advance to the next learning objective?'
              : 'You have covered this learning objective.',
        }),
        el(
          'div',
          { class: 'row' },
          el(
            'button',
            { class: 'btn btn--primary', type: 'button', onclick: callbacks.onAdvanceLo },
            themeComplete ? 'Finish this theme' : hasNextLo ? 'Advance to next LO' : 'Back to topic',
          ),
          el(
            'button',
            { class: 'btn btn--ghost', type: 'button', onclick: callbacks.onNext },
            'Keep practicing',
          ),
        ),
      );
      footer = el('div', { class: 'row practice-card__footer' }, bookmarkControl(), flagControl());
    } else {
      footer = el(
        'div',
        { class: 'row practice-card__footer' },
        bookmarkControl(),
        flagControl(),
        el(
          'button',
          { class: 'btn btn--primary', type: 'button', onclick: callbacks.onNext },
          'Next question',
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
      progressionPanel,
      footer,
      retryCard ? el('div', { class: 'practice-card__retry' }, el('p', { class: 'eyebrow', text: 'Try a similar question' }), retryCard) : false,
    );
  };

  draw();
  return card;
}
