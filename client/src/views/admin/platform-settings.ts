import {
  ApiError,
  PIPELINE_STEPS,
  getAdminPlatformSettings,
  saveAdminPlatformSettings,
  temperatureAllowed,
  type CapabilityProfile,
  type ModelCatalogue,
  type PipelineStep,
  type PlatformSettings,
  type ReasoningEffort,
  type StepModelConfig,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

const STEP_LABEL: Record<PipelineStep, string> = {
  generator: 'Generator',
  validator: 'Structure validator',
  reviewer: 'Reviewer',
  masteryEvaluator: 'Mastery evaluator',
  utility: 'Utility',
};

const STEP_HINT: Record<PipelineStep, string> = {
  generator: 'Drafts each question. Runs warm so a batch of questions differs.',
  validator: 'Checks every option plays the role it claims.',
  reviewer: 'Judges pedagogical quality. The main quality gate — worth spending effort on.',
  masteryEvaluator: 'Not yet wired: saved, but no code reads it.',
  utility: 'Material classification, hierarchy suggestions, and import conversion.',
};

/**
 * Which parameters a model accepts is measured server-side, so the console never
 * hardcodes a model id or a range — it renders whatever the catalogue declares.
 * The pairing that matters: a temperature is legal only while the effective
 * reasoning effort is `none`, so the two controls are mutually exclusive and
 * swap as the effort changes.
 */
async function renderInner(outlet: HTMLElement): Promise<void> {
  const body = el('div', {}, loadingState('Loading platform settings…'));
  mount(outlet, el('div', { class: 'view view--admin' }, body));
  let settings: PlatformSettings & { catalogue: ModelCatalogue };
  try {
    settings = await getAdminPlatformSettings();
  } catch (error) {
    body.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    return;
  }

  const draft: Record<PipelineStep, StepModelConfig> = { ...settings.models };
  const customModels = [...(settings.customModels ?? [])];
  const status = el('span', { class: 'form-status', role: 'status', 'aria-live': 'polite' });

  function profileOf(modelId: string): CapabilityProfile {
    return settings.catalogue.models.find((m) => m.id === modelId)?.profile
      ?? customModels.find((m) => m.id === modelId)?.profile
      ?? 'classic';
  }

  /** One step: a model select plus whichever parameter control that model allows. */
  function stepField(step: PipelineStep): HTMLElement {
    const params = el('div', { class: 'admin-step__params' });
    const select = el('select', { class: 'input', 'aria-label': `${STEP_LABEL[step]} model` }) as HTMLSelectElement;

    function renderParams(): void {
      const caps = settings.catalogue.profiles[profileOf(draft[step].model)];
      const children: HTMLElement[] = [];

      if (caps.reasoningEffort) {
        const effort = el('select', { class: 'input', 'aria-label': `${STEP_LABEL[step]} reasoning effort` }) as HTMLSelectElement;
        for (const value of caps.reasoningEffort) {
          const label = value === caps.defaultEffort ? `${value} (model default)` : value;
          effort.append(el('option', { value, text: label }));
        }
        effort.value = draft[step].reasoningEffort ?? caps.defaultEffort;
        effort.onchange = () => {
          const next = effort.value as ReasoningEffort;
          draft[step] = { ...draft[step], reasoningEffort: next };
          // Turning reasoning on makes a temperature illegal; drop it rather
          // than saving a combination the provider rejects with a 400.
          if (!temperatureAllowed(caps, next)) delete draft[step].temperature;
          renderParams();
        };
        children.push(el('label', { class: 'form-field' },
          el('span', { class: 'form-field__label', text: 'Reasoning effort' }), effort,
        ));
      }

      const effortNow = draft[step].reasoningEffort;
      if (temperatureAllowed(caps, effortNow)) {
        const { min, max, default: fallback } = caps.temperature!;
        const temp = el('input', {
          class: 'input', type: 'number', step: '0.1', min: String(min), max: String(max),
          value: String(draft[step].temperature ?? fallback),
          'aria-label': `${STEP_LABEL[step]} temperature`,
        }) as HTMLInputElement;
        temp.onchange = () => { draft[step] = { ...draft[step], temperature: Number(temp.value) }; };
        children.push(el('label', { class: 'form-field' },
          el('span', { class: 'form-field__label', text: `Temperature (${min}–${max})` }), temp,
        ));
      } else if (caps.temperature) {
        children.push(el('p', { class: 'muted admin-step__note',
          text: 'Temperature is unavailable while this model is reasoning. Set effort to “none” to use it.' }));
      }
      params.replaceChildren(...children);
    }

    function renderOptions(): void {
      select.replaceChildren(...[...settings.catalogue.models, ...customModels.map((m) => ({ ...m, custom: true }))]
        .filter((m, i, all) => all.findIndex((other) => other.id === m.id) === i)
        .map((m) => el('option', { value: m.id, text: m.custom ? `${m.id} (custom)` : m.id })));
      // A model configured before it left the catalogue must stay selectable,
      // otherwise opening this page would silently reassign the step on save.
      if (!Array.from(select.options).some((o) => o.value === draft[step].model)) {
        select.prepend(el('option', { value: draft[step].model, text: `${draft[step].model} (not in catalogue)` }));
      }
      select.value = draft[step].model;
    }

    select.onchange = () => {
      // Parameters belong to the old model's profile; carrying them over is how
      // an illegal combination gets saved.
      draft[step] = { model: select.value };
      renderParams();
    };
    renderOptions();
    renderParams();

    return el('div', { class: 'admin-step' },
      el('label', { class: 'form-field' },
        el('span', { class: 'form-field__label', text: STEP_LABEL[step] }), select,
      ),
      el('p', { class: 'muted admin-step__hint', text: STEP_HINT[step] }),
      params,
    );
  }

  const stepsGrid = el('div', { class: 'admin-settings-grid' }, ...PIPELINE_STEPS.map(stepField));
  const maxDaily = el('input', { class: 'input', type: 'number', min: '1', value: String(settings.costControls.maxGenerationsPerDay) }) as HTMLInputElement;
  const reviewer = el('input', { type: 'checkbox' }) as HTMLInputElement;
  reviewer.checked = settings.featureFlags.reviewerAgent;
  const layer2 = el('input', { type: 'checkbox' }) as HTMLInputElement;
  layer2.checked = settings.featureFlags.layer2Evaluator;

  // --- custom models -------------------------------------------------------
  const customList = el('div', { class: 'admin-feature-list' });
  const customId = el('input', { class: 'input', placeholder: 'model-id', 'aria-label': 'Custom model id' }) as HTMLInputElement;
  const customProfile = el('select', { class: 'input', 'aria-label': 'Custom model capability profile' }) as HTMLSelectElement;
  for (const profile of Object.keys(settings.catalogue.profiles)) {
    customProfile.append(el('option', { value: profile, text: profile }));
  }

  function renderCustom(): void {
    customList.replaceChildren(...customModels.map((entry, index) => el('div', { class: 'admin-feature' },
      el('span', {}, el('strong', { text: entry.id }), el('small', { text: `profile: ${entry.profile}` })),
      el('button', { class: 'btn btn--ghost', type: 'button', text: 'Remove', onclick: () => {
        customModels.splice(index, 1);
        renderCustom();
        stepsGrid.replaceChildren(...PIPELINE_STEPS.map(stepField));
      } }),
    )));
    if (customModels.length === 0) {
      customList.replaceChildren(el('p', { class: 'muted', text: 'No custom models. The shipped catalogue is in use.' }));
    }
  }
  renderCustom();

  async function save(): Promise<void> {
    let confirmQualityImpact = false;
    if (settings.featureFlags.reviewerAgent && !reviewer.checked) {
      confirmQualityImpact = await confirmDialog({
        title: 'Disable Reviewer Agent?',
        message: 'Generated questions will skip semantic quality review and be saved as flagged with a disabled-reviewer reason. Instructors must review them manually.',
        confirmLabel: 'Disable reviewer', tone: 'danger',
      });
      if (!confirmQualityImpact) return;
    }
    try {
      const saved = await saveAdminPlatformSettings({
        models: draft,
        customModels,
        costControls: { maxGenerationsPerDay: Number(maxDaily.value) },
        featureFlags: { reviewerAgent: reviewer.checked, layer2Evaluator: layer2.checked },
      }, confirmQualityImpact);
      settings = { ...saved, catalogue: settings.catalogue };
      status.textContent = 'Applied to new generation/evaluation work.';
    } catch (error) {
      status.textContent = error instanceof ApiError ? error.message : (error as Error).message;
    }
  }

  body.replaceChildren(
    pageHeader('Platform Settings', 'Model selection, generation cost limits, and quality feature flags.'),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        el('h2', { text: 'Pipeline models' }),
        el('p', { class: 'muted', text: 'Model and parameters used when new background work starts. Which parameters a model accepts is enforced by the server — a combination it rejects cannot be selected here.' }),
      ),
      stepsGrid,
    ),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        el('h2', { text: 'Custom models' }),
        el('p', { class: 'muted', text: 'Use a model that is not in the shipped catalogue by assigning it an existing capability profile. A profile is behaviour, so a genuinely new one needs a code change.' }),
      ),
      customList,
      el('div', { class: 'admin-settings-grid' },
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Model id' }), customId),
        el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Capability profile' }), customProfile),
      ),
      el('button', { class: 'btn', type: 'button', text: 'Add model', onclick: () => {
        const id = customId.value.trim();
        if (!id || customModels.some((m) => m.id === id)) return;
        customModels.push({ id, profile: customProfile.value as CapabilityProfile });
        customId.value = '';
        renderCustom();
        stepsGrid.replaceChildren(...PIPELINE_STEPS.map(stepField));
      } }),
    ),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        el('h2', { text: 'Cost controls' }),
        el('p', { class: 'muted', text: 'Platform-wide guardrails for AI generation volume. Counts questions, not tokens — reasoning effort is not bounded by this.' }),
      ),
      el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Maximum generations per day' }), maxDaily),
    ),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        el('h2', { text: 'Feature flags' }),
        el('p', { class: 'muted', text: 'Quality stages applied to new work. Disabling review requires confirmation.' }),
      ),
      el('div', { class: 'admin-feature-list' },
        el('label', { class: 'checkbox-row admin-feature' }, reviewer,
          el('span', {}, el('strong', { text: 'Reviewer Agent' }), el('small', { text: 'Semantic quality review for generated questions.' })),
        ),
        el('label', { class: 'checkbox-row admin-feature' }, layer2,
          el('span', {}, el('strong', { text: 'Layer 2 Mastery Evaluator' }),
            el('small', { text: 'Not yet wired: this flag is saved but no code reads it.' })),
        ),
      ),
    ),
    el('div', { class: 'admin-save-bar' }, el('button', { class: 'btn btn--primary', type: 'button', text: 'Save settings', onclick: () => void save() }), status),
  );
}

export function renderAdminPlatformSettings(outlet: HTMLElement, _params: RouteParams): void {
  void renderInner(outlet);
}
