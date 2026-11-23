// Reader **Preview** mode (spec D2): the student view of the saved version
// with one drawn sample. `GET /api/questions/:id/sample` draws a fresh seed on
// every call, so "Draw another sample" is just another request. One instance
// per loaded question; the sample is kept per version id.
import { ApiError, getQuestionSample, type QuestionSample } from '../../api.js';
import { el, mount } from '../../dom.js';
import { errorState, loadingState } from '../../ui.js';
import { button, learningOption, rich } from '../student/learning-workspace.js';

export function createQuestionPreview(questionId: string) {
  const root = el('section', { class: 'questions-preview', 'aria-label': 'Student preview' });
  let versionId = '';
  let correctKeys: ReadonlySet<string> = new Set();
  let request = 0;
  let selectedKey: string | undefined;
  let submitted = false;

  function draw(sample: QuestionSample, focus?: 'option' | 'feedback'): void {
    const correct = selectedKey !== undefined && correctKeys.has(selectedKey);
    const choices = sample.options.map(option => learningOption(option, {
      selected: option.key === selectedKey,
      disabled: submitted,
      reveal: submitted ? { correct: correctKeys.has(option.key), explanation: option.explanation } : undefined,
    }, () => {
      selectedKey = option.key;
      draw(sample, 'option');
    }));
    const submit = el('button', {
      class: 'btn btn--instr-primary', type: 'button', disabled: !selectedKey,
      onclick: () => { submitted = true; draw(sample, 'feedback'); },
    }, 'Submit');
    const feedback = submitted ? el('div', {
      class: `learning-feedback${correct ? ' is-correct' : ''}`, role: 'status', tabindex: '-1',
      text: correct ? 'Correct.' : 'Incorrect. Review the explanations and try again.',
    }) : null;
    mount(root,
      el('p', { class: 'questions-preview__lead', text: sample.parameterized
        ? 'One computed example from the saved version. Students may receive different values.'
        : 'Try the saved question as a student.' }),
      rich(sample.stem, 'learning-stem'),
      el('div', { class: 'learning-options', role: 'group', 'aria-label': 'Answer choices' }, ...choices),
      feedback,
      el('div', { class: 'questions-preview__actions' },
        sample.parameterized
          ? button('Draw another sample', () => load(), 'btn btn--ghost btn--sm questions-preview__draw')
          : false,
        submitted
          ? button('Try again', () => { submitted = false; selectedKey = undefined; draw(sample, 'option'); })
          : submit));
    if (focus === 'feedback') feedback?.focus();
    if (focus === 'option') (choices[sample.options.findIndex(option => option.key === selectedKey)] ?? choices[0])?.focus({ preventScroll: true });
  }

  async function load(): Promise<void> {
    const ticket = ++request;
    const version = versionId;
    mount(root, loadingState('Loading student preview…'));
    try {
      const sample = await getQuestionSample(questionId);
      if (ticket !== request || version !== versionId) return;
      if (sample.versionId && sample.versionId !== version) {
        mount(root, errorState('The saved version changed. Reload the question to preview it.'));
        return;
      }
      selectedKey = undefined;
      submitted = false;
      draw(sample);
    } catch (error) {
      if (ticket !== request || version !== versionId) return;
      const message = error instanceof ApiError ? error.message : 'The student preview could not load.';
      mount(root, errorState(message, () => { void load(); }));
    }
  }

  return {
    /** The preview for `version`; fetches only when the version changed. */
    render(version: string, correct: ReadonlySet<string>): HTMLElement {
      correctKeys = correct;
      if (version !== versionId) { versionId = version; void load(); }
      return root;
    },
  };
}
