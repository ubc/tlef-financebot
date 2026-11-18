// Notice for a question opened from Student Analytics with
// `analyticsVersionId`: which version the recorded answers were given to, and
// its content when that is not the current version. Loaded once per reader
// question; the reader drops it on Dismiss or when another question opens.
import { ApiError, getAnswerDistribution, type AnswerDistribution } from '../../api.js';
import { el, mount } from '../../dom.js';
import { renderRichText } from '../../render.js';
import { errorState } from '../../ui.js';

export function createAnalyticsNotice(courseId: string, questionId: string, versionId: string, onDismiss: () => void) {
  const body = el('div', { class: 'questions-analytics-notice__body' });
  const root = el('section', { class: 'questions-analytics-notice', 'aria-label': 'Recorded analytics version' },
    body,
    el('button', { class: 'link-button questions-analytics-notice__dismiss', type: 'button', onclick: onDismiss }, 'Dismiss'));

  function show(recorded: AnswerDistribution): void {
    const stem = el('div', {});
    renderRichText(stem, recorded.stem);
    mount(body,
      el('p', {},
        el('strong', { text: `Recorded analytics version ${recorded.version}` }),
        recorded.isCurrent ? ' · Current content' : ' · Historical content — the reader shows the current version.'),
      recorded.isCurrent ? false : el('details', {},
        el('summary', { text: `What students saw in version ${recorded.version}` }),
        stem,
        el('ul', {}, ...recorded.options.map((option) => el('li', { text: `${option.key}. ${option.text} (${option.role.replace(/-/g, ' ')})` })))));
  }

  async function load(): Promise<void> {
    mount(body, el('p', { text: 'Loading the recorded analytics version…' }));
    try {
      const recorded = await getAnswerDistribution(courseId, questionId, { versionId });
      show(recorded);
    } catch (error) {
      mount(body, error instanceof ApiError && (error.status === 404 || error.status === 400)
        ? el('p', { text: 'The requested recorded version was not found. The reader shows the current version.' })
        : errorState(`The recorded version could not be loaded: ${error instanceof Error ? error.message : String(error)}`, () => { void load(); }));
    }
  }
  void load();
  return { root, versionId };
}
