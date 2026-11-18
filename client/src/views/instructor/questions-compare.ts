// Reader **Compare** mode (spec D2/D8): generate an alternative with
// `regenerateQuestion`, show it beside the current version with its check, and
// hand it to the reader to save (`onReplace`). The alternative is only a
// preview until then. One instance per loaded question, so the prompt and a
// generated alternative survive redraws.
import { ApiError, regenerateQuestion, type QuestionDetail, type RegenerationVariant } from '../../api.js';
import { el, mount } from '../../dom.js';
import { statusBadge } from '../../instructor-ui.js';
import { toDisplayPlaceholders } from '../../placeholders.js';
import { renderRichText } from '../../render.js';
import { errorState } from '../../ui.js';
import { authoringAnswer } from './authoring-answer.js';

const DEFAULT_PROMPT = 'Create a distinct alternative that tests the same learning objective with a different scenario.';

export interface CompareOptions {
  courseId: string;
  questionId: string;
  /** Generation started or finished: the reader locks or unlocks itself. */
  onBusy: (busy: boolean) => void;
  /** Saves the alternative as the next version. */
  onReplace: (variant: RegenerationVariant) => void;
}

function version(title: string, question: Pick<RegenerationVariant, 'stem' | 'options' | 'difficulty'>): HTMLElement {
  const stem = el('div', { class: 'gw-stem questions-compare__stem' });
  renderRichText(stem, toDisplayPlaceholders(question.stem));
  return el('article', { class: 'questions-compare__version', 'aria-label': title },
    el('h3', { text: title }),
    el('p', { class: 'questions-compare__meta', text: `Difficulty: ${question.difficulty}` }),
    stem,
    el('div', { class: 'questions-reader__answers' }, ...question.options.map((option) => {
      const answer = authoringAnswer(
        { key: option.key, text: toDisplayPlaceholders(option.text), explanation: toDisplayPlaceholders(option.explanation) },
        option.role === 'correct');
      // Both columns list options A, B…: name each region by its version too.
      answer.setAttribute('aria-label', `${title}, ${answer.getAttribute('aria-label') ?? `option ${option.key}`}`);
      return answer;
    })));
}

export function createQuestionCompare(options: CompareOptions) {
  const root = el('section', { class: 'questions-compare', 'aria-label': 'Compare with a generated alternative' });
  const prompt = el('textarea', { class: 'input', id: `questions-compare-prompt-${options.questionId}`, rows: '3' }, DEFAULT_PROMPT) as HTMLTextAreaElement;
  let variant: RegenerationVariant | null = null;
  let generating = false;
  let error = '';
  let current: QuestionDetail | undefined;
  let locked = false;

  async function generate(): Promise<void> {
    if (generating || locked) return;
    const text = prompt.value.trim();
    if (!text) { error = 'Enter what the alternative should change.'; draw(); return; }
    generating = true; error = ''; variant = null;
    options.onBusy(true);
    draw();
    try {
      variant = (await regenerateQuestion(options.courseId, options.questionId, text)).variant;
    } catch (failure) {
      error = failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : String(failure);
    }
    generating = false;
    options.onBusy(false);
    draw();
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
    const disabled = generating || locked;
    prompt.disabled = disabled;
    mount(root,
      el('p', { class: 'questions-compare__lead', text: 'The alternative is only a preview. The current question stays unchanged until you choose Replace with variant.' }),
      el('label', { class: 'questions-settings__label', for: prompt.id, text: 'What should the alternative change?' }),
      prompt,
      el('div', { class: 'questions-compare__actions' },
        el('button', { class: `btn ${variant ? 'btn--ghost' : 'btn--instr-primary'} btn--sm`, type: 'button', disabled, onclick: () => { void generate(); } },
          generating ? 'Generating alternative…' : variant ? 'Generate another' : 'Generate alternative')),
      error ? errorState(error) : false,
      el('div', { class: 'questions-compare__columns' },
        version(`Current · version ${current.currentVersion}`, current.current),
        variant ? version('Generated alternative', variant) : el('div', { class: 'questions-compare__empty', text: generating ? 'Generating an alternative — this can take a minute.' : 'Generate an alternative to compare it here.' })),
      variant ? check(variant.agentDecision) : false,
      variant
        ? el('div', { class: 'questions-compare__actions' },
          el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', disabled, onclick: () => { if (variant) options.onReplace(variant); } }, 'Replace with variant'))
        : false);
  }

  return {
    render(detail: QuestionDetail, readerLocked: boolean): HTMLElement {
      current = detail; locked = readerLocked && !generating;
      draw();
      return root;
    },
    hasVariant: (): boolean => variant !== null,
    isGenerating: (): boolean => generating,
    clear(): void { variant = null; error = ''; },
  };
}
