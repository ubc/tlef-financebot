import {
  ApiError,
  commitQuestionImport,
  getCourseTree,
  previewQuestionImport,
  type CourseTree,
  type ImportCandidate,
  type ImportPreview,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

function navigate(path: string): void {
  window.location.hash = path;
}

function typeLabel(type: ImportCandidate['type']): string {
  if (type === 'mcq') return 'MCQ';
  if (type === 'true-false') return 'True/False';
  return 'Other → auto-convert';
}

function previewTable(candidates: ImportCandidate[]): HTMLElement {
  return el(
    'div',
    { class: 'bank-table' },
    el(
      'div',
      { class: 'bank-row bank-row--head', 'aria-hidden': 'true' },
      el('span', { text: '#' }),
      el('span', { text: 'Type' }),
      el('span', { text: 'Stem' }),
      el('span', { text: 'Difficulty' }),
      el('span', { text: 'Options' }),
      el('span', { text: 'Parameterization' }),
      el('span', { text: 'Correct' }),
    ),
    el(
      'div',
      { class: 'bank-table__rows' },
      ...candidates.map((candidate, index) =>
        el(
          'div',
          { class: 'bank-row' },
          el('span', { class: 'mono', text: String(index + 1) }),
          el('span', { text: typeLabel(candidate.type) }),
          el('span', { class: 'bank-row__stem', text: candidate.stem }),
          el('span', { text: candidate.difficulty ?? 'medium' }),
          el('span', { text: String(candidate.options.length) }),
          candidate.parameterizable
            ? statusBadge('Convertible', 'below-target')
            : statusBadge('Conceptual', 'neutral'),
          el('span', { class: 'mono', text: candidate.correctKey || 'LLM' }),
        ),
      ),
    ),
  );
}

function failurePanel(failures: ImportPreview['failures']): HTMLElement | false {
  if (!failures.length) return false;
  return el(
    'section',
    { class: 'card' },
    el(
      'div',
      { class: 'card__body' },
      el('h2', { text: `${failures.length} row${failures.length === 1 ? '' : 's'} could not be imported` }),
      el(
        'ul',
        {},
        ...failures.map((failure) =>
          el('li', { text: `Row/item ${String(failure.line)}: ${failure.reason}` }),
        ),
      ),
      el('p', {
        text: 'Valid rows remain available below and can be imported independently.',
      }),
    ),
  );
}

function assignmentOptions(tree: CourseTree): Array<{ value: string; label: string }> {
  const options = [{ value: '', label: 'Unassigned — classify later' }];
  tree.themes.forEach((theme, themeIndex) => {
    (theme.los ?? []).forEach((lo, loIndex) => {
      options.push({
        value: `${theme._id}:${lo._id}`,
        label: `Topic ${themeIndex + 1} / LO ${loIndex + 1}: ${lo.name}`,
      });
    });
  });
  return options;
}

export async function renderImport(outlet: HTMLElement, params: RouteParams): Promise<void> {
  const courseId = params.id;
  if (!courseId) {
    mount(outlet, errorState('Course id is required.'));
    return;
  }

  const body = el('div', {}, loadingState('Loading import options…'));
  mount(
    outlet,
    el(
      'div',
      { class: 'view' },
      pageHeader(
        'Import Questions',
        'Upload CSV, JSON, or QTI XML. Preview first; every confirmed question enters as a Draft.',
      ),
      body,
    ),
  );

  let tree: CourseTree;
  try {
    tree = await getCourseTree(courseId);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderImport(outlet, params)));
    return;
  }

  let preview: ImportPreview | null = null;
  let busy = false;
  let committed = false;

  const fileInput = el('input', {
    class: 'input',
    id: 'import-question-file',
    type: 'file',
    accept: '.csv,.json,.xml,.qti',
  }) as HTMLInputElement;
  const assignmentSelect = el(
    'select',
    { class: 'input', id: 'import-assignment' },
    ...assignmentOptions(tree).map((option) =>
      el('option', { value: option.value, text: option.label }),
    ),
  ) as HTMLSelectElement;
  const errorSlot = el('div', {});
  const resultSlot = el('div', {});
  const previewSlot = el('div', {});
  const previewButton = el('button', {
    class: 'btn btn--instr-primary',
    type: 'button',
  }) as HTMLButtonElement;

  const renderPreview = (): void => {
    previewButton.textContent = busy ? 'Reading…' : 'Preview import';
    previewButton.disabled = busy;
    if (!preview) {
      previewSlot.replaceChildren();
      return;
    }

    const confirmButton = el(
      'button',
      {
        class: 'btn btn--instr-primary',
        type: 'button',
        disabled: busy || committed || preview.candidates.length === 0 ? true : undefined,
        onclick: async () => {
          if (!preview || busy || committed) return;
          busy = true;
          errorSlot.replaceChildren();
          renderPreview();
          try {
            const [themeId, loId] = assignmentSelect.value
              ? assignmentSelect.value.split(':')
              : [];
            const result = await commitQuestionImport(courseId, {
              candidates: preview.candidates,
              ...(themeId ? { themeId } : {}),
              ...(loId ? { loId } : {}),
            });
            committed = true;
            resultSlot.replaceChildren(
              el(
                'div',
                { class: 'duplicate-callout', role: 'status' },
                el('p', {
                  class: 'duplicate-callout__title',
                  text: `Imported ${result.imported} Draft question${result.imported === 1 ? '' : 's'}.`,
                }),
                result.autoConverted
                  ? el('p', {
                      class: 'duplicate-callout__body',
                      text: `${result.autoConverted} item${result.autoConverted === 1 ? ' was' : 's were'} auto-converted and labelled for verification.`,
                    })
                  : false,
                el(
                  'button',
                  {
                    class: 'btn btn--ghost btn--sm',
                    type: 'button',
                    onclick: () => navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank`),
                  },
                  'Open Question Bank',
                ),
              ),
            );
          } catch (error) {
            const message = error instanceof ApiError ? error.message : (error as Error).message;
            errorSlot.replaceChildren(errorState(message));
          } finally {
            busy = false;
            renderPreview();
          }
        },
      },
      `Import ${preview.candidates.length} Draft${preview.candidates.length === 1 ? '' : 's'}`,
    ) as HTMLButtonElement;

    const failures = failurePanel(preview.failures);
    previewSlot.replaceChildren(
      ...(failures ? [failures] : []),
      el(
        'section',
        { class: 'card' },
        el(
          'div',
          { class: 'card__body' },
          el('h2', { text: `Preview · ${preview.candidates.length} valid` }),
          el('p', {
            text: `Detected format: ${preview.format.toUpperCase()}. Nothing has been written yet.`,
          }),
          previewTable(preview.candidates),
          el('div', { class: 'form-actions' }, confirmButton),
        ),
      ),
    );
  };

  previewButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    errorSlot.replaceChildren();
    resultSlot.replaceChildren();
    if (!file) {
      errorSlot.replaceChildren(errorState('Choose a CSV, JSON, XML, or QTI file first.'));
      return;
    }
    busy = true;
    committed = false;
    renderPreview();
    try {
      preview = await previewQuestionImport(courseId, file);
    } catch (error) {
      preview = null;
      const message = error instanceof ApiError ? error.message : (error as Error).message;
      errorSlot.replaceChildren(errorState(message));
    } finally {
      busy = false;
      renderPreview();
    }
  });

  body.replaceChildren(
    el(
      'section',
      { class: 'card' },
      el(
        'div',
        { class: 'card__body' },
        el('label', {
          class: 'form-field__label',
          for: 'import-question-file',
          text: 'Question file',
        }),
        fileInput,
        el('p', { text: 'Supported: .csv, .json, .xml, and .qti (maximum 5 MB).' }),
        el('label', { class: 'form-field__label', for: 'import-assignment', text: 'Assign to' }),
        assignmentSelect,
        el('div', { class: 'form-actions' }, previewButton),
      ),
    ),
    errorSlot,
    resultSlot,
    previewSlot,
  );
  renderPreview();
}
