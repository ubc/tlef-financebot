/* global window, document, FormData */
(() => {
  'use strict';
  const U = window.AdminUI;
  const { h, button, badge, icon } = U;
  const copy = value => JSON.parse(JSON.stringify(value));
  const steps = [
    { id: 'generator', title: 'Generator', summary: 'Creates question drafts', description: 'Drafts questions from retrieved course material. Leave temperature blank to use the step default and preserve batch variety.', temperature: 0.7 },
    { id: 'validator', title: 'Structure validator', summary: 'Checks answers and distractors', description: 'Verifies question structure, correct-answer roles, and distractor error models.', temperature: 0 },
    { id: 'reviewer', title: 'Reviewer', summary: 'Evaluates teaching quality', description: 'Reviews pedagogical quality and returns pass, flag, or reject. Higher reasoning effort can cost more and take longer.', temperature: 0 },
    { id: 'masteryEvaluator', title: 'Mastery evaluator', summary: 'Reserved configuration', description: 'This model setting is saved, but no mastery-evaluator model call currently uses it. Changing it has no runtime effect.', temperature: 0, dormant: true },
    { id: 'utility', title: 'Utility', summary: 'Classifies and organizes sources', description: 'Handles material classification, learning-objective suggestions, and short-answer conversion.', temperature: 0 },
  ];
  const profiles = {
    classic: { title: 'Classic', description: 'Temperature only. No reasoning channel.', reason: false, default: 'none', token: 'maxTokens' },
    'reasoning-tunable': { title: 'Reasoning · optional', description: 'Reasoning is optional. Temperature works at effort “none”.', reason: true, default: 'none', token: 'max_completion_tokens' },
    'reasoning-fixed': { title: 'Reasoning · default', description: 'The provider defaults to reasoning; this pipeline explicitly sends “none” unless you set an effort.', reason: true, default: 'medium', token: 'max_completion_tokens' },
  };
  const shipped = [{ id: 'gpt-5.4-nano', profile: 'reasoning-tunable' }, { id: 'gpt-5.6-luna', profile: 'reasoning-fixed' }];
  const initial = {
    models: { generator: { model: 'gpt-5.4-nano' }, validator: { model: 'gpt-5.4-nano' }, reviewer: { model: 'gpt-5.6-luna', reasoningEffort: 'medium' }, masteryEvaluator: { model: 'gpt-5.6-luna' }, utility: { model: 'gpt-5.4-nano' } },
    customModels: [], costControls: { maxGenerationsPerDay: 1000 }, featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true },
  };
  let saved = U.read('settings-saved', initial);
  let draft = U.read('settings-draft', copy(saved));
  const S = { tab: 'pipeline', selected: '', error: '', customError: '' };
  const labels = { pipeline: 'Model pipeline', quality: 'Quality controls', usage: 'Usage & limits', custom: 'Custom models' };
  function models() { return [...shipped, ...draft.customModels]; }
  function profile(config) { return models().find(model => model.id === config.model)?.profile || 'classic'; }
  function dirty() { return JSON.stringify(draft) !== JSON.stringify(saved); }
  function persist() { U.save('settings-draft', draft); }
  function validation() {
    const errors = [];
    const limit = Number(draft.costControls.maxGenerationsPerDay);
    if (!Number.isSafeInteger(limit) || limit < 1) errors.push('Daily generation limit must be a whole number of at least 1.');
    for (const step of steps) {
      const config = draft.models[step.id], caps = profiles[profile(config)];
      if (!models().some(m => m.id === config.model)) errors.push(`${step.title}: choose an available model.`);
      if (config.temperature !== undefined && (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2)) errors.push(`${step.title}: temperature must be between 0 and 2.`);
      if (config.temperature !== undefined && caps.reason && config.reasoningEffort && config.reasoningEffort !== 'none') errors.push(`${step.title}: temperature cannot be set while reasoning.`);
    }
    return errors;
  }
  function changes() {
    const result = [];
    for (const step of steps) {
      const a = saved.models[step.id], b = draft.models[step.id];
      for (const key of ['model', 'reasoningEffort', 'temperature']) if (a[key] !== b[key]) result.push({ title: `${step.title} · ${key === 'reasoningEffort' ? 'reasoning effort' : key}`, before: a[key] ?? 'Step default', after: b[key] ?? 'Step default' });
    }
    if (saved.costControls.maxGenerationsPerDay !== draft.costControls.maxGenerationsPerDay) result.push({ title: 'Daily generation limit', before: saved.costControls.maxGenerationsPerDay, after: draft.costControls.maxGenerationsPerDay });
    for (const [key, name] of [['reviewerAgent', 'Reviewer Agent'], ['layer2Evaluator', 'Layer 2 Mastery Evaluator'], ['retryOnReject', 'Retry on Reviewer Reject']]) if (saved.featureFlags[key] !== draft.featureFlags[key]) result.push({ title: name, before: saved.featureFlags[key] ? 'Enabled' : 'Disabled', after: draft.featureFlags[key] ? 'Enabled' : 'Disabled' });
    for (const model of draft.customModels) if (!saved.customModels.some(m => m.id === model.id)) result.push({ title: `Custom model · ${model.id}`, before: 'Not registered', after: profiles[model.profile].title });
    for (const model of saved.customModels) if (!draft.customModels.some(m => m.id === model.id)) result.push({ title: `Custom model · ${model.id}`, before: profiles[model.profile].title, after: 'Removed' });
    return result;
  }
  function modelParameters(step) {
    const config = draft.models[step.id], caps = profiles[profile(config)];
    return caps.reason && (config.reasoningEffort || 'none') !== 'none' ? `${config.reasoningEffort} reasoning` : `Temperature ${config.temperature ?? step.temperature}${config.temperature === undefined ? ' · default' : ''}`;
  }
  function pipeline() {
    return `<div class="config-tab-intro"><div><h2>Pipeline configuration</h2><p>Choose a model per stage. Open a stage to edit its parameters.</p></div>${badge((draft.featureFlags.reviewerAgent ? '4' : '3') + ' active stages', 'neutral')}</div><div class="table-scroll" tabindex="0" aria-label="Pipeline models"><table class="ws-table pipeline-table"><thead><tr><th>Stage</th><th>Model</th><th class="hide-sm">Parameters</th><th>Status</th><th><span class="sr-only">Edit stage</span></th></tr></thead><tbody>${steps.map(step => `<tr><td><button class="cell-primary" data-action="settings-stage" data-id="${step.id}">${step.title}</button><span class="cell-sub hide-xs">${step.summary}</span></td><td><span class="mono">${h(draft.models[step.id].model)}</span><span class="cell-sub hide-sm">${profiles[profile(draft.models[step.id])].title}</span></td><td class="hide-sm">${h(modelParameters(step))}</td><td>${step.dormant ? badge('Not wired') : step.id === 'reviewer' && !draft.featureFlags.reviewerAgent ? badge('Disabled', 'warn') : badge('Active', 'success')}</td><td>${button('Edit ' + step.title, 'settings-stage', { id: step.id, icon: 'edit', className: 'icon-button icon-only quiet' })}</td></tr>`).join('')}</tbody></table><div class="config-context"><span>${icon('clock')}</span><p><strong>Changes apply to new work.</strong> Queued jobs keep the model configuration captured when they were created. This prototype saves locally and sends no model requests.</p></div></div>`;
  }
  function quality() {
    return `<div class="config-tab-intro"><div><h2>Quality controls</h2><p>Set the review behavior for new generations.</p></div>${badge(draft.featureFlags.reviewerAgent ? 'Review enabled' : 'Manual review needed', draft.featureFlags.reviewerAgent ? 'success' : 'warn')}</div><div class="ws-scroll"><div class="settings-section config-settings-section">${[
      ['reviewerAgent', 'Reviewer Agent', 'Semantic quality checks before questions reach instructor review.', false],
      ['retryOnReject', 'Retry on Reviewer Reject', 'Generate once more with the reviewer’s critique. Each retry adds generation cost.', false],
      ['layer2Evaluator', 'Layer 2 Mastery Evaluator', 'Stored for future use. This flag currently has no effect on mastery evaluation.', true],
    ].map(([key, title, description, dormant]) => `<div class="settings-row"><div><strong>${title} ${dormant ? badge('Not wired') : ''}</strong><p>${description}</p>${key === 'retryOnReject' && !draft.featureFlags.reviewerAgent ? '<small>Saved preference; inactive while Reviewer Agent is disabled.</small>' : ''}</div><label class="config-switch"><input type="checkbox" data-setting-flag="${key}" aria-label="${title}" ${draft.featureFlags[key] ? 'checked' : ''}><span class="config-switch-track" aria-hidden="true"></span><span>${draft.featureFlags[key] ? 'On' : 'Off'}</span></label></div>`).join('')}</div>${!draft.featureFlags.reviewerAgent ? '<div class="issue-callout warn config-warning"><strong>Questions will skip semantic review</strong><p>New questions will be flagged with a disabled-reviewer reason and require manual instructor review. You must acknowledge this before saving.</p></div>' : '<div class="config-context"><span>' + icon('shield') + '</span><p><strong>Instructor approval still matters.</strong> AI review supports the teaching team; it does not release Draft questions to students.</p></div>'}</div>`;
  }
  function usage() {
    const cap = Number(draft.costControls.maxGenerationsPerDay), percent = Number.isFinite(cap) && cap > 0 ? Math.min(100, 312 / cap * 100) : 0;
    return `<div class="config-tab-intro"><div><h2>Usage & limits</h2><p>Control the platform-wide daily generation allowance.</p></div>${badge('Sample usage')}</div><div class="ws-scroll"><div class="settings-section config-settings-section"><div class="settings-row"><div><strong>Daily generation limit</strong><p>Maximum generated questions across every course per day.</p></div><label class="control-field config-limit"><span class="sr-only">Daily generation limit</span><input type="number" min="1" step="1" id="settings-limit" value="${h(draft.costControls.maxGenerationsPerDay)}" aria-label="Daily generation limit" ${!Number.isSafeInteger(cap) || cap < 1 ? 'aria-invalid="true" aria-describedby="settings-limit-error"' : ''}><small>questions / day</small></label></div>${!Number.isSafeInteger(cap) || cap < 1 ? '<p class="config-error" id="settings-limit-error">Enter a whole number of at least 1.</p>' : ''}<div class="config-usage"><div><strong>312 <span>questions generated</span></strong><span>${Number.isFinite(cap) && cap > 0 ? Math.max(0, cap - 312).toLocaleString() + ' remaining' : 'Set a valid limit'}</span></div><div class="config-meter" role="meter" aria-label="Sample daily question allowance used" aria-valuemin="0" aria-valuemax="${Number.isFinite(cap) && cap > 0 ? cap : 1}" aria-valuenow="${Number.isFinite(cap) && cap > 0 ? Math.min(312, cap) : 0}"><i style="width:${percent}%"></i></div><small>Illustrative usage for 20 Sep · not connected to live consumption</small></div></div>${Number.isFinite(cap) && cap > 0 && cap < 312 ? '<div class="issue-callout warn config-warning"><strong>Limit is below the sample usage</strong><p>With this example usage, further generation would be blocked for the rest of the day. Existing questions would remain available.</p></div>' : ''}<div class="config-context"><span>${icon('help')}</span><p><strong>This is a question allowance, not a spending cap.</strong> Model choice, reasoning effort, and retries can change cost per question. This setting does not cap tokens or currency.</p></div></div>`;
  }
  function custom() {
    return `<div class="config-tab-intro"><div><h2>Custom models</h2><p>Register a provider model using a supported capability profile.</p></div>${button('Add model', 'settings-add-model', { icon: 'plus', className: 'primary' })}</div><div class="table-scroll" tabindex="0" aria-label="Custom model catalogue">${draft.customModels.length ? `<table class="ws-table"><thead><tr><th>Model ID</th><th>Profile</th><th class="hide-sm">Used by</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${draft.customModels.map(model => { const usage = steps.filter(step => draft.models[step.id].model === model.id); return `<tr><td><strong class="mono">${h(model.id)}</strong><span class="cell-sub">Custom registration</span></td><td>${profiles[model.profile].title}</td><td class="hide-sm">${usage.map(step => step.title).join(', ') || 'Not in use'}</td><td>${button('Remove ' + model.id, 'settings-remove-model', { id: model.id, icon: 'close', className: 'icon-button icon-only quiet', disabled: usage.length > 0 })}</td></tr>`; }).join('')}</tbody></table>` : U.empty('Use a model outside the catalogue', 'Add its provider ID and a profile that matches its supported parameters.', button('Add your first model', 'settings-add-model', { icon: 'plus' }))}<div class="config-context"><span>${icon('help')}</span><p><strong>A profile describes API behavior.</strong> Registering a model does not verify provider access. A model used by a stage must be replaced there before you can remove it.</p></div></div>`;
  }
  function stagePanel() {
    if (!S.selected) return '';
    const step = steps.find(entry => entry.id === S.selected), config = draft.models[step.id], caps = profiles[profile(config)], effort = config.reasoningEffort || 'none';
    return U.panel({ title: step.title, eyebrow: 'Pipeline stage', body: `${step.dormant ? '<div class="inline-notice">Not yet wired · saved for future use</div>' : ''}<p class="config-intro">${step.description}</p><label class="control-field">Model<select id="settings-stage-model" aria-label="${step.title} model">${models().map(model => `<option value="${h(model.id)}" ${model.id === config.model ? 'selected' : ''}>${h(model.id)}${model.custom ? ' · custom' : draft.customModels.some(m => m.id === model.id) ? ' · custom' : ''}</option>`).join('')}</select></label><div class="config-profile"><strong>${caps.title}</strong><p>${caps.description}</p></div>${caps.reason ? `<label class="control-field">Reasoning effort<select id="settings-stage-effort" aria-label="${step.title} reasoning effort">${['none', 'low', 'medium', 'high', 'xhigh'].map(value => `<option value="${value}" ${effort === value ? 'selected' : ''}>${value === 'none' ? 'None · pipeline default' : value === 'xhigh' ? 'Extra high' : value[0].toUpperCase() + value.slice(1)}</option>`).join('')}</select><small>Higher effort may increase tokens and latency.</small></label>` : ''}${!caps.reason || effort === 'none' ? `<label class="control-field">Temperature <span class="muted">0–2</span><input id="settings-stage-temperature" type="number" min="0" max="2" step="0.1" value="${config.temperature === undefined ? '' : h(config.temperature)}" placeholder="${step.temperature} · step default" aria-label="${step.title} temperature"><small>Leave blank to use the ${step.temperature} step default.</small></label>` : '<div class="inline-notice">Temperature is unavailable while reasoning. Set effort to “none” to use temperature.</div>'}<div class="section-label">Effective request</div><pre class="code-block">${h(JSON.stringify({ model: config.model, ...(caps.reason ? { reasoning_effort: effort } : {}), ...(!caps.reason || effort === 'none' ? { temperature: config.temperature ?? step.temperature } : {}) }, null, 2))}</pre><p class="detail-note">Switching models clears the previous model’s parameter overrides. Changes remain a draft until you review and apply them.</p>${validation().filter(error => error.startsWith(step.title + ':')).map(error => `<p class="config-error">${h(error)}</p>`).join('')}`, footer: button('Done', 'settings-close-panel', { className: 'primary' }) });
  }
  function showReview() {
    const errors = validation();
    if (errors.length) { S.error = errors.join(' '); U.render(); return; }
    const list = changes();
    if (!list.length) return;
    const disabling = saved.featureFlags.reviewerAgent && !draft.featureFlags.reviewerAgent;
    U.modal('Review platform changes', `<p>Apply ${list.length} ${list.length === 1 ? 'change' : 'changes'} to this local prototype. Queued work in the product would keep its original configuration.</p><div class="config-review-list">${list.map(change => `<div><strong>${h(change.title)}</strong><span>${h(change.before)} ${icon('arrow')} <b>${h(change.after)}</b></span></div>`).join('')}</div>${disabling ? '<div class="issue-callout warn"><strong>Semantic review will be skipped</strong><p>Generated questions will be flagged for manual instructor attention. Review the impact before applying.</p></div><label class="switch-label"><input id="settings-review-ack" type="checkbox"> I understand that new questions will need manual review.</label>' : ''}`, button('Keep editing', 'ui-close-modal') + button('Apply locally', 'settings-confirm-save', { className: 'primary', disabled: disabling }));
  }
  function addModel() {
    S.customError = '';
    U.modal('Register a custom model', `<form id="settings-custom-form"><label class="control-field">Provider model ID<input name="modelId" required maxlength="80" placeholder="e.g. finance-local" aria-label="Provider model ID" autocomplete="off"><small>Use the exact provider ID. Letters, numbers, dot, slash, colon, underscore and hyphen are supported.</small></label><label class="control-field">Capability profile<select name="profile" aria-label="Custom model capability profile">${Object.entries(profiles).map(([key, value]) => `<option value="${key}">${value.title}</option>`).join('')}</select></label><div class="config-profile" id="settings-profile-help"><strong>Classic</strong><p>Temperature only. No reasoning channel.</p></div><p class="detail-note">The prototype does not contact the provider or verify this model. Registering a model adds it to the draft catalogue.</p><p class="config-error" id="settings-model-error" role="alert"></p></form>`, button('Cancel', 'ui-close-modal') + '<button type="submit" form="settings-custom-form" class="primary">Add to draft</button>');
  }
  window.AdminPages.settings = {
    title: 'Platform Settings', subtitle: 'Configure the model pipeline, quality checks, and usage limits.',
    hasUnsavedChanges: dirty,
    render() {
      const list = changes(), errors = validation();
      return `${U.heading('Platform Settings', 'Configure the model pipeline, quality checks, and usage limits.', button('Export settings', 'settings-export', { icon: 'download', className: 'quiet hide-xs' }))}${U.metrics([{ label: 'Pipeline stages', value: '5', note: draft.featureFlags.reviewerAgent ? '4 active · 1 reserved' : '3 active · 1 disabled · 1 reserved' }, { label: 'Reviewer', value: draft.featureFlags.reviewerAgent ? 'On' : 'Off', note: draft.featureFlags.reviewerAgent ? 'Semantic review' : 'Manual attention', tone: draft.featureFlags.reviewerAgent ? 'success' : 'warn' }, { label: 'Daily allowance', value: Number(draft.costControls.maxGenerationsPerDay) > 0 ? Number(draft.costControls.maxGenerationsPerDay).toLocaleString() : '—', note: 'Questions / platform' }, { label: 'Custom models', value: draft.customModels.length, note: 'Additional registrations' }])}<section class="activity-panel"><div class="main-tabs"><div class="source-tabs" role="tablist" aria-label="Settings sections">${Object.entries(labels).map(([key, label]) => `<button type="button" role="tab" id="settings-tab-${key}" aria-controls="settings-tab-content" aria-selected="${S.tab === key}" tabindex="${S.tab === key ? '0' : '-1'}" class="${S.tab === key ? 'active' : ''}" data-action="settings-tab" data-id="${key}">${label}</button>`).join('')}</div></div><div class="config-tab-content" id="settings-tab-content" role="tabpanel" aria-labelledby="settings-tab-${S.tab}" tabindex="0">${S.tab === 'pipeline' ? pipeline() : S.tab === 'quality' ? quality() : S.tab === 'usage' ? usage() : custom()}</div>${errors.length ? `<div class="config-error config-error-bar" role="alert">${errors.map(h).join(' ')}</div>` : ''}<div class="save-bar"><span class="config-save-status"><b>${list.length ? `${list.length} unsaved ${list.length === 1 ? 'change' : 'changes'}` : 'No unsaved changes'}</b><small>${list.length ? 'Draft retained locally across tabs' : 'Prototype configuration only'}</small></span><div class="actions">${button('Discard', 'settings-discard', { disabled: !dirty() })}${button('Review changes', 'settings-review', { className: 'primary', disabled: !dirty() || errors.length > 0 })}</div></div></section>${stagePanel()}`;
    },
    action(name, id) {
      if (name === 'settings-tab') { S.tab = id; S.selected = ''; U.render({ preserveFocus: true }); }
      else if (name === 'settings-stage') { S.selected = id; U.render(); }
      else if (name === 'settings-close-panel' || name === 'close-panel') { S.selected = ''; U.render(); }
      else if (name === 'settings-review') showReview();
      else if (name === 'settings-confirm-save') {
        if (validation().length || saved.featureFlags.reviewerAgent && !draft.featureFlags.reviewerAgent && !document.getElementById('settings-review-ack')?.checked) return;
        draft.costControls.maxGenerationsPerDay = Number(draft.costControls.maxGenerationsPerDay);
        saved = copy(draft); U.save('settings-saved', saved); persist(); S.error = ''; U.closeModal(); U.render(); U.toast('Platform settings saved locally. Live configuration is unchanged.');
      } else if (name === 'settings-discard') U.modal('Discard settings changes?', '<p>Restore the last locally saved settings across all tabs. Unsaved model registrations and parameter edits will be removed.</p>', button('Keep editing', 'ui-close-modal') + button('Discard changes', 'settings-confirm-discard', { className: 'primary' }));
      else if (name === 'settings-confirm-discard') { draft = copy(saved); persist(); S.error = ''; U.closeModal(); U.render(); U.toast('Unsaved platform changes discarded.'); }
      else if (name === 'settings-add-model') addModel();
      else if (name === 'settings-remove-model') { if (steps.some(step => draft.models[step.id].model === id)) return; U.modal('Remove custom model?', `<p>Remove <strong>${h(id)}</strong> from the draft catalogue. This model is not used by a pipeline stage.</p>`, button('Cancel', 'ui-close-modal') + button('Remove from draft', 'settings-confirm-remove', { id, className: 'primary' })); }
      else if (name === 'settings-confirm-remove') { draft.customModels = draft.customModels.filter(model => model.id !== id); persist(); U.closeModal(); U.render(); U.toast('Model removed from the draft catalogue.'); }
      else if (name === 'settings-export') U.download('financebot-platform-settings-draft.json', JSON.stringify({ prototype: true, includesUnsavedDraft: dirty(), settings: draft }, null, 2), 'application/json');
    },
    change(el) {
      if (el.id === 'settings-review-ack') { const apply = document.querySelector('[data-action="settings-confirm-save"]'); if (apply) apply.disabled = !el.checked; return; }
      if (el.form?.id === 'settings-custom-form' && el.name === 'profile') { const target = document.getElementById('settings-profile-help'); if (target) target.innerHTML = `<strong>${h(profiles[el.value].title)}</strong><p>${h(profiles[el.value].description)}</p>`; return; }
      if (el.dataset.settingFlag) draft.featureFlags[el.dataset.settingFlag] = el.checked;
      else if (el.id === 'settings-limit') draft.costControls.maxGenerationsPerDay = el.value === '' ? '' : Number(el.value);
      else if (el.id === 'settings-stage-model') { draft.models[S.selected] = { model: el.value }; U.toast('Model selected. Previous parameter overrides were cleared.'); }
      else if (el.id === 'settings-stage-effort') { draft.models[S.selected].reasoningEffort = el.value; if (el.value !== 'none' && draft.models[S.selected].temperature !== undefined) { delete draft.models[S.selected].temperature; U.toast('Temperature override cleared while reasoning is enabled.'); } }
      else if (el.id === 'settings-stage-temperature') { if (el.value === '') delete draft.models[S.selected].temperature; else draft.models[S.selected].temperature = Number(el.value); }
      else return;
      persist(); U.render({ preserveFocus: true });
    },
    input(el) { if (el.form?.id === 'settings-custom-form' && el.name === 'modelId') { el.setCustomValidity(''); const error = document.getElementById('settings-model-error'); if (error) error.textContent = ''; } },
    submit(form) {
      if (form.id !== 'settings-custom-form') return;
      const data = new FormData(form), id = String(data.get('modelId') || '').trim(), capabilityProfile = String(data.get('profile') || 'classic');
      const input = form.elements.namedItem('modelId'), error = document.getElementById('settings-model-error');
      if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(id)) { const message = 'Enter a model ID using letters, numbers, dot, slash, colon, underscore or hyphen.'; if (error) error.textContent = message; input.setCustomValidity(message); input.reportValidity(); return; }
      if (!id || models().some(model => model.id.toLowerCase() === id.toLowerCase())) { const message = id ? 'This model is already in the catalogue. Choose a different provider ID.' : 'Enter a provider model ID.'; if (error) error.textContent = message; input.setCustomValidity(message); input.reportValidity(); return; }
      if (!profiles[capabilityProfile]) return;
      draft.customModels.push({ id, profile: capabilityProfile }); persist(); U.closeModal(); U.render(); U.toast('Custom model added to the draft catalogue.');
    },
  };
})();
