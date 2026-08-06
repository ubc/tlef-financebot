// Parameterization config panel (Task 5, IN-Q09) — an instructor's editor for
// a question's `paramSlots`/`generateScript`: slot rows visually linked to
// the `{{placeholders}}` detected in the stem, plus a preview button that
// renders 5 sample draws. Saves independently of approval state via
// `PATCH /api/questions/:questionId/params`, mirroring question-detail.ts's
// house style (el()/mount(), no framework, ApiError -> errorState()).
import {
  ApiError,
  getQuestion,
  patchQuestionParams,
  previewQuestionParams,
  type ParamPreviewResult,
  type DerivedValueInput,
  type ParamSlotInput,
  type QuestionDetail,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import { errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

function navigate(path: string): void {
  window.location.hash = path;
}

/** Every `{{name}}` placeholder referenced in `stem`, de-duplicated,
 * appearance order. Drives the "linked to placeholder" highlighting: a slot
 * row whose `name` is in this set gets a "found in stem" indicator; one
 * whose name is absent gets a warning (mirrors the server's
 * `findUnusedParamSlots`, computed client-side here for instant feedback
 * before Preview is ever clicked). */
/**
 * Renders the stem with each `{{NAME}}` placeholder shown as a highlighted
 * `[NAME]` chip. DISPLAY ONLY — the stored stem keeps `{{NAME}}`, which is what
 * `substituteParams` matches on the server. This panel shows the stem
 * read-only, so the two can never be confused; never apply this to an editable
 * field or the placeholders would be corrupted on save.
 */
function stemWithSlotChips(stem: string): HTMLElement {
  const parts: Array<string | HTMLElement> = [];
  const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  let last = 0;
  for (const match of stem.matchAll(re)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(stem.slice(last, at));
    parts.push(el('span', { class: 'slot-chip', text: `[${match[1]}]` }));
    last = at + match[0].length;
  }
  if (last < stem.length) parts.push(stem.slice(last));
  return el('p', { class: 'param-config__stem' }, ...parts);
}

function placeholdersIn(stem: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  for (const m of stem.matchAll(re)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      found.push(m[1]);
    }
  }
  return found;
}

interface DerivedDraft {
  name: string;
  formula: string;
  errorModel: string;
}

interface SlotDraft {
  name: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  valuesText: string; // comma-separated; empty -> no `values` (use min/max/step)
}

function slotToInput(slot: SlotDraft): ParamSlotInput | null {
  if (!slot.name.trim()) return null;
  const values = slot.valuesText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (values.length > 0) {
    return {
      name: slot.name.trim(),
      ...(slot.description ? { description: slot.description } : {}),
      values,
    };
  }
  return {
    name: slot.name.trim(),
    ...(slot.description ? { description: slot.description } : {}),
    ...(slot.min !== undefined ? { min: slot.min } : {}),
    ...(slot.max !== undefined ? { max: slot.max } : {}),
    ...(slot.step !== undefined ? { step: slot.step } : {}),
  };
}

async function renderParamConfigInner(outlet: HTMLElement, questionId: string, fallbackCourseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Loading question…'));
  const root = el('div', { class: 'view view--param-config' }, body);
  mount(outlet, root);

  let detail: QuestionDetail;
  try {
    detail = await getQuestion(questionId);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error).message;
    body.replaceChildren(errorState(message, () => void renderParamConfigInner(outlet, questionId, fallbackCourseId)));
    return;
  }

  const courseId = detail.courseId || fallbackCourseId;
  const stem = detail.current.stem;

  const draftSlots: SlotDraft[] = (detail.current.paramSlots ?? []).map((s) => ({
    name: s.name,
    description: s.description ?? '',
    min: s.min,
    max: s.max,
    step: s.step,
    valuesText: (s.values ?? []).join(', '),
  }));
  // generateScript is NOT instructor-authored: it arrives only via script
  // migration on import (import.service.ts's migrateScript). It is deliberately
  // not editable here — an instructor writes formulas in the table below, not
  // JavaScript. When a migrated script is present it OVERRIDES the table
  // entirely (resolveParamValues checks it first), so say so rather than
  // showing a table that has no effect.
  const migratedScript = detail.current.generateScript ?? '';

  // Derived values: the correct answer and every distractor, each computed
  // from the slots above. Without these a numerical question has no machine-
  // checked answer, so the numeric gate refuses to serve it.
  const draftDerived: DerivedDraft[] = (detail.current.derivedValues ?? []).map((d) => ({
    name: d.name,
    formula: d.formula,
    errorModel: d.errorModel ?? '',
  }));

  const errorSlot = el('div', { class: 'param-config__error' });
  const stemDisplay = stemWithSlotChips(stem);
  const slotsContainer = el('div', { class: 'param-slots' });
  const derivedContainer = el('div', { class: 'derived-values' });
  const verificationSlot = el('div', { class: 'param-config__verification' });
  const previewSlot = el('div', { class: 'param-preview' });

  const saveButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }, 'Save Parameterization') as HTMLButtonElement;
  const previewButton = el('button', { class: 'btn btn--ghost', type: 'button' }, '\u21bb Re-roll preview') as HTMLButtonElement;
  const addSlotButton = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '+ Add Drawn Variable') as HTMLButtonElement;
  const addDerivedButton = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '+ Add Computed Variable') as HTMLButtonElement;

  function renderSlots(): void {
    const referenced = new Set(placeholdersIn(stem));

    const rows = draftSlots.map((slot, index) => {
      const linked = slot.name.trim().length > 0 && referenced.has(slot.name.trim());

      const nameInput = el('input', {
        class: 'input mono param-slot__name',
        type: 'text',
        id: `slot-name-${index}`,
        placeholder: 'CASH_IN',
        value: slot.name,
        oninput: (e: Event) => {
          slot.name = (e.target as HTMLInputElement).value;
          renderSlots();
        },
      }) as HTMLInputElement;

      const minInput = el('input', {
        class: 'input param-slot__num',
        type: 'number',
        id: `slot-min-${index}`,
        placeholder: 'min',
        value: slot.min !== undefined ? String(slot.min) : '',
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          slot.min = v === '' ? undefined : Number(v);
        },
      });

      const maxInput = el('input', {
        class: 'input param-slot__num',
        type: 'number',
        id: `slot-max-${index}`,
        placeholder: 'max',
        value: slot.max !== undefined ? String(slot.max) : '',
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          slot.max = v === '' ? undefined : Number(v);
        },
      });

      const stepInput = el('input', {
        class: 'input param-slot__num',
        type: 'number',
        id: `slot-step-${index}`,
        placeholder: 'step',
        value: slot.step !== undefined ? String(slot.step) : '',
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          slot.step = v === '' ? undefined : Number(v);
        },
      });

      const descriptionInput = el('input', {
        class: 'input',
        type: 'text',
        id: `slot-description-${index}`,
        placeholder: 'e.g. Investment amount',
        value: slot.description,
        oninput: (e: Event) => {
          slot.description = (e.target as HTMLInputElement).value;
        },
      });

      const valuesInput = el('input', {
        class: 'input param-slot__values',
        type: 'text',
        placeholder: 'or explicit values, e.g. 3, 7, 11',
        value: slot.valuesText,
        oninput: (e: Event) => {
          slot.valuesText = (e.target as HTMLInputElement).value;
        },
      });

      const removeButton = el(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          'aria-label': `Remove slot ${slot.name || index + 1}`,
          onclick: () => {
            draftSlots.splice(index, 1);
            renderSlots();
          },
        },
        'Remove',
      );

      return el(
        'div',
        { class: `vardef__row${linked ? ' vardef__row--linked' : ' vardef__row--unlinked'}` },
        el(
          'span',
          { class: 'vardef__var' },
          // The name IS the variable, so it is edited here rather than in a
          // separate column that repeated it.
          nameInput,
          linked
            ? null
            : el('span', { class: 'vardef__warn', title: 'This slot is not referenced in the stem', text: 'not in stem' }),
        ),
        descriptionInput,
        minInput,
        maxInput,
        // Slots have no formula; the range columns carry their definition.
        el('span', { class: 'vardef__na' }, stepInput, valuesInput),
        el('span', { class: 'vardef__type', text: 'Drawn' }),
        removeButton,
      );
    });

    mount(slotsContainer, ...rows);
  }
  renderSlots();

  /** One editable derived-value row: name, formula, and the mistake a
   * distractor represents. Kept deliberately plain — the instructor edits the
   * maths, not JavaScript. */
  function renderDerived(): void {
    const rows = draftDerived.map((derived, index) => {
      const nameInput = el('input', {
        class: 'input mono',
        type: 'text',
        id: `derived-name-${index}`,
        value: derived.name,
        placeholder: 'NET_CASH_FLOW',
        oninput: (e: Event) => { derived.name = (e.target as HTMLInputElement).value.trim(); },
      });
      const formulaInput = el('input', {
        class: 'input mono',
        type: 'text',
        id: `derived-formula-${index}`,
        value: derived.formula,
        placeholder: 'PAYMENT/(1+RATE_PCT/100)^2',
        oninput: (e: Event) => { derived.formula = (e.target as HTMLInputElement).value; },
      });
      const errorModelInput = el('input', {
        class: 'input',
        type: 'text',
        id: `derived-error-${index}`,
        value: derived.errorModel,
        placeholder: 'what this option is, or the mistake it represents',
        oninput: (e: Event) => { derived.errorModel = (e.target as HTMLInputElement).value.trim(); },
      });
      const removeButton = el(
        'button',
        {
          class: 'btn btn--ghost btn--sm',
          type: 'button',
          'aria-label': `Remove derived value ${derived.name || index + 1}`,
          onclick: () => { draftDerived.splice(index, 1); renderDerived(); },
        },
        'Remove',
      );
      return el(
        'div',
        { class: 'vardef__row' },
        el('span', { class: 'vardef__var' }, nameInput),
        errorModelInput,
        el('span', { class: 'vardef__na', text: '—' }),
        el('span', { class: 'vardef__na', text: '—' }),
        formulaInput,
        el('span', { class: 'vardef__type', text: 'Computed' }),
        removeButton,
      );
    });

    mount(derivedContainer, ...rows);
  }
  renderDerived();

  /** The single signal telling an instructor whether students can see this
   * question: absent proof is the numeric gate's refusal condition. */
  function renderVerification(result?: { verification?: unknown; verificationError?: string }): void {
    if (!result) {
      verificationSlot.replaceChildren();
      return;
    }
    if (result.verificationError) {
      verificationSlot.replaceChildren(
        el(
          'div',
          { class: 'verification-banner verification-banner--fail', role: 'status' },
          el('strong', { text: 'Not verified — this question will not be served to students. ' }),
          el('span', { text: result.verificationError }),
        ),
      );
      return;
    }
    verificationSlot.replaceChildren(
      el(
        'div',
        { class: 'verification-banner verification-banner--ok', role: 'status' },
        'Verified across 100 sample draws. Students can be served this question once it is approved.',
      ),
    );
  }
  renderVerification(
    detail.current.verification ? { verification: detail.current.verification } : undefined,
  );

  addDerivedButton.addEventListener('click', () => {
    draftDerived.push({ name: '', formula: '', errorModel: '' });
    renderDerived();
  });

  addSlotButton.addEventListener('click', () => {
    draftSlots.push({ name: '', description: '', valuesText: '' });
    renderSlots();
  });

  function currentPatch(): { paramSlots?: ParamSlotInput[]; derivedValues?: DerivedValueInput[] } {
    const paramSlots = draftSlots.map(slotToInput).filter((s): s is ParamSlotInput => s !== null);
    // Blank rows are dropped rather than sent: the server's schema requires a
    // non-empty formula and an identifier-shaped name, so an empty row an
    // instructor added but never filled in would 400 the whole save.
    const derivedValues = draftDerived
      .filter((d) => d.name.length > 0 && d.formula.trim().length > 0)
      .map((d) => ({
        name: d.name,
        formula: d.formula.trim(),
        ...(d.errorModel.length > 0 ? { errorModel: d.errorModel } : {}),
      }));
    // derivedValues is always included (even empty) so that removing the last
    // row clears the saved list rather than leaving it in place —
    // editQuestion() treats `patch.derivedValues !== undefined` as "set this
    // field". generateScript is deliberately NOT sent: this page never edits
    // it, and sending it would let a UI that cannot show a script silently
    // erase one.
    return { paramSlots, derivedValues };
  }

  function renderDraws(result: ParamPreviewResult): void {
    const warningBlock = result.warnings.length
      ? el(
          'ul',
          { class: 'param-preview__warnings' },
          ...result.warnings.map((w) => el('li', { text: w })),
        )
      : null;

    const drawRows = result.draws.map((draw, i) =>
      el(
        'div',
        { class: 'param-preview__draw' },
        el('span', { class: 'param-preview__draw-label', text: `Draw ${i + 1}` }),
        el('span', { class: 'param-preview__draw-text', text: draw.stem ?? JSON.stringify(draw.values) }),
      ),
    );

    mount(previewSlot, ...(warningBlock ? [warningBlock] : []), ...drawRows);
  }

  previewButton.addEventListener('click', () => {
    void (async () => {
      errorSlot.replaceChildren();
      try {
        const result = await previewQuestionParams(questionId, { ...currentPatch(), stem });
        renderDraws(result);
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    })();
  });

  saveButton.addEventListener('click', () => {
    void (async () => {
      errorSlot.replaceChildren();
      try {
        const saved = await patchQuestionParams(questionId, currentPatch());
        draftSlots.length = 0;
        for (const s of saved.paramSlots ?? []) {
          draftSlots.push({
            name: s.name,
            description: s.description ?? '',
            min: s.min,
            max: s.max,
            step: s.step,
            valuesText: (s.values ?? []).join(', '),
          });
        }
        draftDerived.length = 0;
        for (const d of saved.derivedValues ?? []) {
          draftDerived.push({ name: d.name, formula: d.formula, errorModel: d.errorModel ?? '' });
        }
        renderSlots();
        renderDerived();
        // The server verifies on every save; show the outcome immediately,
        // since an unverified numerical question silently never serves.
        renderVerification(saved);
      } catch (error) {
        errorSlot.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
      }
    })();
  });

  body.replaceChildren(
    el(
      'a',
      {
        class: 'breadcrumb-back',
        href: `#/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(questionId)}`,
        onclick: (e: Event) => {
          e.preventDefault();
          navigate(`/instructor/course/${encodeURIComponent(courseId)}/bank/${encodeURIComponent(questionId)}`);
        },
      },
      '← Back to Question',
    ),
    pageHeader(
      'Parameterization Configuration',
      'Define variable slots and value ranges so the system can generate structurally '
        + 'identical variants with different numbers at serve time.',
    ),
    el(
      'div',
      { class: 'param-config-layout' },
      migratedScript
        ? el(
            'div',
            { class: 'verification-banner verification-banner--fail', role: 'status' },
            el('strong', { text: 'This question uses an imported generate() script. ' }),
            el('span', {
              text: 'Its values come from that script, not from the table below, and the table '
                + 'is ignored while the script is present. Scripts are not editable here.',
            }),
          )
        : null,
      el('h3', { class: 'detail-section-title', text: 'Question stem (variable slots highlighted)' }),
      stemDisplay,
      el('h3', { class: 'detail-section-title', text: 'Variable Definitions' }),
      el('p', {
        class: 'form-field__help',
        text: 'Drawn variables are randomised per student within their range. Computed '
          + 'variables are calculated from them by formula — the correct answer and every '
          + 'distractor. Every number a student sees comes from this table.',
      }),
      el(
        'div',
        { class: 'vardef__head' },
        el('span', { text: 'Variable' }),
        el('span', { text: 'Description' }),
        el('span', { text: 'Min' }),
        el('span', { text: 'Max' }),
        el('span', { text: 'Step / values / formula' }),
        el('span', { text: 'Type' }),
        el('span', { text: '' }),
      ),
      slotsContainer,
      derivedContainer,
      el('div', { class: 'row row--wrap param-config__add' }, addSlotButton, addDerivedButton),
      verificationSlot,
      errorSlot,
      el('div', { class: 'param-config-actions' }, previewButton, saveButton),
      el('h3', { class: 'detail-section-title', text: 'Preview — sample randomized variant' }),
      previewSlot,
      el('p', {
        class: 'form-field__help',
        text: 'Saving does not change the question\u2019s approval state. The question must '
          + 'still be approved to be served to students.',
      }),
    ),
  );
}

export function renderParamConfig(outlet: HTMLElement, params: RouteParams): void {
  void renderParamConfigInner(outlet, params.questionId, params.id);
}
