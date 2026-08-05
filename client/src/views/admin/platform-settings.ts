import { ApiError, getAdminPlatformSettings, saveAdminPlatformSettings, type PlatformSettings } from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import { confirmDialog } from '../../modal.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

async function renderInner(outlet: HTMLElement): Promise<void> {
  const body = el('div', {}, loadingState('Loading platform settings…'));
  mount(outlet, el('div', { class: 'view view--admin' }, body));
  let settings: PlatformSettings;
  try {
    settings = await getAdminPlatformSettings();
  } catch (error) {
    body.replaceChildren(errorState(error instanceof ApiError ? error.message : (error as Error).message));
    return;
  }
  const modelInputs = Object.fromEntries(Object.entries(settings.models).map(([key, value]) => [key,
    el('input', { class: 'input', value, 'aria-label': `${key} model` }) as HTMLInputElement,
  ])) as Record<keyof PlatformSettings['models'], HTMLInputElement>;
  const maxDaily = el('input', { class: 'input', type: 'number', min: '1', value: String(settings.costControls.maxGenerationsPerDay) }) as HTMLInputElement;
  const reviewer = el('input', { type: 'checkbox' }) as HTMLInputElement;
  reviewer.checked = settings.featureFlags.reviewerAgent;
  const layer2 = el('input', { type: 'checkbox' }) as HTMLInputElement;
  layer2.checked = settings.featureFlags.layer2Evaluator;
  const status = el('span', { class: 'form-status', role: 'status', 'aria-live': 'polite' });

  async function save(): Promise<void> {
    const next = {
      models: {
        generator: modelInputs.generator.value,
        validator: modelInputs.validator.value,
        reviewer: modelInputs.reviewer.value,
        masteryEvaluator: modelInputs.masteryEvaluator.value,
      },
      costControls: { maxGenerationsPerDay: Number(maxDaily.value) },
      featureFlags: { reviewerAgent: reviewer.checked, layer2Evaluator: layer2.checked },
    };
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
      settings = await saveAdminPlatformSettings(next, confirmQualityImpact);
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
        el('p', { class: 'muted', text: 'Model IDs used when new background work starts.' }),
      ),
      el('div', { class: 'admin-settings-grid' },
        ...Object.entries(modelInputs).map(([key, input]) => el('label', { class: 'form-field' },
          el('span', { class: 'form-field__label', text: key === 'masteryEvaluator' ? 'Mastery evaluator' : key }), input,
        )),
      ),
    ),
    el('section', { class: 'card stack admin-settings-panel' },
      el('div', { class: 'admin-settings-panel__heading' },
        el('h2', { text: 'Cost controls' }),
        el('p', { class: 'muted', text: 'Platform-wide guardrails for AI generation volume.' }),
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
          el('span', {}, el('strong', { text: 'Layer 2 Mastery Evaluator' }), el('small', { text: 'Model-assisted mastery evaluation.' })),
        ),
      ),
    ),
    el('div', { class: 'admin-save-bar' }, el('button', { class: 'btn btn--primary', type: 'button', text: 'Save settings', onclick: () => void save() }), status),
  );
}

export function renderAdminPlatformSettings(outlet: HTMLElement, _params: RouteParams): void {
  void renderInner(outlet);
}
