// Reusable "System status" card: turns GET /api/health into readable status
// dots + a GenAI config readout, with loading/error states and a raw-JSON
// toggle. Used on both the landing screen and the Overview page.
import { checkHealth, type HealthResponse } from '../api.js';
import { el } from '../dom.js';
import { eyebrow, statusDot, loadingState, errorState } from '../ui.js';

function mono(text: string): HTMLElement {
  return el('span', { class: 'mono', text });
}

function providerRow(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'kv' },
    el('span', { class: 'kv__key', text: label }),
    mono(value),
  );
}

function renderHealth(health: HealthResponse): HTMLElement {
  const services = Object.entries(health.services);
  const dots = services.length
    ? services.map(([name, state]) => statusDot(name, state === 'up' ? 'up' : 'down'))
    : [el('p', { class: 'state__text', text: 'No services reported.' })];

  const { genai } = health;
  return el(
    'div',
    {},
    el('div', { class: 'status-grid' }, ...dots),
    el('div', { class: 'divider' }),
    el(
      'div',
      { class: 'kv-list' },
      providerRow('LLM', `${genai.llmProvider}/${genai.llmModel}`),
      providerRow('Embeddings', `${genai.embeddingsProvider}/${genai.embeddingsModel}`),
    ),
    el(
      'details',
      { class: 'raw' },
      el('summary', { text: 'Raw response' }),
      el('pre', { class: 'raw__pre', text: JSON.stringify(health, null, 2) }),
    ),
  );
}

/** Build a self-loading health card. Refreshes on demand. */
export function healthCard(): HTMLElement {
  const body = el('div', { class: 'card__body' });
  const refresh = el(
    'button',
    { class: 'btn btn--ghost btn--sm', type: 'button' },
    'Refresh',
  );

  const load = async (): Promise<void> => {
    body.replaceChildren(loadingState('Checking services…'));
    try {
      body.replaceChildren(renderHealth(await checkHealth()));
    } catch (error) {
      body.replaceChildren(errorState((error as Error).message, () => void load()));
    }
  };

  refresh.addEventListener('click', () => void load());
  void load();

  return el(
    'section',
    { class: 'card' },
    el(
      'div',
      { class: 'card__head' },
      el('div', {}, eyebrow('Backend'), el('h2', { class: 'card__title', text: 'System status' })),
      refresh,
    ),
    body,
  );
}
