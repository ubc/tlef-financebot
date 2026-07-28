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

  const errorSlot = el('div', {});
  const stemDisplay = el('p', { class: 'param-config__stem', text: stem });
  const slotsContainer = el('div', { class: 'param-slots' });
  const previewSlot = el('div', { class: 'param-preview' });

  const saveButton = el('button', { class: 'btn btn--instr-primary', type: 'button' }, 'Save Parameters') as HTMLButtonElement;
  const previewButton = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Preview 5 Draws') as HTMLButtonElement;
  const addSlotButton = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, '+ Add Slot') as HTMLButtonElement;

  function renderSlots(): void {
    const referenced = new Set(placeholdersIn(stem));

    const rows = draftSlots.map((slot, index) => {
      const linked = slot.name.trim().length > 0 && referenced.has(slot.name.trim());

      const nameInput = el('input', {
        class: 'input param-slot__name',
        type: 'text',
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

  function currentPatch(): { paramSlots?: ParamSlotInput[]; generateScript?: string } {
    const paramSlots = draftSlots.map(slotToInput).filter((s): s is ParamSlotInput => s !== null);
    const patch: { paramSlots?: ParamSlotInput[]; generateScript?: string } = { paramSlots };
    if (draftGenerateScript.trim().length > 0) patch.generateScript = draftGenerateScript;
    return patch;
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
        draftGenerateScript = saved.generateScript ?? '';
        generateScriptTextarea.value = draftGenerateScript;
        renderSlots();
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
