// EXAMPLE view (genai + qdrant RAG demo). Safe to delete with the server-side RAG
// example. Ingest text or a file, then ask a question answered from what was
// ingested. Endpoints are auth-gated, so this only works while signed in.
import { ingestRagText, ingestRagFile, queryRag, type RagAnswer } from '../api.js';
import { el } from '../dom.js';
import { badge, eyebrow, loadingState, errorState } from '../ui.js';

function renderAnswer(result: RagAnswer): HTMLElement {
  const nodes: (HTMLElement | string)[] = [el('p', { class: 'answer__text', text: result.answer })];
  if (result.sources.length) {
    nodes.push(el('p', { class: 'answer__label', text: 'Sources' }));
    nodes.push(
      el(
        'ol',
        { class: 'sources' },
        ...result.sources.map((source) => {
          const snippet = source.text.length > 220 ? `${source.text.slice(0, 220)}…` : source.text;
          return el(
            'li',
            { class: 'source' },
            el(
              'div',
              { class: 'source__meta' },
              el('span', { class: 'source__id mono', text: source.sourceId }),
              el('span', { class: 'source__score mono', text: `score ${source.score.toFixed(3)}` }),
            ),
            el('p', { class: 'source__text', text: snippet }),
          );
        }),
      ),
    );
  }
  return el('div', { class: 'answer' }, ...nodes);
}

export function renderRag(outlet: HTMLElement): void {
  const status = el('p', { class: 'row-status mono', 'aria-live': 'polite' });
  const answer = el('div', { 'aria-live': 'polite' });

  // Ingest text
  const textArea = el('textarea', {
    class: 'input input--area',
    rows: '4',
    placeholder: 'Paste text to ingest…',
    'aria-label': 'Text to ingest',
  }) as HTMLTextAreaElement;
  const sourceInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'source name (optional)',
    autocomplete: 'off',
    'aria-label': 'Source name',
  }) as HTMLInputElement;
  const ingestTextForm = el(
    'form',
    { class: 'stack' },
    textArea,
    el('div', { class: 'row' }, sourceInput, el('button', { class: 'btn btn--primary', type: 'submit' }, 'Ingest text')),
  ) as HTMLFormElement;

  // Ingest file
  const fileInput = el('input', {
    class: 'input input--file',
    type: 'file',
    accept: '.pdf,.docx,.pptx,.html,.htm,.md',
    'aria-label': 'File to ingest',
  }) as HTMLInputElement;
  const ingestFileForm = el(
    'form',
    { class: 'row' },
    fileInput,
    el('button', { class: 'btn', type: 'submit' }, 'Ingest file'),
  ) as HTMLFormElement;

  // Query
  const queryInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Ask a question…',
    autocomplete: 'off',
    'aria-label': 'Question',
  }) as HTMLInputElement;
  const queryForm = el(
    'form',
    { class: 'row' },
    queryInput,
    el('button', { class: 'btn btn--primary', type: 'submit' }, 'Ask'),
  ) as HTMLFormElement;

  ingestTextForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textArea.value.trim();
    if (!text) return;
    status.textContent = 'Ingesting text…';
    try {
      const result = await ingestRagText(text, sourceInput.value.trim() || undefined);
      status.textContent = `Ingested “${result.sourceId}” — ${result.chunks} chunk(s).`;
      textArea.value = '';
    } catch (error) {
      status.textContent = `Error: ${(error as Error).message}`;
    }
  });

  ingestFileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = `Parsing & ingesting “${file.name}”…`;
    try {
      const result = await ingestRagFile(file);
      status.textContent = `Ingested “${result.sourceId}” — ${result.chunks} chunk(s).`;
      fileInput.value = '';
    } catch (error) {
      status.textContent = `Error: ${(error as Error).message}`;
    }
  });

  queryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = queryInput.value.trim();
    if (!question) return;
    answer.replaceChildren(loadingState('Retrieving and answering…'));
    try {
      answer.replaceChildren(renderAnswer(await queryRag(question)));
    } catch (error) {
      answer.replaceChildren(errorState((error as Error).message));
    }
  });

  outlet.append(
    el(
      'div',
      { class: 'view' },
      el(
        'div',
        { class: 'view__intro' },
        el('div', { class: 'view__eyebrow-row' }, eyebrow('GenAI + Qdrant'), badge('DEMO', 'demo')),
        el('h1', { class: 'view__title', text: 'RAG search' }),
        el('p', {
          class: 'view__lead',
          text:
            'Ingest text or a file (PDF, DOCX, PPTX, HTML, MD), then ask a question ' +
            'answered only from what you ingested. EXAMPLE — safe to delete.',
        }),
      ),
      el(
        'section',
        { class: 'card' },
        el(
          'div',
          { class: 'card__head' },
          el('div', {}, eyebrow('Step 1'), el('h2', { class: 'card__title', text: 'Ingest' })),
        ),
        el('div', { class: 'card__body' }, ingestTextForm, el('div', { class: 'or', text: 'or' }), ingestFileForm, status),
      ),
      el(
        'section',
        { class: 'card' },
        el(
          'div',
          { class: 'card__head' },
          el('div', {}, eyebrow('Step 2'), el('h2', { class: 'card__title', text: 'Ask' })),
        ),
        el('div', { class: 'card__body' }, queryForm, answer),
      ),
    ),
  );
}
