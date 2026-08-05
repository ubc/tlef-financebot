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
    return { name: slot.name.trim(), values };
  }
  return {
    name: slot.name.trim(),
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
    min: s.min,
    max: s.max,
    step: s.step,
    valuesText: (s.values ?? []).join(', '),
  }));
  let draftGenerateScript = detail.current.generateScript ?? '';

  // Derived values: the correct answer and every distractor, each computed
  // from the slots above. Without these a numerical question has no machine-
  // checked answer, so the numeric gate refuses to serve it.
  const draftDerived: DerivedDraft[] = (detail.current.derivedValues ?? []).map((d) => ({
    name: d.name,
    formula: d.formula,
    errorModel: d.errorModel ?? '',
  }));

  const errorSlot = el('div', {});
  const stemDisplay = el('p', { class: 'param-config__stem', text: stem });
  const slotsContainer = el('div', { class: 'param-slots' });
  const derivedContainer = el('div', { class: 'derived-values' });
  const verificationSlot = el('div', {});
  const previewSlot = el('div', { class: 'param-preview' });

  const saveButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }, 'Save Parameters') as HTMLButtonElement;
  const previewButton = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Preview 5 Draws') as HTMLButtonElement;
  const addSlotButton = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '+ Add Slot') as HTMLButtonElement;
  const addDerivedButton = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '+ Add Derived Value') as HTMLButtonElement;

  function renderSlots(): void {
    const referenced = new Set(placeholdersIn(stem));

    const rows = draftSlots.map((slot, index) => {
      const linked = slot.name.trim().length > 0 && referenced.has(slot.name.trim());

      const nameInput = el('input', {
        class: 'input param-slot__name',
        type: 'text',
        id: `slot-name-${index}`,
        placeholder: 'slot name',
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
          class: 'param-slot__remove',
          type: 'button',
          'aria-label': `Remove slot ${slot.name || index + 1}`,
          onclick: () => {
            draftSlots.splice(index, 1);
            renderSlots();
          },
        },
        '×',
      );

      return el(
        'div',
        { class: `param-slot${linked ? ' param-slot--linked' : ' param-slot--unlinked'}` },
        el('span', {
          class: 'param-slot__badge',
          text: linked ? `linked to {{${slot.name}}}` : `no {{${slot.name || '…'}}} found in stem`,
        }),
        nameInput,
        minInput,
        maxInput,
        stepInput,
        valuesInput,
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
        class: 'input',
        type: 'text',
        id: `derived-name-${index}`,
        value: derived.name,
        placeholder: 'PV',
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
        placeholder: 'compounded forward instead of discounting back',
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
      return el('div', { class: 'derived-values__row' }, nameInput, formulaInput, errorModelInput, removeButton);
    });

    mount(
      derivedContainer,
      el(
        'div',
        { class: 'derived-values__head' },
        el('span', { text: 'Name' }),
        el('span', { text: 'Formula' }),
        el('span', { text: 'Represents this mistake' }),
        el('span', { text: '' }),
      ),
      ...rows,
    );
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
    draftSlots.push({ name: '', valuesText: '' });
    renderSlots();
  });

  const generateScriptTextarea = el('textarea', {
    class: 'input input--area param-config__script',
    rows: '6',
    placeholder: 'Advanced: instructor-authored generate(random) script (overrides slot draws when present)',
    text: draftGenerateScript,
    oninput: (e: Event) => {
      draftGenerateScript = (e.target as HTMLTextAreaElement).value;
    },
  }) as HTMLTextAreaElement;

  function currentPatch(): { paramSlots?: ParamSlotInput[]; derivedValues?: DerivedValueInput[]; generateScript?: string } {
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
    // generateScript is always included (even '') so that blanking a
    // previously-saved script and clicking Save explicitly clears it
    // server-side — editQuestion() treats `patch.generateScript !== undefined`
    // as "set this field," and an omitted key would leave the stale script
    // active (and still preferred over paramSlots by resolveParamValues).
    // derivedValues is always included for the same reason: removing the last
    // row must clear the saved list, not leave it in place.
    return { paramSlots, derivedValues, generateScript: draftGenerateScript };
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
          draftSlots.push({ name: s.name, min: s.min, max: s.max, step: s.step, valuesText: (s.values ?? []).join(', ') });
        }
        draftDerived.length = 0;
        for (const d of saved.derivedValues ?? []) {
          draftDerived.push({ name: d.name, formula: d.formula, errorModel: d.errorModel ?? '' });
        }
        draftGenerateScript = saved.generateScript ?? '';
        generateScriptTextarea.value = draftGenerateScript;
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
    pageHeader('Parameterization', 'Configure randomized {{slots}} for this question.'),
    el(
      'div',
      { class: 'param-config-layout' },
      el('h3', { class: 'detail-section-title', text: 'Stem' }),
      stemDisplay,
      el('h3', { class: 'detail-section-title', text: 'Slots' }),
      slotsContainer,
      addSlotButton,
      el('h3', { class: 'detail-section-title', text: 'Derived Values' }),
      el('p', {
        class: 'form-field__help',
        text: 'The correct answer and every distractor, computed from the slots above. '
          + 'Each distractor should name the specific mistake it represents.',
      }),
      derivedContainer,
      addDerivedButton,
      verificationSlot,
      el('h3', { class: 'detail-section-title', text: 'Generate Script (advanced, optional)' }),
      generateScriptTextarea,
      errorSlot,
      el('div', { class: 'param-config-actions' }, previewButton, saveButton),
      el('h3', { class: 'detail-section-title', text: 'Preview' }),
      previewSlot,
    ),
  );
}

export function renderParamConfig(outlet: HTMLElement, params: RouteParams): void {
  void renderParamConfigInner(outlet, params.questionId, params.id);
}
