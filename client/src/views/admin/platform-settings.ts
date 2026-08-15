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
import { pageHeader, sectionTitleWithHelp } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import type { RouteParams } from '../../router.js';
import { errorState, helpTip, loadingState } from '../../ui.js';

const STEP_LABEL: Record<PipelineStep, string> = {
  generator: 'Generator',
  validator: 'Structure validator',
  reviewer: 'Reviewer',
  masteryEvaluator: 'Mastery evaluator',
  utility: 'Utility',
};

// Prose moved off the page and behind `helpTip` (2026-08-15): five steps each
// carrying a sentence of explanation made the panel unreadable, and the
// explanations matter only when someone is deciding, not every visit.
const STEP_HELP: Record<PipelineStep, string> = {
  generator:
    'Drafts each question from the retrieved course material. It runs warm — a higher temperature — '
    + 'so that asking for several questions at once yields genuinely different ones rather than three '
    + 'near-copies. Leave the temperature blank to keep that behaviour.',
  validator:
    'Checks that every option plays the role it claims: exactly one correct answer, and distractors '
    + 'that are wrong for the reason their error model states. Wants reproducible output, so leave it '
    + 'deterministic unless you are deliberately experimenting.',
  reviewer:
    'Judges pedagogical quality against the five review criteria and returns pass, flag or reject. '
    + 'This is the gate that catches problems structural checks cannot see, so it is the step where '
    + 'spending reasoning effort is most likely to pay for itself.',
  masteryEvaluator:
    'Not yet wired. This setting is saved and audited, but no code reads it — there is no '
    + 'mastery-evaluator model call anywhere in the pipeline today.',
  utility:
    'Everything that is not one of the three question agents: classifying uploaded material, '
    + 'suggesting a course hierarchy, and converting imported short-answer questions. These ran on '
    + 'the environment default with no admin control until this step existed.',
};

const TEMPERATURE_HELP =
  'How much the model varies its wording between runs. 0 is reproducible; higher is more varied. '
  + 'Leave blank to use the step default — a saved value overrides it, which for the generator '
  + 'would switch off the batch variety it depends on.';

const EFFORT_HELP =
  'How long the model reasons before answering. Higher effort costs more tokens and takes longer, '
  + 'and it is not a determinism control. Setting anything other than "none" makes temperature '
  + 'unavailable, because the provider rejects an explicit temperature while a model is reasoning.';

// Panel descriptions live behind the section heading's own info icon, for the
// same reason the per-step ones do — four paragraphs of standing prose is what
// made this page hard to scan.
const PANEL_HELP = {
  pipeline:
    'Each stage of question generation can run on its own model. A change applies to work that '
    + 'STARTS after it is saved — anything already queued keeps the models it was enqueued with. '
    + 'Which parameters a model accepts is measured from the provider and enforced by the server, '
    + 'so a combination it would reject cannot be selected here.',
  custom:
    'Use a model that is not in the shipped list by telling the platform which behaviour it has: '
    + 'whether it takes a temperature, whether it reasons, and what it calls its token limit. '
    + 'There is deliberately no way to describe a NEW behaviour — that is code, not configuration, '
    + 'so a model whose API differs from the profiles here needs a release.',
  cost:
    'A platform-wide ceiling on generated questions per day, counted across every course. It counts '
    + 'QUESTIONS, not tokens, so it does not bound what reasoning effort costs — a reviewer at high '
    + 'effort spends more per question without changing this number.',
  flags:
    'Quality stages applied to new work. Turning the reviewer off means generated questions skip '
    + 'semantic review entirely and arrive flagged for manual attention, which is why it asks for '
    + 'confirmation.',
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

  /** A control's label with its `helpTip` beside it, matching instructor Settings.
   *  The tip sits OUTSIDE the `<label>`: nested, clicking it would activate the
   *  label and steal focus into the control. */
  function labelRow(text: string, tip: string): HTMLElement {
    return el('div', { class: 'form-field__label-row' },
      el('span', { class: 'form-field__label', text }), helpTip(text, tip),
    );
  }

  /** One step: a model select plus whichever parameter control that model allows. */
  function stepCard(step: PipelineStep): HTMLElement {
    const params = el('div', { class: 'admin-step__params' });
    const select = el('select', { class: 'input', 'aria-label': `${STEP_LABEL[step]} model` }) as HTMLSelectElement;

    function renderParams(): void {
      const caps = settings.catalogue.profiles[profileOf(draft[step].model)];
      const children: HTMLElement[] = [];

      if (caps.reasoningEffort) {
        const effort = el('select', { class: 'input', 'aria-label': `${STEP_LABEL[step]} reasoning effort` }) as HTMLSelectElement;
        for (const value of caps.reasoningEffort) {
          const label = value === caps.defaultEffort ? `${value} — model default` : value;
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
        children.push(el('div', { class: 'form-field' }, labelRow('Reasoning effort', EFFORT_HELP), effort));
      }

      const effortNow = draft[step].reasoningEffort;
      if (temperatureAllowed(caps, effortNow)) {
        const { min, max } = caps.temperature!;
        const stepDefault = settings.catalogue.stepTemperatureDefaults[step] ?? caps.temperature!.default;
        const temp = el('input', {
          class: 'input', type: 'number', step: '0.1', min: String(min), max: String(max),
          // NOT pre-filled. A saved value spreads over the step's own default,
          // so a box showing "0" that anyone nudges would persist 0 for the
          // generator and silently kill the batch variety it runs warm for.
          placeholder: `${stepDefault} — step default`,
          'aria-label': `${STEP_LABEL[step]} temperature`,
        }) as HTMLInputElement;
        if (draft[step].temperature !== undefined) temp.value = String(draft[step].temperature);
        temp.onchange = () => {
          const raw = temp.value.trim();
          const next = { ...draft[step] };
          // Clearing the box means "back to the step default", which is the
          // only way to undo an override once one is saved.
          if (raw === '') delete next.temperature;
          else next.temperature = Number(raw);
          draft[step] = next;
        };
        children.push(el('div', { class: 'form-field' }, labelRow(`Temperature (${min}–${max})`, TEMPERATURE_HELP), temp));
      } else if (caps.temperature) {
        children.push(el('p', { class: 'muted admin-step__note',
          text: 'Temperature unavailable while reasoning — set effort to “none” to use it.' }));
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

    // Each step is its own bordered card rather than a cell in a flat grid:
    // with five steps and up to two parameter controls each, a single grid
    // gave no visual boundary between one step's controls and the next's.
    return el('section', { class: 'admin-step card' },
      el('header', { class: 'admin-step__header' },
        el('h3', { class: 'admin-step__title', text: STEP_LABEL[step] }),
        helpTip(STEP_LABEL[step], STEP_HELP[step]),
        ...(step === 'masteryEvaluator' ? [el('span', { class: 'badge badge--muted', text: 'not yet wired' })] : []),
      ),
      el('div', { class: 'form-field' }, labelRow('Model', STEP_HELP[step]), select),
      params,
    );
  }

  const stepsGrid = el('div', { class: 'admin-step-list' }, ...PIPELINE_STEPS.map(stepCard));
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
        stepsGrid.replaceChildren(...PIPELINE_STEPS.map(stepCard));
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
        sectionTitleWithHelp('Pipeline models', PANEL_HELP.pipeline),
      ),
      stepsGrid,
    ),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        sectionTitleWithHelp('Custom models', PANEL_HELP.custom),
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
        stepsGrid.replaceChildren(...PIPELINE_STEPS.map(stepCard));
      } }),
    ),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        sectionTitleWithHelp('Cost controls', PANEL_HELP.cost),
      ),
      el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Maximum generations per day' }), maxDaily),
    ),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        sectionTitleWithHelp('Feature flags', PANEL_HELP.flags),
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
