/* global window, document, URLSearchParams */
'use strict';
(() => {
  const UI = window.AdminUI, People = window.AdminPeople;
  const { h, icon, button, badge } = UI;
  const query = new URLSearchParams(window.location.search);
  const state = { q: '', scope: 'all', selected: query.get('puid') || '', pending: null };
  const known = puid => People.users().find(u => u.puid.toLowerCase() === puid.toLowerCase());
  const granted = puid => People.grants().find(g => g.puid.toLowerCase() === puid.toLowerCase());
  const accounts = () => {
    const users = People.users(), grants = People.grants();
    return [...users.map(u => ({ ...u, grant: grants.find(g => g.puid === u.puid) })), ...grants.filter(g => !users.some(u => u.puid === g.puid)).map(g => ({ puid: g.puid, name: 'Awaiting first sign-in', email: '', uid: '', active: true, admin: false, roles: [], grant: g }))];
  };
  const matches = () => accounts().filter(a => (!state.q || `${a.name} ${a.puid} ${a.email} ${a.uid}`.toLowerCase().includes(state.q.toLowerCase())) && (state.scope === 'all' || state.scope === 'active' && a.grant?.state === 'Active' || state.scope === 'pending' && a.grant?.state === 'Pending first login' || state.scope === 'eligible' && !a.grant && a.active));
  const grantBadge = a => badge(a.grant?.state || 'No grant', a.grant?.state === 'Active' ? 'success' : a.grant ? 'warn' : 'neutral');
  function inspector() {
    const a = accounts().find(item => item.puid === state.selected); if (!a) return '';
    const user = known(a.puid), g = a.grant;
    const history = People.audit().filter(e => e.puid === a.puid && e.title.includes('grant'));
    return UI.panel({ title: user?.name || 'Pending identity', eyebrow: 'Instructor access', body: `<div class="actions">${grantBadge(a)}${!a.active ? badge('Account deactivated') : ''}</div><div class="section-label">Identity</div><dl class="property-list"><dt>PUID</dt><dd class="mono">${h(a.puid)}</dd><dt>Name</dt><dd>${h(user?.name || 'Not available before first login')}</dd><dt>Email</dt><dd>${h(user?.email || 'Not available before first login')}</dd><dt>Grant date</dt><dd>${h(g?.granted || '—')}</dd><dt>Granted by</dt><dd>${h(g?.by || '—')}</dd></dl>
      <div class="section-label">What this grant allows</div><div class="issue-callout info"><div class="error-title">Create new courses</div><p>Global Instructor access allows course creation. It does not give access to another instructor’s existing courses or grant Administrator access.</p></div>${!user ? '<div class="inline-notice">This PUID has not signed in. The saved grant will attach to the matching identity at first CWL sign-in.</div>' : !a.active ? '<div class="inline-notice">This account is deactivated. Any stored grant remains blocked until the account is reactivated.</div>' : a.admin ? '<p class="detail-note">This person is already an Admin. Admins can create courses independently of an Instructor grant.</p>' : ''}
      ${user ? `<a class="linked-item" href="${UI.link('users', { puid: a.puid })}">${icon('users')}<span><strong>Open user profile</strong><small>Manage course-specific roles and account status</small></span>${icon('chevron')}</a><a class="linked-item" href="${UI.link('operations', { actor: user.name })}">${icon('activity')}<span><strong>View activity</strong><small>Inspect requests, background work and changes</small></span>${icon('chevron')}</a>` : ''}
      <div class="section-label">Grant history</div>${history.length ? `<ul class="audit-list">${history.map(e => `<li><strong>${h(e.title)}</strong><p>${h(e.detail)}</p><small>Casey Park · ${h(new Date(e.at).toLocaleString())}</small></li>`).join('')}</ul>` : g ? `<ul class="audit-list"><li><strong>Instructor grant created</strong><p>${h(g.by)} · ${h(g.granted)}</p><small>Included sample record</small></li></ul>` : '<p class="detail-note">No grant is currently assigned to this identity.</p>'}`, footer: g ? button('Revoke grant', 'grants-revoke', { id: a.puid, icon: 'key' }) : button('Grant Instructor access', 'grants-add', { id: a.puid, icon: 'plus', className: 'primary', disabled: !a.active }) });
  }
  function render() {
    const all = accounts(), rows = matches(), grants = People.grants();
    const counts = { all: all.length, active: grants.filter(g => g.state === 'Active').length, pending: grants.filter(g => g.state === 'Pending first login').length, eligible: all.filter(a => !a.grant && a.active).length };
    return UI.heading('Instructor Grants', 'Manage global course-creation access by PUID.', `${button('Export', 'grants-export', { icon: 'download', className: 'hide-sm' })}${button('Add Instructor', 'grants-add', { icon: 'plus', className: 'primary' })}`) + UI.metrics([
      { label: 'Active grants', value: counts.active, note: 'Existing identities', tone: 'success' },
      { label: 'Pending login', value: counts.pending, note: 'Pre-provisioned', tone: 'warn' },
      { label: 'Eligible accounts', value: counts.eligible, note: 'No current grant' },
      { label: 'Course access', value: 'Scoped', note: 'Managed in directory' },
    ]) + `<section class="activity-panel" aria-label="Instructor grants"><div class="main-tabs"><div class="source-tabs" role="tablist" aria-label="Grant status">${[['all', 'All accounts'], ['active', 'Active grants'], ['pending', 'Pending first login'], ['eligible', 'Eligible']].map(([id, text]) => `<button type="button" role="tab" aria-selected="${state.scope === id}" class="${state.scope === id ? 'active' : ''}" data-action="grants-scope" data-id="${id}">${text}<span class="tab-count">${counts[id]}</span></button>`).join('')}</div></div><div class="table-toolbar"><label class="search-wrap">${icon('search')}<input type="search" id="grants-search" aria-label="Search instructor grants" value="${h(state.q)}" placeholder="Name, PUID, email or CWL…"></label><span class="spacer"></span>${state.q ? button('Clear', 'grants-clear', { className: 'quiet' }) : ''}${button('How grants work', 'grants-explain', { icon: 'help', className: 'quiet hide-sm' })}</div><div class="table-scroll" tabindex="0" role="region" aria-label="Instructor access table">${rows.length ? `<table class="ws-table people-table grants-table"><thead><tr><th scope="col">Person</th><th scope="col" class="hide-sm">PUID</th><th scope="col">Instructor grant</th><th scope="col" class="hide-md">Granted</th><th scope="col" class="hide-sm">Course roles</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(a => `<tr class="${a.puid === state.selected ? 'selected' : ''}"><td><div class="actor-cell">${UI.avatar(known(a.puid)?.name || 'Pending identity')}<div><button type="button" class="cell-primary" data-action="grants-open" data-id="${h(a.puid)}">${h(a.name)}</button><div class="cell-sub">${h(a.email || a.puid)}</div></div></div></td><td class="hide-sm"><span class="mono">${h(a.puid)}</span></td><td>${grantBadge(a)}${!a.active ? '<div class="cell-sub">Account deactivated</div>' : ''}</td><td class="hide-md"><span class="muted">${h(a.grant?.granted || '—')}</span></td><td class="hide-sm">${a.roles.length ? `${a.roles.length} assigned` : '<span class="muted">None</span>'}</td><td>${button(`Inspect ${known(a.puid)?.name || a.puid}`, 'grants-open', { id: a.puid, icon: 'chevron', className: 'icon-button icon-only quiet' })}</td></tr>`).join('')}</tbody></table>` : UI.empty('No matching accounts', 'Try a different search or add a PUID for a first-time instructor.', button('Add Instructor', 'grants-add', { icon: 'plus', className: 'primary' }))}</div><div class="table-footer"><span class="range-label">${rows.length} of ${all.length} identities</span><span class="hide-sm">Instructor grants do not confer Admin access</span></div></section>${inspector()}`;
  }
  function addForm(puid = '') {
    state.pending = null;
    UI.modal('Add Instructor access', `<p>Find an existing identity or prepare access before their first sign-in.</p><form id="grants-add-form"><label class="control-field">PUID<input name="puid" id="grant-puid" autocomplete="off" required maxlength="64" value="${h(puid)}" placeholder="e.g. DEMO-JLEE-001"></label><p class="detail-note">Use the person’s persistent unique identifier, not their email or CWL username. Demo PUIDs are listed in the User Directory.</p><div id="grant-form-error" role="alert"></div></form>`, `${button('Cancel', 'ui-close-modal')}<button type="submit" form="grants-add-form" class="primary">Review access</button>`);
  }
  function action(name, id) {
    if (name === 'close-panel') state.selected = '';
    else if (name === 'grants-open') state.selected = id;
    else if (name === 'grants-scope') state.scope = id;
    else if (name === 'grants-clear') state.q = '';
    else if (name === 'grants-add') { addForm(id); return; }
    else if (name === 'grants-back') { addForm(state.pending?.puid || ''); return; }
    else if (name === 'grants-explain') {
      UI.modal('Three independent types of access', `<div class="settings-section"><strong>Global Instructor grant</strong><p>Allows a person to create courses. A grant can be saved before their first CWL sign-in.</p></div><div class="settings-section"><strong>Course role</strong><p>Gives Instructor, TA or Student access to a specific course. Manage this in the User Directory.</p></div><div class="settings-section"><strong>Administrator</strong><p>Grants platform administration. Granting Instructor access never makes a person an Admin.</p></div><p class="detail-note">SAML faculty affiliation alone does not grant global Instructor access.</p>`, button('Got it', 'ui-close-modal', { className: 'primary' })); return;
    } else if (name === 'grants-revoke') {
      const grant = granted(id); if (!grant) return;
      state.pending = { type: 'revoke', puid: id };
      const user = known(id);
      UI.modal('Revoke Instructor grant?', `<div class="review-summary"><strong>${h(user?.name || id)}</strong><p>${grant.state === 'Pending first login' ? 'This pre-provisioned grant will no longer activate on first sign-in.' : user?.admin ? 'The explicit Instructor grant will be removed. This person can still create courses through their Admin role.' : 'This person will no longer be able to create new courses through this grant.'}</p></div><p>Existing course roles, authored content and historical records will remain.</p><p class="detail-note">This is a local prototype change.</p>`, `${button('Cancel', 'ui-close-modal')}${button('Revoke grant', 'grants-confirm', { className: 'primary' })}`); return;
    } else if (name === 'grants-confirm') {
      const p = state.pending; if (!p) return;
      let grants = People.grants();
      if (p.type === 'add') {
        if (granted(p.puid)) { UI.toast('This identity already has an Instructor grant.'); UI.closeModal(); return; }
        const user = known(p.puid);
        grants.push({ puid: p.puid, state: user ? 'Active' : 'Pending first login', granted: new Date().toLocaleDateString('en-CA', { month: 'short', day: '2-digit', year: 'numeric' }), by: 'Casey Park' });
        People.record(p.puid, 'Instructor grant created', user ? 'Global course-creation access granted.' : 'Saved for the matching identity at first sign-in.');
        state.selected = p.puid; state.scope = 'all'; state.q = '';
        UI.toast(user ? 'Instructor access granted · prototype saved' : 'Grant saved · awaiting first login');
      } else {
        grants = grants.filter(g => g.puid !== p.puid);
        People.record(p.puid, 'Instructor grant revoked', 'Existing course roles and records retained.');
        if (!known(p.puid)) state.selected = '';
        UI.toast('Instructor grant revoked · course roles retained');
      }
      People.saveGrants(grants); state.pending = null; UI.closeModal();
    } else if (name === 'grants-export') {
      UI.download('financebot-instructor-grants.csv', UI.csv([['Name', 'PUID', 'Grant status', 'Granted date', 'Granted by'], ...matches().map(a => [known(a.puid)?.name || '', a.puid, a.grant?.state || 'No grant', a.grant?.granted || '', a.grant?.by || ''])]), 'text/csv'); UI.toast('Filtered Instructor access exported'); return;
    } else return;
    UI.render();
  }
  function submit(form) {
    if (form.id !== 'grants-add-form') return;
    const raw = form.elements.puid.value.trim();
    const error = document.getElementById('grant-form-error');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(raw)) { error.textContent = 'Enter a PUID using letters, numbers, periods, underscores or hyphens. Email addresses and spaces are not PUIDs.'; return; }
    if (People.users().some(u => u.uid.toLowerCase() === raw.toLowerCase())) { error.textContent = 'That is a CWL username. Use the PUID shown on this person’s profile in the User Directory.'; return; }
    const user = known(raw), puid = user?.puid || raw.toUpperCase();
    if (granted(puid)) { error.textContent = 'This PUID already has an Instructor grant. Search for the existing grant to review it.'; return; }
    if (user && !user.active) { error.textContent = 'This account is deactivated. Reactivate it in the User Directory before granting access.'; return; }
    state.pending = { type: 'add', puid };
    UI.modal('Review Instructor grant', `<div class="review-summary"><strong>${h(user?.name || 'New identity')}</strong><p class="mono">${h(puid)}</p>${badge(user ? 'Existing account' : 'Pending first login', user ? 'success' : 'warn')}</div><div class="issue-callout info"><div class="error-title">Can create courses</div><p>${user ? 'This account will receive global Instructor access.' : 'The grant will activate when this PUID signs in with CWL for the first time.'} Existing-course access must be assigned separately.</p></div>${user?.admin ? '<p>This account is already an Admin and can create courses independently of this grant.</p>' : ''}<p class="detail-note">No Administrator access is added. This prototype stores changes in this browser only.</p>`, `${button('Back', 'grants-back')}${button('Grant Instructor access', 'grants-confirm', { className: 'primary' })}`);
  }
  window.AdminPages.grants = { title: 'Instructor Grants', subtitle: 'People & access', render, action, submit,
    input(el) { if (el.id === 'grants-search') { state.q = el.value; UI.render({ preserveFocus: true }); } },
  };
})();
