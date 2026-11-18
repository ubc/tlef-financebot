// Reader **Preview** mode (spec D2): the student view of the saved version
// with one drawn sample. `GET /api/questions/:id/sample` draws a fresh seed on
// every call, so "Draw another sample" is just another request. One instance
// per loaded question; the sample is kept per version id.
import { ApiError, getQuestionSample, type QuestionSample } from '../../api.js';
import { el, mount } from '../../dom.js';
import { renderRichText } from '../../render.js';
import { errorState, loadingState } from '../../ui.js';
import { authoringAnswer } from './authoring-answer.js';

export function createQuestionPreview(questionId: string) {
  const root = el('section', { class: 'questions-preview', 'aria-label': 'Student preview' });
  let versionId = '';
  let correctKeys: ReadonlySet<string> = new Set();
  let request = 0;

  function draw(sample: QuestionSample): void {
    const stem = el('div', { class: 'gw-stem questions-preview__stem' });
    renderRichText(stem, sample.stem);
    mount(root,
      el('p', { class: 'questions-preview__lead', text: sample.parameterized
        ? 'One computed example from the saved version. Students may receive different values.'
        : 'What students see for the saved version, with the explanations they get after answering.' }),
      stem,
      el('div', { class: 'questions-reader__answers' }, ...sample.options.map((option) => authoringAnswer(option, correctKeys.has(option.key)))),
      sample.parameterized
        ? el('button', { class: 'btn btn--ghost btn--sm questions-preview__draw', type: 'button', onclick: () => { void load(); } }, 'Draw another sample')
        : false);
  }

  async function load(): Promise<void> {
    const ticket = ++request;
    const version = versionId;
    mount(root, loadingState('Loading student preview…'));
    try {
      const sample = await getQuestionSample(questionId);
      if (ticket !== request || version !== versionId) return;
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
