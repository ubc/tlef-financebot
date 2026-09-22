import { attachTutorial } from '../../tutorials.js';
import {
  ApiError,
  PIPELINE_STEPS,
  getAdminPlatformSettings,
  saveAdminPlatformSettings,
  temperatureAllowed,
  type CapabilityProfile,
  type ModelCapabilities,
  type ModelCatalogue,
  type PipelineStep,
  type PlatformSettings,
  type ReasoningEffort,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { confirmDialog } from '../../modal.js';
import { protectUnsavedChanges, type RouteParams } from '../../router.js';
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

/**
 * What each capability profile means, in terms an admin can act on.
 *
 * Keyed by profile id and merged with a description DERIVED from the
 * catalogue, so a profile added server-side still gets an accurate (if drier)
 * explanation rather than silently appearing with none.
 */
const PROFILE_BLURB: Record<string, string> = {
  classic:
    'takes a temperature and has no reasoning channel at all — the shape this platform sent before '
    + 'reasoning models existed, and what local Ollama models still want',
  'reasoning-tunable':
    'can reason, but does not by default — so a temperature works until you switch reasoning on, and '
    + 'switching it on takes the temperature away',
  'reasoning-fixed':
    'reasons by default, so a temperature is rejected unless you explicitly set effort to “none”',
};

/** A plain-language sentence built from a profile's measured capabilities. */
function describeProfile(caps: ModelCapabilities): string {
  const parts = [
    caps.temperature ? 'accepts a temperature' : 'accepts no temperature',
    caps.reasoningEffort
      ? `reasons (API default ${caps.defaultEffort}; the pipeline sends none unless a step sets an effort)`
      : 'does not reason',
    `sends its token limit as ${caps.tokenLimitParam}`,
  ];
  return parts.join(', ');
}

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

type SettingsDraft = Pick<PlatformSettings, 'models' | 'customModels' | 'costControls' | 'featureFlags'>;
type SettingsTab = 'pipeline' | 'quality' | 'usage' | 'custom';
const TAB_LABELS: Record<SettingsTab, string> = { pipeline: 'Model pipeline', quality: 'Quality controls', usage: 'Usage & limits', custom: 'Custom models' };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const draftOf = (settings: PlatformSettings): SettingsDraft => copy({ models: settings.models, customModels: settings.customModels ?? [], costControls: settings.costControls, featureFlags: settings.featureFlags });
const errorMessage = (error: unknown): string => error instanceof ApiError ? error.message : (error as Error).message;

async function renderInner(outlet: HTMLElement): Promise<void> {
  const root = el('div', { class: 'view view--admin admin-console admin-configuration' }, loadingState('Loading platform settings…'));
  mount(outlet, root);
  let settings: PlatformSettings & { catalogue: ModelCatalogue };
  try { settings = await getAdminPlatformSettings(); }
  catch (error) {
    if (root.isConnected) root.replaceChildren(errorState(errorMessage(error)), el('button', { class: 'btn', text: 'Retry', onclick: () => renderInner(outlet) }));
    return;
  }
  if (!root.isConnected) return;
  let saved = draftOf(settings);
  let draft = copy(saved);
  let selected: PipelineStep | undefined;
  let tab: SettingsTab = 'pipeline';
  let pending = false;
  const metrics = el('div', { class: 'ac-metrics' });
  const tabs = el('div', { class: 'ac-tabs', role: 'tablist', 'aria-label': 'Settings sections' });
  const content = el('div', { class: 'ac-config-content', id: 'admin-settings-content', role: 'tabpanel', tabindex: 0 });
  const inspectorSlot = el('div', { class: 'ac-config-inspector' });
  const status = el('span', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const changesStatus = el('span', { class: 'ac-config-save-status' });
  const validationStatus = el('div', { class: 'ac-config-errors', role: 'alert' });
  const discard = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Discard', onclick: async () => {
    if (pending || !await discardConfirmation() || !root.isConnected) return;
    draft = copy(saved); status.textContent = 'Unsaved settings discarded.'; render();
  } });
  const review = el('button', { class: 'btn btn--primary', type: 'button', text: 'Review changes', onclick: () => save() });
  const saveBar = el('footer', { class: 'ac-footer admin-save-bar' }, changesStatus, el('div', { class: 'ac-actions' }, discard, review));
  const main = el('section', { class: 'ac-main', 'aria-label': 'Platform configuration' }, tabs, content, validationStatus, saveBar, el('div', { class: 'ac-config-status' }, status));
  root.replaceChildren(el('header', { class: 'ac-header' }, el('div', {}, el('h1', { text: 'Platform Settings' }), el('p', { text: 'Configure the model pipeline, quality checks, and usage limits.' }))), metrics, el('div', { class: 'ac-workspace' }, main, inspectorSlot));
  const dirty = (): boolean => JSON.stringify(draft) !== JSON.stringify(saved);
  const discardConfirmation = (): Promise<boolean> => confirmDialog({ title: 'Discard settings changes?', message: 'Restore the last saved settings across all tabs. Unsaved model registrations and parameter changes will be removed.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing' });
  protectUnsavedChanges(root, () => dirty() || pending, async () => pending ? false : discardConfirmation());

  function modelList(): ModelCatalogue['models'] {
    // Catalogue entries include saved custom models; use the draft list so removed
    // registrations cannot linger as seemingly available choices.
    return [...settings.catalogue.models.filter(model => !model.custom), ...(draft.customModels ?? []).map(model => ({ ...model, custom: true }))];
  }
  function profileOf(modelId: string): CapabilityProfile {
    return modelList().find(model => model.id === modelId)?.profile ?? 'classic';
  }
  function changes(): Array<{ label: string; before: string; after: string }> {
    const result: Array<{ label: string; before: string; after: string }> = [];
    for (const step of PIPELINE_STEPS) for (const key of ['model', 'reasoningEffort', 'temperature'] as const) {
      if (saved.models[step][key] !== draft.models[step][key]) result.push({ label: `${STEP_LABEL[step]} · ${key === 'reasoningEffort' ? 'reasoning effort' : key}`, before: String(saved.models[step][key] ?? 'Step default'), after: String(draft.models[step][key] ?? 'Step default') });
    }
    if (saved.costControls.maxGenerationsPerDay !== draft.costControls.maxGenerationsPerDay) result.push({ label: 'Daily question limit', before: String(saved.costControls.maxGenerationsPerDay), after: String(draft.costControls.maxGenerationsPerDay) });
    for (const [key, label] of [['reviewerAgent', 'Reviewer Agent'], ['layer2Evaluator', 'Layer 2 Mastery Evaluator'], ['retryOnReject', 'Retry on Reviewer Reject']] as const) {
      if (saved.featureFlags[key] !== draft.featureFlags[key]) result.push({ label, before: saved.featureFlags[key] ? 'Enabled' : 'Disabled', after: draft.featureFlags[key] ? 'Enabled' : 'Disabled' });
    }
    for (const custom of draft.customModels ?? []) if (!saved.customModels?.some(model => model.id === custom.id && model.profile === custom.profile)) result.push({ label: `Custom model · ${custom.id}`, before: 'Not registered', after: custom.profile });
    for (const custom of saved.customModels ?? []) if (!draft.customModels?.some(model => model.id === custom.id)) result.push({ label: `Custom model · ${custom.id}`, before: custom.profile, after: 'Removed' });
    return result;
  }
  function validation(): string[] {
    const errors: string[] = [];
    if (!Number.isSafeInteger(draft.costControls.maxGenerationsPerDay) || draft.costControls.maxGenerationsPerDay < 1) errors.push('Daily question limit must be a whole number of at least 1.');
    for (const step of PIPELINE_STEPS) {
      const config = draft.models[step], caps = settings.catalogue.profiles[profileOf(config.model)];
      if (config.reasoningEffort !== undefined && !caps.reasoningEffort?.includes(config.reasoningEffort)) errors.push(`${STEP_LABEL[step]}: choose a supported reasoning effort.`);
      if (config.temperature !== undefined && (!temperatureAllowed(caps, config.reasoningEffort ?? 'none') || !Number.isFinite(config.temperature) || config.temperature < caps.temperature!.min || config.temperature > caps.temperature!.max)) errors.push(`${STEP_LABEL[step]}: temperature is not supported at this value or reasoning effort.`);
    }
    return errors;
  }
  function refreshSummary(): void {
    const limit = draft.costControls.maxGenerationsPerDay;
    metrics.replaceChildren(...[
      ['Pipeline stages', String(PIPELINE_STEPS.length), '1 reserved stage'], ['Reviewer', draft.featureFlags.reviewerAgent ? 'On' : 'Off', draft.featureFlags.reviewerAgent ? 'Semantic review' : 'Manual attention'],
      ['Daily allowance', Number.isFinite(limit) && limit > 0 ? limit.toLocaleString() : '—', 'Questions / platform'], ['Custom models', String(draft.customModels?.length ?? 0), 'Additional registrations'],
    ].map(([label, value, detail]) => el('div', { class: 'ac-metric' }, el('span', { text: label }), el('strong', { text: value }), el('small', { text: detail }))));
    const changeCount = changes().length;
    changesStatus.textContent = changeCount ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}` : 'No unsaved changes';
    review.disabled = pending || !dirty() || validation().length > 0;
    discard.disabled = pending || !dirty();
    validationStatus.textContent = validation().join(' ');
    validationStatus.hidden = !validation().length;
  }
  function render(): void {
    const focusId = root.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.id : '';
    tabs.replaceChildren(...(Object.entries(TAB_LABELS) as Array<[SettingsTab, string]>).map(([key, text]) => el('button', { class: 'btn btn--ghost', type: 'button', role: 'tab', id: `admin-tab-${key}`, 'aria-controls': 'admin-settings-content', 'aria-selected': String(tab === key), tabindex: tab === key ? 0 : -1, text, onclick: () => { tab = key; selected = undefined; render(); document.getElementById(`admin-tab-${key}`)?.focus(); } })));
    content.setAttribute('aria-labelledby', `admin-tab-${tab}`);
    content.replaceChildren(tab === 'pipeline' ? pipelineTable() : tab === 'quality' ? qualityControls() : tab === 'usage' ? usageControls() : customModels());
    refreshSummary(); renderInspector();
    if (focusId) document.getElementById(focusId)?.focus();
  }
  function intro(title: string, description: string, tip: string): HTMLElement {
    return el('header', { class: 'ac-config-intro' }, el('div', {}, el('h2', {}, title, helpTip(title, tip)), el('p', { text: description })));
  }
  function pipelineTable(): HTMLElement {
    return el('div', { class: 'admin-step-list ac-config-pane' }, intro('Pipeline models', 'Select a stage to edit its model and supported parameters.', PANEL_HELP.pipeline),
      el('div', { class: 'ac-table-scroll', tabindex: 0, 'aria-label': 'Pipeline models' }, el('table', { class: 'ac-table ac-pipeline-table' },
        el('thead', {}, el('tr', {}, ...['Stage', 'Model', 'Parameters', ''].map(text => el('th', { scope: 'col', text: text || 'Edit' })))),
        el('tbody', {}, ...PIPELINE_STEPS.map(step => {
          const config = draft.models[step], caps = settings.catalogue.profiles[profileOf(config.model)];
          const parameter = caps.reasoningEffort && (config.reasoningEffort ?? 'none') !== 'none' ? `Reasoning · ${config.reasoningEffort}` : caps.temperature ? `Temperature · ${config.temperature ?? settings.catalogue.stepTemperatureDefaults[step] ?? caps.temperature.default}${config.temperature === undefined ? ' default' : ''}` : 'Model defaults';
          return el('tr', { class: selected === step ? 'is-selected' : '' },
            el('td', {}, el('button', { class: 'ac-link', type: 'button', text: STEP_LABEL[step], onclick: () => openStage(step) }), el('small', { class: 'ac-cell-secondary', text: step === 'masteryEvaluator' ? 'Reserved · not yet wired' : step === 'reviewer' && !draft.featureFlags.reviewerAgent ? 'Disabled by quality controls' : profileOf(config.model) })),
            el('td', { class: 'mono ac-config-model-id', text: config.model }), el('td', { class: 'ac-config-parameter', text: parameter }),
            el('td', {}, el('button', { class: 'btn btn--ghost', type: 'button', text: 'Edit', 'aria-label': `Edit ${STEP_LABEL[step]}`, onclick: () => openStage(step) })),
          );
        })),
      )), el('p', { class: 'ac-note', text: 'Changes apply to new generation and evaluation work. Existing queued work keeps its saved configuration.' }));
  }
  function openStage(step: PipelineStep): void { selected = step; renderInspector(); inspectorSlot.querySelector<HTMLSelectElement>('select')?.focus(); }
  function closeInspector(): void { const previous = selected; selected = undefined; renderInspector(); if (previous) root.querySelector<HTMLButtonElement>(`[aria-label="Edit ${STEP_LABEL[previous]}"]`)?.focus(); }
  function renderInspector(): void {
    root.classList.toggle('has-inspector', !!selected);
    inspectorSlot.replaceChildren();
    if (!selected) return;
    const step = selected;
    const config = draft.models[step];
    const caps = settings.catalogue.profiles[profileOf(config.model)];
    const select = el('select', { class: 'input', id: 'admin-stage-model', 'aria-label': `${STEP_LABEL[step]} model` }, ...modelList().map(model => el('option', { value: model.id, text: `${model.id}${model.custom ? ' (custom)' : ''}` })));
    if (![...select.options].some(option => option.value === config.model)) select.prepend(el('option', { value: config.model, text: `${config.model} (not in catalogue)` }));
    select.value = config.model; select.disabled = pending;
    select.onchange = () => { draft.models[step] = { model: select.value }; status.textContent = 'Model selected. Previous parameter overrides were cleared.'; render(); };
    const params = el('div', { class: 'ac-config-fields' });
    if (caps.reasoningEffort) {
      const effort = el('select', { class: 'input', id: 'admin-stage-effort', 'aria-label': `${STEP_LABEL[step]} reasoning effort` }, ...caps.reasoningEffort.map(value => el('option', { value, text: value === 'none' ? 'none — pipeline default' : value === caps.defaultEffort ? `${value} — model API default` : value })));
      effort.value = config.reasoningEffort ?? 'none'; effort.disabled = pending;
      effort.onchange = () => { draft.models[step].reasoningEffort = effort.value as ReasoningEffort; if (!temperatureAllowed(caps, effort.value as ReasoningEffort)) delete draft.models[step].temperature; render(); };
      params.append(field('Reasoning effort', effort, EFFORT_HELP));
    }
    if (temperatureAllowed(caps, config.reasoningEffort ?? 'none')) {
      const defaultTemperature = settings.catalogue.stepTemperatureDefaults[step] ?? caps.temperature!.default;
      const temperature = el('input', { class: 'input', id: 'admin-stage-temperature', type: 'number', step: '0.1', min: caps.temperature!.min, max: caps.temperature!.max, placeholder: `${defaultTemperature} — step default`, 'aria-label': `${STEP_LABEL[step]} temperature` });
      temperature.value = config.temperature === undefined ? '' : String(config.temperature); temperature.disabled = pending;
      temperature.oninput = () => { if (!temperature.value.trim()) delete draft.models[step].temperature; else { draft.models[step].temperature = temperature.valueAsNumber; if (caps.reasoningEffort && draft.models[step].reasoningEffort === undefined) draft.models[step].reasoningEffort = 'none'; } refreshSummary(); };
      params.append(field(`Temperature (${caps.temperature!.min}–${caps.temperature!.max})`, temperature, TEMPERATURE_HELP));
    } else if (caps.temperature) params.append(el('p', { class: 'ac-note', text: 'Temperature is unavailable while reasoning. Set effort to “none” to use it.' }));
    inspectorSlot.append(el('aside', { class: 'ac-panel', 'aria-label': `${STEP_LABEL[step]} configuration` },
      el('header', { class: 'ac-panel-header' }, el('div', {}, el('small', { text: 'Model pipeline' }), el('h2', { text: STEP_LABEL[step] })), el('button', { class: 'btn btn--ghost', type: 'button', text: 'Close', onclick: closeInspector })),
      el('div', { class: 'ac-panel-body' }, el('p', { class: 'ac-note', text: STEP_HELP[step] }), field('Model', select, STEP_HELP[step]), el('div', { class: 'ac-config-profile' }, el('strong', { text: profileOf(config.model) }), el('p', { text: PROFILE_BLURB[profileOf(config.model)] ?? describeProfile(caps) })), params),
      el('footer', { class: 'ac-panel-footer' }, el('span', { text: 'Changes remain a draft until saved.' }), el('button', { class: 'btn btn--secondary', type: 'button', text: 'Done', onclick: () => { render(); closeInspector(); } })),
    ));
  }
  function field(label: string, control: HTMLElement, tip?: string): HTMLElement {
    return el('div', { class: 'form-field' }, el('div', { class: 'form-field__label-row' }, el('span', { class: 'form-field__label', text: label }), tip ? helpTip(label, tip) : undefined), control);
  }
  function qualityControls(): HTMLElement {
    return el('div', { class: 'ac-config-pane' }, intro('Quality controls', 'Manage review stages applied to new work.', PANEL_HELP.flags),
      el('div', { class: 'ac-config-setting-list' }, ...([
        ['reviewerAgent', 'Reviewer Agent', 'Semantic quality review for generated questions.'],
        ['layer2Evaluator', 'Layer 2 Mastery Evaluator', 'Not yet wired: this flag is saved, but no code reads it.'],
        ['retryOnReject', 'Retry on Reviewer Reject', 'Regenerates once with the reviewer’s critique after rejection. Costs one extra generation per rejected question.'],
      ] as const).map(([key, label, description]) => {
        const toggle = el('input', { type: 'checkbox', 'aria-label': label }); toggle.checked = draft.featureFlags[key]; toggle.disabled = pending;
        toggle.onchange = () => { draft.featureFlags[key] = toggle.checked; render(); };
        return el('label', { class: 'ac-config-setting' }, el('span', {}, el('strong', { text: label }), el('small', { text: description })), toggle);
      })),
      !draft.featureFlags.reviewerAgent ? el('p', { class: 'ac-note ac-config-warning', text: 'Reviewer disabled: generated questions skip semantic review and are flagged for manual attention. Saving this change requires confirmation.' }) : undefined,
    );
  }
  function usageControls(): HTMLElement {
    const limit = el('input', { class: 'input', type: 'number', id: 'admin-daily-limit', min: 1, step: 1, 'aria-label': 'Maximum generations per day', value: String(draft.costControls.maxGenerationsPerDay) });
    limit.disabled = pending; limit.oninput = () => { draft.costControls.maxGenerationsPerDay = limit.valueAsNumber; refreshSummary(); };
    return el('div', { class: 'ac-config-pane' }, intro('Usage & limits', 'Limit the daily volume of generated questions.', PANEL_HELP.cost),
      el('div', { class: 'ac-config-setting-list' }, el('label', { class: 'ac-config-setting' }, el('span', {}, el('strong', { text: 'Daily question allowance' }), el('small', { text: 'Shared across every course. Counts questions, not tokens or currency.' })), limit)),
      el('p', { class: 'ac-note', text: 'A higher reasoning effort can increase cost per question without changing this allowance. This page configures the limit; it does not report live usage.' }),
    );
  }
  function customModels(): HTMLElement {
    const list = draft.customModels ?? [];
    return el('div', { class: 'ac-config-pane' }, el('div', { class: 'ac-config-intro ac-config-intro--actions' }, el('div', {}, el('h2', {}, 'Custom models', helpTip('Custom models', PANEL_HELP.custom)), el('p', { text: 'Register a provider model using a supported capability profile.' })), el('button', { class: 'btn btn--secondary', type: 'button', text: 'Add model', disabled: pending, onclick: addModel })),
      list.length ? el('div', { class: 'ac-table-scroll', tabindex: 0, 'aria-label': 'Custom models' }, el('table', { class: 'ac-table' }, el('thead', {}, el('tr', {}, ...['Model', 'Profile', 'Usage', 'Action'].map(text => el('th', { scope: 'col', text })))), el('tbody', {}, ...list.map(custom => {
        const used = PIPELINE_STEPS.filter(step => draft.models[step].model === custom.id);
        return el('tr', {}, el('td', { class: 'mono ac-config-model-id', text: custom.id }), el('td', { text: custom.profile }), el('td', { text: used.length ? used.map(step => STEP_LABEL[step]).join(', ') : 'Not in use' }), el('td', {}, el('button', { class: 'btn btn--ghost', type: 'button', text: 'Remove', disabled: pending || !!used.length, title: used.length ? 'Choose another model for the listed stages before removing this registration.' : 'Remove from draft catalogue', onclick: async () => {
          if (!await confirmDialog({ title: 'Remove custom model?', message: `Remove ${custom.id} from the draft catalogue?`, confirmLabel: 'Remove from draft' }) || !root.isConnected) return;
          draft.customModels = list.filter(model => model.id !== custom.id); render();
        } })));
      })))) : el('div', { class: 'ac-config-empty' }, el('h3', { text: 'No custom models' }), el('p', { text: 'The shipped catalogue is in use. Add a model when you need another supported provider model.' })),
    );
  }
  function addModel(): void {
    const dialog = el('dialog', { class: 'app-dialog ac-config-dialog', 'aria-labelledby': 'admin-model-dialog-title' });
    const id = el('input', { class: 'input', required: true, maxlength: 200, 'aria-label': 'Custom model id', placeholder: 'Provider model ID' });
    const profile = el('select', { class: 'input', 'aria-label': 'Custom model capability profile' }, ...Object.keys(settings.catalogue.profiles).map(value => el('option', { value, text: value })));
    const description = el('p', { class: 'ac-note' });
    const updateDescription = (): void => { const selectedProfile = profile.value as CapabilityProfile; description.textContent = PROFILE_BLURB[selectedProfile] ?? describeProfile(settings.catalogue.profiles[selectedProfile]); };
    profile.onchange = updateDescription; updateDescription();
    const error = el('p', { class: 'ac-config-errors', role: 'alert' });
    const close = (): void => { dialog.close(); dialog.remove(); };
    const form = el('form', { class: 'app-dialog__surface', onsubmit: (event: Event) => {
      event.preventDefault(); const value = id.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value)) { error.textContent = 'Use letters, numbers, dot, slash, colon, underscore or hyphen in the model ID.'; id.focus(); return; }
      if (modelList().some(model => model.id.toLowerCase() === value.toLowerCase())) { error.textContent = 'This model is already registered. Choose another provider ID.'; id.focus(); return; }
      draft.customModels = [...draft.customModels ?? [], { id: value, profile: profile.value as CapabilityProfile }]; close(); render(); status.textContent = 'Model added to the draft catalogue. Review and save to apply it.';
    } }, el('h2', { class: 'app-dialog__title', id: 'admin-model-dialog-title', text: 'Register a custom model' }), field('Model ID', id), field('Capability profile', profile), description, el('p', { class: 'ac-note', text: 'Use the exact provider ID. Saving registers the model; it does not call the provider to verify availability.' }), error, el('div', { class: 'app-dialog__actions' }, el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: close }), el('button', { class: 'btn btn--primary', type: 'submit', text: 'Add to draft' })));
    dialog.append(form); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); document.body.append(dialog); dialog.showModal(); id.focus();
  }
  async function save(): Promise<void> {
    if (pending || !dirty() || validation().length) return;
    const reviewed = await confirmDialog({ title: `Review ${changes().length} settings changes`, message: `${changes().map(change => `${change.label}: ${change.before} → ${change.after}`).join('\n')}\n\nChanges apply to new generation and evaluation work.`, confirmLabel: 'Save settings', cancelLabel: 'Keep editing' });
    if (!reviewed || !root.isConnected) return;
    let confirmQualityImpact = false;
    if (saved.featureFlags.reviewerAgent && !draft.featureFlags.reviewerAgent) {
      confirmQualityImpact = await confirmDialog({ title: 'Disable Reviewer Agent?', message: 'Generated questions will skip semantic quality review and be saved as flagged with a disabled-reviewer reason. Instructors must review them manually.', confirmLabel: 'Disable reviewer', tone: 'danger' });
      if (!confirmQualityImpact || !root.isConnected) return;
    }
    const payload = copy(draft); pending = true; status.textContent = 'Saving settings…'; render();
    try {
      const response = await saveAdminPlatformSettings(payload, confirmQualityImpact);
      if (!root.isConnected) return;
      settings = { ...response, catalogue: settings.catalogue }; saved = draftOf(response); draft = copy(saved);
      status.textContent = 'Settings saved. Applied to new generation and evaluation work.';
    } catch (error) { if (root.isConnected) status.textContent = errorMessage(error); }
    finally { pending = false; if (root.isConnected) render(); }
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const keys = Object.keys(TAB_LABELS) as SettingsTab[];
    let index = keys.indexOf(tab);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    event.preventDefault(); tab = keys[index]; selected = undefined; render(); document.getElementById(`admin-tab-${tab}`)?.focus();
  });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && selected) closeInspector(); });
  render();
  attachTutorial(root, 'admin-platform-settings', { 'admin-platform-models': '.admin-step-list', 'admin-platform-quality': '.admin-save-bar' });
}
export function renderAdminPlatformSettings(outlet: HTMLElement, _params: RouteParams): void { void renderInner(outlet); }
