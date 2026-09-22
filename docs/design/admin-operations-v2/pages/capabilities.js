/* global window */
(() => {
  'use strict';
  const U = window.AdminUI;
  const { h, button, badge, icon } = U;
  const copy = value => JSON.parse(JSON.stringify(value));
  const definitions = [
    ['question.review', 'Review questions', 'Questions', 'Read question content and review metadata for the course.'],
    ['question.suggest-edit', 'Suggest edits', 'Questions', 'Propose an edit for instructor review without replacing an approved version.'],
    ['question.mark-reviewed', 'Mark reviewed', 'Questions', 'Record that a teaching-team member has reviewed a question. This does not approve it.'],
    ['question.create-draft', 'Create drafts', 'Questions', 'Create question drafts within a course. Drafts are not available for student practice.'],
    ['question.approve', 'Approve questions', 'Questions', 'Approve questions for the released student experience. Teaching assistants can never receive this permission.'],
    ['flag.triage', 'Triage flags', 'Flags', 'Read and investigate student-reported issues, add context, and escalate to an instructor.'],
    ['flag.resolve', 'Resolve flags', 'Flags', 'Close a reported issue after an instructor or admin review. Teaching assistants can never receive this permission.'],
    ['analytics.view', 'View course analytics', 'Analytics', 'Read aggregate course analytics. Small-sample privacy thresholds still apply.'],
    ['analytics.individual', 'View individual analytics', 'Analytics', 'Read named student profiles, histories, and follow-up lists.'],
    ['exam.configure', 'Configure exam prep', 'Course tools', 'Create and edit the course’s Exam Prep templates.'],
    ['course.manage-tas', 'Manage teaching assistants', 'Course tools', 'Invite teaching assistants and configure their course-specific access.'],
    ['materials.upload', 'Upload materials', 'Course tools', 'Upload teaching sources for the course knowledge workspace.'],
    ['hierarchy.edit', 'Edit learning objectives', 'Course tools', 'Change themes and learning objectives in the course hierarchy.'],
  ];
  const roles = ['student', 'instructor', 'ta', 'admin'];
  const roleNames = { student: 'Student', instructor: 'Instructor', ta: 'TA', admin: 'Admin' };
  const scopes = ['platform', 'COMM 298', 'COMM 370', 'ECON 101'];
  const defaults = new Set(['question.review', 'question.suggest-edit', 'question.mark-reviewed', 'flag.triage']);
  const initial = { platform: {}, 'COMM 298': { 'analytics.view': { ta: true } }, 'COMM 370': {}, 'ECON 101': {} };
  let saved = U.read('capabilities-saved', initial);
  let draft = U.read('capabilities-draft', copy(saved));
  const S = { scope: 'platform', q: '', group: '', selected: '', source: 'all' };
  function locked(cap, role) { return role === 'admin' || role === 'ta' && ['question.approve', 'flag.resolve'].includes(cap); }
  function raw(model, scope, cap, role) { return model[scope]?.[cap]?.[role]; }
  function effective(model, scope, cap, role) {
    if (locked(cap, role)) return { value: role === 'admin', source: 'Locked' };
    const local = raw(model, scope, cap, role);
    if (local !== undefined) return { value: local, source: scope === 'platform' ? 'Platform' : 'Course' };
    const platform = raw(model, 'platform', cap, role);
    if (scope !== 'platform' && platform !== undefined) return { value: platform, source: 'Platform' };
    return { value: role === 'instructor' || role === 'ta' && defaults.has(cap), source: 'Default' };
  }
  function deltas() {
    return scopes.flatMap(scope => definitions.flatMap(([cap, title]) => roles.filter(role => !locked(cap, role)).flatMap(role => {
      const a = raw(saved, scope, cap, role), b = raw(draft, scope, cap, role);
      return a === b ? [] : [{ scope, cap, title, role, before: a, after: b }];
    })));
  }
  function persist() { U.save('capabilities-draft', draft); }
  function put(cap, role, value) {
    if (locked(cap, role)) return;
    draft[S.scope] ||= {};
    draft[S.scope][cap] ||= {};
    if (value === undefined) delete draft[S.scope][cap][role];
    else draft[S.scope][cap][role] = value;
    persist(); U.render({ preserveFocus: true });
  }
  function overrideCount() { return definitions.reduce((n, [cap]) => n + roles.filter(role => !locked(cap, role) && raw(draft, S.scope, cap, role) !== undefined).length, 0); }
  function scopeLabel(scope = S.scope) { return scope === 'platform' ? 'Platform defaults' : scope; }
  function assignmentText(v) { return v === undefined ? 'Inherit' : v ? 'Allow' : 'Deny'; }
  function filtered() {
    const query = S.q.trim().toLowerCase();
    return definitions.filter(([cap, title, group, description]) => (!query || `${cap} ${title} ${description}`.toLowerCase().includes(query)) && (!S.group || group === S.group) && (S.source !== 'overrides' || roles.some(role => raw(draft, S.scope, cap, role) !== undefined)));
  }
  function cell(cap, role) {
    const e = effective(draft, S.scope, cap, role);
    const changed = raw(draft, S.scope, cap, role) !== raw(saved, S.scope, cap, role);
    return `<td class="cap-role-cell${changed ? ' is-changed' : ''}"><label class="cap-check${e.source === 'Locked' ? ' locked' : ''}"><input type="checkbox" data-cap="${h(cap)}" data-role="${role}" aria-label="${h(roleNames[role] + ': ' + cap)}" ${e.value ? 'checked' : ''} ${e.source === 'Locked' ? 'disabled' : ''}><span>${h(e.source)}</span></label></td>`;
  }
  function inspector() {
    if (!S.selected) return '';
    const [cap, title, , description] = definitions.find(([key]) => key === S.selected);
    return U.panel({ title, eyebrow: `${scopeLabel()} · Permission details`, body: `<p class="config-intro">${h(description)}</p><code class="config-key">${h(cap)}</code><div class="section-label">Role access</div><div class="cap-detail-roles">${roles.map(role => {
      const e = effective(draft, S.scope, cap, role), override = raw(draft, S.scope, cap, role);
      return `<div class="cap-detail-role"><div><strong>${roleNames[role]}</strong><small>${h(e.source)} · ${e.value ? 'Allowed' : 'Denied'}</small></div>${e.source === 'Locked' ? badge(e.value ? 'Always allowed' : 'Always denied', 'neutral') : `<select data-cap-mode="${h(cap)}" data-role="${role}" aria-label="${h(roleNames[role] + ' access for ' + title)}"><option value="inherit" ${override === undefined ? 'selected' : ''}>Inherit</option><option value="allow" ${override === true ? 'selected' : ''}>Allow</option><option value="deny" ${override === false ? 'selected' : ''}>Deny</option></select>`}</div>`;
    }).join('')}</div><div class="section-label">How access is resolved</div><ol class="cap-precedence"><li><strong>Safety rules</strong><span>Admin is always allowed. TA approval and flag resolution are always denied.</span></li><li><strong>Individual course override</strong><span>Configured for a specific course member. Not edited in this matrix.</span></li><li><strong>Course override</strong><span>Applies to a role in one course.</span></li><li><strong>Platform override</strong><span>Used when the course inherits.</span></li><li><strong>Built-in default</strong><span>Used when no override exists.</span></li></ol><p class="detail-note">This matrix shows role-level access. A user still needs membership in the course, and an individual override can change their effective access within the safety rules.</p>`, footer: button('Done', 'cap-close-panel', { className: 'primary' }) });
  }
  function review() {
    const changes = deltas();
    if (!changes.length) return;
    U.modal(`Review ${changes.length} permission ${changes.length === 1 ? 'change' : 'changes'}`, `<p>These changes are saved only in this prototype. Review the scope and role before applying.</p><div class="config-review-list">${changes.map(c => `<div><strong>${h(c.title)}</strong><small>${h(scopeLabel(c.scope))} · ${roleNames[c.role]}</small><span>${assignmentText(c.before)} ${icon('arrow')} <b>${assignmentText(c.after)}</b></span></div>`).join('')}</div><div class="inline-notice">Inherited permissions follow their next available source. Existing course and individual overrides remain separate.</div>`, button('Keep editing', 'ui-close-modal') + button('Apply locally', 'cap-confirm-save', { className: 'primary' }));
  }
  window.AdminPages.capabilities = {
    title: 'Capabilities', subtitle: 'Set role access with clear scopes and inherited defaults.',
    hasUnsavedChanges: () => deltas().length > 0,
    render() {
      const list = filtered(), changes = deltas();
      return `${U.heading('Capabilities', 'Set role access with clear scopes and inherited defaults.', button('Export matrix', 'cap-export', { icon: 'download', className: 'quiet hide-xs' }))}${U.metrics([{ label: 'Permissions', value: '13', note: 'Across 4 roles' }, { label: 'Current scope', value: S.scope === 'platform' ? 'Platform' : 'Course', note: S.scope === 'platform' ? 'Shared defaults' : S.scope }, { label: 'Overrides', value: overrideCount(), note: 'In this scope' }, { label: 'Safety rules', value: '3', note: 'Always enforced' }])}<section class="activity-panel"><div class="table-toolbar config-toolbar"><label class="search-wrap">${icon('search')}<input id="cap-search" type="search" value="${h(S.q)}" placeholder="Find a permission…" aria-label="Search permissions"></label><select id="cap-scope" aria-label="Capability scope">${scopes.map(scope => `<option ${S.scope === scope ? 'selected' : ''} value="${h(scope)}">${h(scopeLabel(scope))}</option>`).join('')}</select><select id="cap-group" class="hide-sm" aria-label="Permission category"><option value="">All categories</option>${['Questions', 'Flags', 'Analytics', 'Course tools'].map(group => `<option ${S.group === group ? 'selected' : ''}>${group}</option>`).join('')}</select>${button('Inheritance', 'cap-inheritance', { icon: 'help', className: 'quiet hide-xs' })}</div><div class="config-scope-note"><span>${icon('shield')} Admin access and TA safety restrictions are locked.</span><label><input id="cap-overrides" type="checkbox" ${S.source === 'overrides' ? 'checked' : ''}> Overrides only</label></div><div class="table-scroll" tabindex="0" aria-label="Capability matrix"><table class="ws-table cap-matrix"><thead><tr><th scope="col">Permission</th>${roles.map(role => `<th scope="col" class="cap-role-head">${roleNames[role]}</th>`).join('')}</tr></thead><tbody>${list.map(([cap, title, group]) => `<tr class="${S.selected === cap ? 'selected' : ''}"><td><button class="cell-primary" data-action="cap-inspect" data-id="${h(cap)}">${h(title)}</button><span class="cell-sub cap-description">${h(group)} <span class="hide-sm">· ${h(cap)}</span></span></td>${roles.map(role => cell(cap, role)).join('')}</tr>`).join('')}</tbody></table>${!list.length ? U.empty('No matching permissions', 'Try another search or show all categories.', button('Clear filters', 'cap-clear')) : ''}</div><div class="save-bar"><span class="config-save-status">${changes.length ? `<b>${changes.length} unsaved ${changes.length === 1 ? 'change' : 'changes'}</b><small>Across all selected scopes · draft retained locally</small>` : '<b>No unsaved changes</b><small>Prototype configuration only</small>'}</span><div class="actions">${button('Discard', 'cap-discard', { disabled: !changes.length })}${button('Review changes', 'cap-review', { disabled: !changes.length, className: 'primary' })}</div></div></section>${inspector()}`;
    },
    action(name, id) {
      if (name === 'cap-inspect') { S.selected = id; U.render(); }
      else if (name === 'cap-close-panel' || name === 'close-panel') { S.selected = ''; U.render(); }
      else if (name === 'cap-review') review();
      else if (name === 'cap-confirm-save') { saved = copy(draft); U.save('capabilities-saved', saved); persist(); U.closeModal(); U.render(); U.toast('Permission changes applied locally. Live access is unchanged.'); }
      else if (name === 'cap-discard') U.modal('Discard permission changes?', '<p>Discard all unsaved changes across platform and course scopes. Your last locally saved matrix will be restored.</p>', button('Keep editing', 'ui-close-modal') + button('Discard changes', 'cap-confirm-discard', { className: 'primary' }));
      else if (name === 'cap-confirm-discard') { draft = copy(saved); persist(); U.closeModal(); U.render(); U.toast('Unsaved permission changes discarded.'); }
      else if (name === 'cap-clear') { S.q = ''; S.group = ''; S.source = 'all'; U.render(); }
      else if (name === 'cap-inheritance') U.modal('Understand capability scopes', '<p><strong>Platform defaults</strong> provide shared role settings. <strong>Course overrides</strong> replace an inherited setting for one course.</p><p>A checked cell grants permission at the selected scope. Open a permission to choose <strong>Inherit</strong> and remove an override.</p><p>Individual course overrides take precedence over this role matrix. Admin access is always enabled, and TA approval and flag resolution are always disabled.</p>', button('Got it', 'ui-close-modal', { className: 'primary' }));
      else if (name === 'cap-export') U.download('financebot-capability-matrix.csv', U.csv([['Scope', 'Capability', 'Role', 'Effective access', 'Source', 'Unsaved override'], ...definitions.flatMap(([cap]) => roles.map(role => { const e = effective(draft, S.scope, cap, role); return [scopeLabel(), cap, role, e.value ? 'Allow' : 'Deny', e.source, raw(draft, S.scope, cap, role) !== raw(saved, S.scope, cap, role) ? 'Yes' : 'No']; }))]), 'text/csv');
    },
    change(el) {
      if (el.dataset.cap) put(el.dataset.cap, el.dataset.role, el.checked);
      else if (el.dataset.capMode) put(el.dataset.capMode, el.dataset.role, el.value === 'inherit' ? undefined : el.value === 'allow');
      else if (el.id === 'cap-scope') { S.scope = el.value; U.render({ preserveFocus: true }); }
      else if (el.id === 'cap-group') { S.group = el.value; U.render({ preserveFocus: true }); }
      else if (el.id === 'cap-overrides') { S.source = el.checked ? 'overrides' : 'all'; U.render({ preserveFocus: true }); }
    },
    input(el) { if (el.id === 'cap-search') { S.q = el.value; U.render({ preserveFocus: true }); } },
  };
})();
