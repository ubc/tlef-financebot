// Reader **Parameters** mode (spec D6, phase 3): the drawn variables and
// computed values of a parameterized question, five sample draws of the
// unsaved drafts, and the verification the server ran on the last save.
// Adapted from the retired Parameterization Configuration page. The reader
// owns saving (P3-1: an approved or paused question returns to review); this
// module owns the drafts. One instance per loaded question.
//
// A migrated `generateScript` (import only) overrides the tables at serve
// time and is never edited or sent from here (P3-3).
import { ApiError, previewQuestionParams, type DerivedValueInput, type ParamPreviewResult, type ParamSlotInput, type QuestionDetail } from '../../api.js';
import { el, mount } from '../../dom.js';
import { numericVerificationSummary } from '../../numeric-verification-summary.js';
import { errorState } from '../../ui.js';

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Every `{{NAME}}` in `text`, in order, de-duplicated. */
export function placeholderNames(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

/** Spec D6: the question has parameters, a migrated script, or a placeholder. */
export function isParameterized(version: QuestionDetail['current']): boolean {
  return !!(version.paramSlots?.length || version.derivedValues?.length || version.generateScript || placeholderNames(version.stem).length);
}

interface SlotDraft { name: string; description: string; min: string; max: string; step: string; values: string }
interface DerivedDraft { name: string; formula: string; errorModel: string }

const numberOrUndefined = (text: string): number | undefined => text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Number(text);

function slotDraft(slot: ParamSlotInput): SlotDraft {
  const text = (value: number | undefined): string => value === undefined ? '' : String(value);
  return { name: slot.name, description: slot.description ?? '', min: text(slot.min), max: text(slot.max), step: text(slot.step), values: (slot.values ?? []).join(', ') };
}

/** The saved shape of a slot row, or null for a row without a name. An
 * explicit value list replaces the range, as on the old page. */
function slotInput(slot: SlotDraft): ParamSlotInput | null {
  const name = slot.name.trim();
  if (!name) return null;
  const description = slot.description.trim() ? { description: slot.description.trim() } : {};
  const values = slot.values.split(',').map((part) => part.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  if (values.length) return { name, ...description, values };
  const range = { min: numberOrUndefined(slot.min), max: numberOrUndefined(slot.max), step: numberOrUndefined(slot.step) };
  return { name, ...description, ...Object.fromEntries(Object.entries(range).filter(([, value]) => value !== undefined)) };
}

export interface ParamsPatch { paramSlots: ParamSlotInput[]; derivedValues: DerivedValueInput[] }

export interface ParamsOptions {
  questionId: string;
  /** Saves the drafts (the reader sends `expectedVersionId` and P3-1). */
  onSave: (patch: ParamsPatch) => void;
  /** Drafts changed: the reader recomputes whether it is locked. */
  onChange: () => void;
}

export function createQuestionParams(options: ParamsOptions) {
  const root = el('section', { class: 'questions-params', 'aria-label': 'Parameters' });
  const draws = el('div', { class: 'questions-params__draws', 'aria-live': 'polite' });
  let versionId = '';
  let slots: SlotDraft[] = [];
  let derived: DerivedDraft[] = [];
  let baseline = '';
  let stem = '';
  let current: QuestionDetail | undefined;
  let locked = false;
  let drawing = false;
  /** The server's reason the last save could not be verified. */
  let saveError: string | undefined;

  const patch = (): ParamsPatch => ({
    paramSlots: slots.map(slotInput).filter((slot): slot is ParamSlotInput => slot !== null),
    // Blank rows are dropped (the server requires a name and a formula), and
    // the list is always sent so removing the last row clears it.
    derivedValues: derived
      .filter((row) => row.name.trim() && row.formula.trim())
      .map((row) => ({ name: row.name.trim(), formula: row.formula.trim(), ...(row.errorModel.trim() ? { errorModel: row.errorModel.trim() } : {}) })),
  });
  const isDirty = (): boolean => !!versionId && JSON.stringify(patch()) !== baseline;

  function reset(detail: QuestionDetail): void {
    versionId = detail.current._id;
    stem = detail.current.stem;
    slots = (detail.current.paramSlots ?? []).map(slotDraft);
    derived = (detail.current.derivedValues ?? []).map((row) => ({ name: row.name, formula: row.formula, errorModel: row.errorModel ?? '' }));
    baseline = JSON.stringify(patch());
    draws.replaceChildren();
  }

  const changed = (): void => { options.onChange(); };

  function input(label: string, value: string, onInput: (value: string) => void, attrs: Record<string, string> = {}): HTMLInputElement {
    const node = el('input', { class: 'input', type: 'text', 'aria-label': label, value, disabled: locked, ...attrs }) as HTMLInputElement;
    node.addEventListener('input', () => { onInput(node.value); changed(); });
    return node;
  }

  function slotRow(slot: SlotDraft, index: number, referenced: ReadonlySet<string>): HTMLElement {
    const label = (field: string): string => `Variable ${index + 1} ${field}`;
    const status = el('span', { class: 'questions-params__status' });
    const syncStatus = (): void => {
      const name = slot.name.trim();
      const found = !!name && referenced.has(name);
      status.textContent = !name ? '' : found ? 'in stem' : 'not in stem';
      status.classList.toggle('is-missing', !!name && !found);
    };
    syncStatus();
    return el('tr', {},
      el('td', {}, input(label('name'), slot.name, (value) => { slot.name = value; syncStatus(); }, { class: 'input mono' }), status),
      el('td', {}, input(label('description'), slot.description, (value) => { slot.description = value; })),
      el('td', {}, input(label('minimum'), slot.min, (value) => { slot.min = value; }, { inputmode: 'decimal' })),
      el('td', {}, input(label('maximum'), slot.max, (value) => { slot.max = value; }, { inputmode: 'decimal' })),
      el('td', {}, input(label('step'), slot.step, (value) => { slot.step = value; }, { inputmode: 'decimal' })),
      el('td', {}, input(label('values'), slot.values, (value) => { slot.values = value; }, { placeholder: 'e.g. 3, 7, 11' })),
      el('td', {}, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: locked, 'aria-label': `Remove variable ${slot.name || index + 1}`,
        onclick: () => { slots.splice(index, 1); changed(); draw(); } }, 'Remove')));
  }

  function derivedRow(row: DerivedDraft, index: number): HTMLElement {
    const label = (field: string): string => `Computed value ${index + 1} ${field}`;
    return el('tr', {},
      el('td', {}, input(label('name'), row.name, (value) => { row.name = value; }, { class: 'input mono' })),
      el('td', {}, input(label('formula'), row.formula, (value) => { row.formula = value; }, { class: 'input mono', placeholder: 'PAYMENT/(1+RATE_PCT/100)^2' })),
      el('td', {}, input(label('mistake'), row.errorModel, (value) => { row.errorModel = value; }, { placeholder: 'Distractors: the mistake it represents' })),
      el('td', {}, el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: locked, 'aria-label': `Remove computed value ${row.name || index + 1}`,
        onclick: () => { derived.splice(index, 1); changed(); draw(); } }, 'Remove')));
  }

  const removeHeader = (): HTMLElement => el('th', { scope: 'col' }, el('span', { class: 'sr-only', text: 'Remove' }));

  function stemWithChips(): HTMLElement {
    const parts: Array<string | HTMLElement> = [];
    let last = 0;
    for (const match of stem.matchAll(PLACEHOLDER)) {
      const at = match.index ?? 0;
      if (at > last) parts.push(stem.slice(last, at));
      parts.push(el('span', { class: 'questions-params__chip', text: `[${match[1]}]` }));
      last = at + match[0].length;
    }
    if (last < stem.length) parts.push(stem.slice(last));
    // Display only: the stored stem keeps {{NAME}} and is never edited here.
    return el('p', { class: 'questions-params__stem' }, ...parts);
  }

  function verification(detail: QuestionDetail): HTMLElement {
    if (saveError) {
      return el('div', { class: 'questions-params__verification is-failed', role: 'status' },
        el('strong', { text: 'Not verified — this question will not be served to students. ' }), saveError);
    }
    const summary = numericVerificationSummary(detail.current.verification);
    return summary
      ? el('div', { class: 'questions-params__verification is-verified', role: 'status', text: summary })
      : el('p', { class: 'questions-params__help', role: 'status', text: 'No numerical verification is recorded for this version.' });
  }

  function showDraws(result: ParamPreviewResult): void {
    mount(draws,
      result.warnings.length ? el('ul', { class: 'questions-params__warnings' }, ...result.warnings.map((warning) => el('li', { text: warning }))) : false,
      el('ol', { class: 'questions-params__draw-list' }, ...result.draws.map((sample) => el('li', { text: sample.stem ?? JSON.stringify(sample.values) }))));
  }

  async function drawSamples(): Promise<void> {
    if (drawing || locked) return;
    drawing = true; draw();
    try {
      showDraws(await previewQuestionParams(options.questionId, { ...patch(), stem }));
    } catch (error) {
      mount(draws, errorState(error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)));
    }
    drawing = false; draw();
  }

  function draw(): void {
    const detail = current;
    if (!detail) return;
    const referenced = new Set(placeholderNames(stem));
    const returnsToReview = detail.state === 'approved' || detail.state === 'paused';
    mount(root,
      detail.current.generateScript
        ? el('div', { class: 'questions-params__verification is-failed', role: 'status' },
          el('strong', { text: 'This question uses an imported generate() script. ' }),
          'Its values come from that script, not from the tables below, and the tables are ignored while the script is present. Scripts are not editable here.')
        : false,
      el('h3', { text: 'Question stem' }),
      stemWithChips(),
      el('h3', { text: 'Drawn variables', 'data-tutorial': 'parameter-definitions' }),
      el('p', { class: 'questions-params__help', text: 'Each student gets values drawn from these ranges (or from an explicit list of values).' }),
      el('div', { class: 'questions-params__table-wrap' },
        el('table', { class: 'questions-params__table' },
          el('thead', {}, el('tr', {}, ...['Name', 'Description', 'Min', 'Max', 'Step', 'Values'].map((text) => el('th', { scope: 'col', text })), removeHeader())),
          el('tbody', {}, ...slots.map((slot, index) => slotRow(slot, index, referenced))))),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: locked, onclick: () => { slots.push({ name: '', description: '', min: '', max: '', step: '', values: '' }); changed(); draw(); } }, '+ Add drawn variable'),
      el('h3', { text: 'Computed values' }),
      el('p', { class: 'questions-params__help', text: 'The correct answer and every distractor are computed from the drawn variables, in order; a later formula may use an earlier name.' }),
      el('div', { class: 'questions-params__table-wrap' },
        el('table', { class: 'questions-params__table' },
          el('thead', {}, el('tr', {}, ...['Name', 'Formula', 'Mistake (distractors)'].map((text) => el('th', { scope: 'col', text })), removeHeader())),
          el('tbody', {}, ...derived.map(derivedRow)))),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: locked, onclick: () => { derived.push({ name: '', formula: '', errorModel: '' }); changed(); draw(); } }, '+ Add computed value'),
      el('h3', { text: 'Verification' }),
      verification(detail),
      el('div', { class: 'questions-params__actions', 'data-tutorial': 'parameter-verification' },
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: locked || drawing, onclick: () => { void drawSamples(); } }, drawing ? 'Drawing…' : 'Draw five samples'),
        el('button', { class: 'btn btn--instr-primary btn--sm', type: 'button', disabled: locked || drawing, onclick: () => options.onSave(patch()) }, 'Save parameters')),
      el('p', { class: 'questions-params__help', text: returnsToReview
        ? 'Saving returns this question to To review: formulas decide which answer is correct.'
        : 'The server verifies the formulas on every save. Saving does not approve the question.' }),
      el('h3', { text: 'Sample draws' }),
      draws.childElementCount ? draws : el('p', { class: 'questions-params__help', text: 'Draw five samples to see the stem with values filled in, using the tables above as they are now.' }));
  }

  return {
    render(detail: QuestionDetail, readerLocked: boolean): HTMLElement {
      current = detail; locked = readerLocked;
      // A new saved version replaces the drafts unless they hold unsaved work.
      if (detail.current._id !== versionId && !isDirty()) reset(detail);
      draw();
      return root;
    },
    isDirty,
    /** The outcome of a save: the server's verification error, if any. */
    saved(verificationError: string | undefined): void { saveError = verificationError; versionId = ''; },
    discard(): void { versionId = ''; saveError = undefined; },
  };
}
