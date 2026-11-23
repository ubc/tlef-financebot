// Reader **Compare** mode (spec D2/D8): generate an alternative with
// `regenerateQuestion`, show it beside the current version with its check, and
// let the reader save or discard it. The instance can receive draft updates
// while another question is selected.
import {
  regenerateQuestion,
  type QuestionDetail,
  type RegenerationPreview,
  type RegenerationStage,
  type RegenerationVariant,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { statusBadge } from '../../instructor-ui.js';
import { toDisplayPlaceholders } from '../../placeholders.js';
import { renderRichText } from '../../render.js';
import { errorState } from '../../ui.js';
import { authoringAnswer } from './authoring-answer.js';

const GENERATION_STATUS: Record<RegenerationStage, string> = {
  retrieving: 'Retrieving course material…',
  generating: 'Writing the alternative…',
  reviewing: 'Checking the alternative…',
};

const DEFAULT_PROMPT = 'Create a distinct alternative that tests the same learning objective with a different scenario.';
const ALTERNATIVE_TITLE = 'Generated alternative';

export interface CompareOptions {
  courseId: string;
  questionId: string;
  onChange: () => void;
}

function versionContent(title: string, question: Pick<RegenerationVariant, 'stem' | 'options' | 'difficulty'>): HTMLElement[] {
  const stem = el('div', { class: 'gw-stem questions-compare__stem' });
  renderRichText(stem, toDisplayPlaceholders(question.stem));
  return [
    el('p', { class: 'questions-compare__meta', text: `Difficulty: ${question.difficulty}` }),
    stem,
    el('div', { class: 'questions-reader__answers' }, ...question.options.map((option) => {
      const answer = authoringAnswer(
        { key: option.key, text: toDisplayPlaceholders(option.text), explanation: toDisplayPlaceholders(option.explanation) },
        option.role === 'correct');
      // Both columns list options A, B…: name each region by its version too.
      answer.setAttribute('aria-label', `${title}, ${answer.getAttribute('aria-label') ?? `option ${option.key}`}`);
      return answer;
    })),
  ];
}

export function createQuestionCompare(options: CompareOptions) {
  const root = el('section', { class: 'questions-compare', 'aria-label': 'Compare with a generated alternative' });
  const prompt = el('textarea', { class: 'input', id: `questions-compare-prompt-${options.questionId}`, rows: '3' }, DEFAULT_PROMPT) as HTMLTextAreaElement;
  prompt.addEventListener('input', () => prompt.setCustomValidity(''));
  const alternativeHeading = el('h3', { text: ALTERNATIVE_TITLE });
  const progress = el('p', { class: 'questions-compare__status', role: 'status' });
  const alternativeContents = el('div', {});
  const alternative = el('article', { class: 'questions-compare__version', 'aria-label': ALTERNATIVE_TITLE },
    alternativeHeading, progress, alternativeContents);
  let variant: RegenerationVariant | null = null;
  let baseVersionId: string | undefined;
  let generating = false;
  let error = '';
  let current: QuestionDetail | undefined;
  let locked = false;

  function showDraft(preview: RegenerationPreview): void {
    const stem = el('div', { class: 'gw-stem questions-compare__stem' });
    if (preview.stem) renderRichText(stem, toDisplayPlaceholders(preview.stem));
    const options = (preview.options ?? []).filter((option) => option.text);
    mount(alternativeContents,
      preview.difficulty ? el('p', { class: 'questions-compare__meta', text: `Difficulty: ${preview.difficulty}` }) : false,
      preview.stem ? stem : false,
      options.length ? el('div', { class: 'questions-reader__answers' }, ...options.map((option, index) =>
        authoringAnswer({
          key: option.key || String.fromCharCode(65 + index),
          text: toDisplayPlaceholders(option.text),
          explanation: toDisplayPlaceholders(option.explanation),
        }, false),
      )) : false,
    );
  }

  function reveal(): void {
    alternativeHeading.scrollIntoView({ block: 'start', inline: 'nearest' });
  }

  async function generate(): Promise<void> {
    if (!current || generating || variant || locked) return;
    const text = prompt.value.trim();
    if (!text) {
      prompt.setCustomValidity('Enter what the alternative should change.');
      prompt.reportValidity();
      return;
    }
    generating = true; error = '';
    baseVersionId = current.currentVersionId;
    progress.textContent = 'Starting generation…';
    alternativeContents.replaceChildren();
    options.onChange();
    draw();
    reveal();
    try {
      const result = await regenerateQuestion(options.courseId, options.questionId, text, (update) => {
        if ('stage' in update) progress.textContent = GENERATION_STATUS[update.stage];
        else showDraft(update.preview);
      });
      variant = result.variant;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      generating = false;
      options.onChange();
      draw();
    }
  }

  function check(decision: RegenerationVariant['agentDecision']): HTMLElement {
    const reasoning = el('div', {});
    renderRichText(reasoning, decision.reasoning);
    return el('section', { class: 'questions-compare__check', 'aria-label': 'Check of the generated alternative' },
      el('h3', {}, 'AI check of the alternative ', statusBadge(decision.decision.toUpperCase(), decision.decision)),
      reasoning,
      decision.suggestions?.length ? el('ul', {}, ...decision.suggestions.map((text) => el('li', { text }))) : false);
  }

  function draw(): void {
    if (!current) return;
    const disabled = generating || locked || !!variant;
    prompt.disabled = disabled;
    progress.hidden = !generating;
    if (variant) mount(alternativeContents, ...versionContent(ALTERNATIVE_TITLE, variant));
    else if (error) mount(alternativeContents, errorState(error, disabled ? undefined : () => { void generate(); }));
    else if (!generating) mount(alternativeContents, el('p', { class: 'questions-compare__status', text: 'Generate an alternative to compare it here.' }));
    const currentTitle = `Current · version ${current.currentVersion}`;
    mount(root,
      el('p', { class: 'questions-compare__lead', text: 'Compare the versions, then choose whether to replace the current question.' }),
      el('label', { class: 'questions-settings__label', for: prompt.id, text: 'What should the alternative change?' }),
      prompt,
      !variant ? el('div', { class: 'questions-compare__actions' },
        el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', disabled, onclick: () => { void generate(); } },
          generating ? 'Generating alternative…' : 'Generate alternative')) : false,
      el('div', { class: 'questions-compare__columns' },
        el('article', { class: 'questions-compare__version', 'aria-label': currentTitle },
          el('h3', { text: currentTitle }), ...versionContent(currentTitle, current.current)),
        alternative),
      variant ? check(variant.agentDecision) : false,
      variant && baseVersionId !== current.currentVersionId
        ? errorState('The saved version changed. Cancel to return to the current question.') : false);
  }

  return {
    render(detail: QuestionDetail, readerLocked: boolean): HTMLElement {
      current = detail; locked = readerLocked;
      draw();
      return root;
    },
    hasVariant: (): boolean => variant !== null,
    isGenerating: (): boolean => generating,
    variantFor: (versionId: string): RegenerationVariant | null => baseVersionId === versionId ? variant : null,
    invalidateReplacement(): void { baseVersionId = undefined; },
    reveal,
    clear(): void { variant = null; error = ''; },
  };
}
