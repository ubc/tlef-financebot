/* global window, document, URLSearchParams */
'use strict';
(() => {
  const UI = window.AdminUI;
  const { h, icon, button, badge } = UI;
  const courses = ['COMM 298', 'COMM 370', 'ECON 101'];
  const initial = [
    { puid: 'DEMO-JLEE-001', name: 'Jordan Lee', uid: 'jordan.lee', email: 'jordan.lee@example.edu', admin: false, active: true, last: 'Today, 11:42', roles: [{ course: 'COMM 298', role: 'Instructor' }, { course: 'COMM 370', role: 'Instructor' }] },
    { puid: 'DEMO-RPAT-002', name: 'Robin Patel', uid: 'robin.patel', email: 'robin.patel@example.edu', admin: false, active: true, last: 'Today, 11:44', roles: [{ course: 'COMM 370', role: 'Instructor' }, { course: 'ECON 101', role: 'Instructor' }] },
    { puid: 'DEMO-TCHEN-003', name: 'Taylor Chen', uid: 'taylor.chen', email: 'taylor.chen@example.edu', admin: false, active: true, last: 'Today, 11:33', roles: [{ course: 'COMM 298', role: 'TA' }, { course: 'COMM 370', role: 'TA' }] },
    { puid: 'DEMO-AMOR-004', name: 'Alex Morgan', uid: 'alex.morgan', email: 'alex.morgan@example.edu', admin: false, active: true, last: 'Today, 11:36', roles: [{ course: 'COMM 298', role: 'Student' }, { course: 'ECON 101', role: 'Student' }] },
    { puid: 'DEMO-CPARK-005', name: 'Casey Park', uid: 'casey.park', email: 'casey.park@example.edu', admin: true, active: true, last: 'Today, 11:40', roles: [] },
    { puid: 'DEMO-SKIM-006', name: 'Sam Kim', uid: 'sam.kim', email: 'sam.kim@example.edu', admin: false, active: true, last: 'Yesterday, 16:08', roles: [{ course: 'COMM 298', role: 'Student' }] },
    { puid: 'DEMO-RBROOK-007', name: 'Riley Brooks', uid: 'riley.brooks', email: 'riley.brooks@example.edu', admin: false, active: true, last: 'Yesterday, 14:25', roles: [{ course: 'ECON 101', role: 'TA' }] },
    { puid: 'DEMO-MRIV-008', name: 'Morgan Rivera', uid: 'morgan.rivera', email: 'morgan.rivera@example.edu', admin: false, active: false, last: 'Sep 14, 09:32', roles: [{ course: 'COMM 370', role: 'Student' }] },
    { puid: 'DEMO-JWONG-009', name: 'Jamie Wong', uid: 'jamie.wong', email: 'jamie.wong@example.edu', admin: false, active: true, last: 'Sep 19, 18:51', roles: [{ course: 'COMM 370', role: 'Student' }] },
    { puid: 'DEMO-DALI-010', name: 'Drew Ali', uid: 'drew.ali', email: 'drew.ali@example.edu', admin: false, active: false, last: 'Sep 12, 10:10', roles: [] },
  ];
  const grantSeed = [
    { puid: 'DEMO-JLEE-001', state: 'Active', granted: 'Sep 08, 2026', by: 'Casey Park' },
    { puid: 'DEMO-RPAT-002', state: 'Active', granted: 'Sep 10, 2026', by: 'Casey Park' },
    { puid: 'DEMO-PENDING-011', state: 'Pending first login', granted: 'Sep 19, 2026', by: 'Casey Park' },
  ];
  const People = window.AdminPeople = {
    users: () => UI.read('people-users-v1', initial),
    grants: () => UI.read('people-grants-v1', grantSeed),
    saveUsers: value => UI.save('people-users-v1', value),
    saveGrants: value => UI.save('people-grants-v1', value),
    audit: () => UI.read('people-audit-v1', []),
    record: (puid, title, detail) => { const entries = UI.read('people-audit-v1', []); entries.unshift({ puid, title, detail, at: new Date().toISOString() }); UI.save('people-audit-v1', entries.slice(0, 100)); },
    courses,
  };
  const params = new URLSearchParams(window.location.search);
  const state = { q: '', status: '', role: '', course: '', selected: params.get('puid') || People.users().find(u => u.name === params.get('actor'))?.puid || '', tab: 'Profile', sort: 'name', ascending: true, pending: null };
  const person = () => People.users().find(u => u.puid === state.selected);
  const roleNames = u => [...new Set([...(u.admin ? ['Admin'] : []), ...u.roles.map(r => r.role)])];
  const filterRows = () => People.users().filter(u => {
    const terms = `${u.name} ${u.email} ${u.uid} ${u.puid}`.toLowerCase();
    return (!state.q || terms.includes(state.q.toLowerCase())) && (!state.status || (state.status === 'Active') === u.active) && (!state.role || roleNames(u).includes(state.role)) && (!state.course || u.roles.some(r => r.course === state.course));
  }).sort((a, b) => (state.sort === 'status' ? Number(a.active) - Number(b.active) : a.name.localeCompare(b.name)) * (state.ascending ? 1 : -1));
  const selectedOption = (value, selected) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(value)}</option>`;
  const safeCourseList = u => u.roles.map(r => r.course).filter((v, i, all) => all.indexOf(v) === i);
  const orphanedCourses = (u, removingCourse = '') => u.roles.filter(r => r.role === 'Instructor' && (!removingCourse || r.course === removingCourse)).map(r => r.course).filter(c => !People.users().some(other => other.puid !== u.puid && other.active && other.roles.some(r => r.course === c && r.role === 'Instructor')));
  const href = (page, u) => UI.link(page, { actor: u.name });
  function profile(u) {
    const globalAccess = People.grants().some(g => g.puid === u.puid);
    return `<div class="panel-section"><div class="actions">${UI.avatar(u.name)}<div><strong>${h(u.name)}</strong><div class="cell-sub">${h(u.email)}</div></div><span class="spacer"></span>${badge(u.active ? 'Active' : 'Deactivated', u.active ? 'success' : 'neutral')}</div></div>
      <div class="section-label">Identity</div><dl class="property-list"><dt>CWL</dt><dd>${h(u.uid)}</dd><dt>PUID</dt><dd class="mono">${h(u.puid)}</dd><dt>Last active</dt><dd>${h(u.last)}</dd><dt>Account source</dt><dd>CWL sign-in</dd></dl>
      <div class="section-label">Platform access</div><dl class="property-list"><dt>Administrator</dt><dd>${u.admin ? badge('Granted', 'running') : 'Not granted'}</dd><dt>Create courses</dt><dd>${globalAccess ? badge('Instructor grant', 'success') : u.admin ? 'Allowed by Admin role' : 'Not granted'}</dd></dl>
      <p class="detail-note">A global Instructor grant allows course creation. Access to existing courses is managed separately under Course access.</p>
      <a class="linked-item" href="${UI.link('grants', { puid: u.puid })}">${icon('key')}<span><strong>Instructor grants</strong><small>Review global course-creation access</small></span>${icon('chevron')}</a>
      <div class="section-label">Investigation</div><a class="linked-item" href="${href('operations', u)}">${icon('activity')}<span><strong>View all activity</strong><small>Requests, tasks and change history</small></span>${icon('chevron')}</a><a class="linked-item" href="${href('questions', u)}">${icon('book')}<span><strong>Created questions</strong><small>Filter the question library by ${h(u.name)}</small></span>${icon('chevron')}</a>
      <div class="section-label">Account status</div><p class="detail-note">Deactivation blocks platform access and retains course roles, questions and historical records.</p>${u.admin ? '<div class="inline-notice">Admin accounts cannot be deactivated from this directory.</div>' : button(u.active ? 'Deactivate account' : 'Reactivate account', 'users-state', { id: u.puid, icon: u.active ? 'shield' : 'check', className: u.active ? '' : 'primary' })}`;
  }
  function access(u) {
    return `<div class="section-label">${u.roles.length} course ${u.roles.length === 1 ? 'role' : 'roles'} ${button('Add role', 'users-add-role', { icon: 'plus' })}</div>${u.roles.length ? u.roles.map((r, i) => `<div class="settings-section people-role-card"><div class="actions"><strong>${h(r.course)}</strong><span class="spacer"></span>${badge(r.role, r.role === 'Instructor' ? 'running' : 'neutral')}</div><p class="detail-note">${r.role === 'Instructor' ? 'Authoring, review and course management' : r.role === 'TA' ? 'Teaching-team review, within assigned capabilities' : 'Released learning and practice content'}</p><div class="actions">${button('Change role', 'users-edit-role', { id: String(i), icon: 'edit', className: 'quiet' })}${button('Remove', 'users-remove-role', { id: String(i), className: 'quiet' })}</div></div>`).join('') : UI.empty('No course roles', 'Assign a role to give this user access to a specific course.')}
      <div class="issue-callout info"><div class="error-title">Course access is separate</div><p>Adding an Instructor role here gives access to that course. It does not grant permission to create other courses.</p></div><p class="detail-note">TA approval and flag resolution remain unavailable, regardless of capability settings.</p>`;
  }
  function activity(u) {
    const edits = People.audit().filter(e => e.puid === u.puid);
    const events = (window.OPS_DATA?.events || []).filter(e => e.actor === u.name).slice(0, 5);
    return `<div class="section-label">Access changes in this prototype</div>${edits.length ? `<ul class="audit-list">${edits.map(e => `<li><strong>${h(e.title)}</strong><p>${h(e.detail)}</p><small>Casey Park · ${h(new Date(e.at).toLocaleString())}</small></li>`).join('')}</ul>` : '<p class="detail-note">No local access changes for this person yet.</p>'}<div class="section-label">Recent recorded activity</div>${events.length ? events.map(e => `<a class="linked-item" href="${UI.link('operations', { actor: u.name, inspect: e.id })}">${icon('activity')}<span><strong>${h(e.title)}</strong><small>${h(e.id)} · ${h(e.course)}</small></span>${badge(e.status, e.status === 'Failed' ? 'failed' : e.status === 'Accepted' || e.status === 'Running' ? 'running' : 'neutral')}</a>`).join('') : '<p class="detail-note">No activity is included for this user in the current sample.</p>'}<a class="button" href="${href('operations', u)}">${icon('external')} Open Operations & Issues</a>`;
  }
  function panel() {
    const u = person(); if (!u) return '';
    const tabs = ['Profile', 'Course access', 'Activity'];
    return UI.panel({ title: u.name, eyebrow: 'User details', body: `<div class="panel-tabs" role="tablist" aria-label="User details">${tabs.map(tab => `<button type="button" role="tab" aria-selected="${state.tab === tab}" class="${state.tab === tab ? 'active' : ''}" data-action="users-tab" data-id="${h(tab)}">${h(tab)}</button>`).join('')}</div><div role="tabpanel" aria-label="${h(state.tab)}">${state.tab === 'Profile' ? profile(u) : state.tab === 'Course access' ? access(u) : activity(u)}</div>`, footer: `<span class="detail-note">Sample identity · local changes only</span>${button('Close', 'close-panel')}` });
  }
  function render() {
    const all = People.users(), rows = filterRows();
    return UI.heading('User Directory', 'Find people, inspect access, and investigate activity.', button('Export', 'users-export', { icon: 'download' })) + UI.metrics([
      { label: 'People', value: all.length, note: 'Signed-in identities' },
      { label: 'Active', value: all.filter(u => u.active).length, tone: 'success' },
      { label: 'Instructors', value: all.filter(u => u.roles.some(r => r.role === 'Instructor')).length, note: 'Course instructors' },
      { label: 'Deactivated', value: all.filter(u => !u.active).length },
    ]) + `<section class="activity-panel" aria-label="User directory"><div class="table-toolbar"><label class="search-wrap">${icon('search')}<input id="users-search" type="search" aria-label="Search users" placeholder="Name, email, CWL or PUID…" value="${h(state.q)}"></label><select id="users-status" aria-label="Account status"><option value="">All statuses</option>${['Active', 'Deactivated'].map(v => selectedOption(v, state.status)).join('')}</select><select id="users-role" aria-label="User role"><option value="">All roles</option>${['Admin', 'Instructor', 'TA', 'Student'].map(v => selectedOption(v, state.role)).join('')}</select><select id="users-course" class="hide-sm" aria-label="Course"><option value="">All courses</option>${courses.map(v => selectedOption(v, state.course)).join('')}</select>${state.q || state.status || state.role || state.course ? button('Clear', 'users-clear', { className: 'quiet' }) : ''}</div><div class="table-scroll" tabindex="0" role="region" aria-label="Users table">${rows.length ? `<table class="ws-table people-table"><thead><tr><th scope="col">${button(`Person ${state.sort === 'name' ? state.ascending ? '↑' : '↓' : ''}`, 'users-sort', { id: 'name', className: 'quiet' })}</th><th scope="col" class="hide-xs">Roles</th><th scope="col" class="hide-sm">Courses</th><th scope="col">${button(`Status ${state.sort === 'status' ? state.ascending ? '↑' : '↓' : ''}`, 'users-sort', { id: 'status', className: 'quiet' })}</th><th scope="col" class="hide-md">Last active</th><th scope="col"><span class="sr-only">Inspect</span></th></tr></thead><tbody>${rows.map(u => `<tr class="${u.puid === state.selected ? 'selected' : ''}"><td><div class="actor-cell">${UI.avatar(u.name)}<div><button type="button" class="cell-primary" data-action="users-open" data-id="${h(u.puid)}">${h(u.name)}</button><div class="cell-sub">${h(u.email)}</div></div></div></td><td class="hide-xs">${roleNames(u).length ? roleNames(u).map(r => badge(r, r === 'Admin' ? 'running' : 'neutral')).join(' ') : '<span class="muted">No roles</span>'}</td><td class="hide-sm">${h(safeCourseList(u).join(', ') || '—')}</td><td>${badge(u.active ? 'Active' : 'Deactivated', u.active ? 'success' : 'neutral')}</td><td class="hide-md"><span class="muted">${h(u.last)}</span></td><td>${button(`Inspect ${u.name}`, 'users-open', { id: u.puid, icon: 'chevron', className: 'icon-button icon-only quiet' })}</td></tr>`).join('')}</tbody></table>` : UI.empty('No users match', 'Try a different name or clear your filters.', button('Clear filters', 'users-clear'))}</div><div class="table-footer"><span class="range-label">${rows.length} of ${all.length} people</span><span class="hide-sm">Accounts appear after first CWL sign-in</span></div></section>${panel()}`;
  }
  function roleForm(index) {
    const u = person(), existing = index === null ? null : u.roles[index];
    state.pending = { type: 'role', puid: u.puid, index };
    UI.modal(existing ? 'Change course role' : 'Assign course role', `<p>Choose the access ${h(u.name)} needs for this course.</p><form id="users-role-form"><label class="control-field">Course<select name="course" required ${existing ? 'disabled' : ''}>${courses.map(v => selectedOption(v, existing?.course || courses[0])).join('')}</select></label><label class="control-field">Course role<select name="role">${['Student', 'TA', 'Instructor'].map(v => selectedOption(v, existing?.role || 'Student')).join('')}</select></label><div id="users-form-error" role="alert"></div></form><p class="detail-note">This changes access to one course. Global Instructor grants are managed separately.</p>`, `${button('Cancel', 'ui-close-modal')}<button type="submit" form="users-role-form" class="primary">Review change</button>`);
  }
  function reviewPending(title, detail, confirm = 'Save change') {
    UI.modal(title, `<div class="review-summary"><strong>${h(person()?.name || '')}</strong><p>${detail}</p></div><p class="detail-note">This prototype stores the reviewed change in this browser. No live account is changed.</p>`, `${button('Cancel', 'ui-close-modal')}${button(confirm, 'users-confirm', { className: 'primary' })}`);
  }
  function blockOrphan(coursesAtRisk) {
    UI.modal('Keep an instructor on this course', `<div class="issue-callout warn"><div class="error-title">${h(coursesAtRisk.join(', '))} would lose its final active instructor</div><p>Assign another active instructor before removing this access or deactivating the account.</p></div><p>The current account and course roles have been preserved.</p>`, button('Review course access', 'users-show-access', { className: 'primary' }));
  }
  function action(name, id) {
    if (name === 'users-open') { state.selected = id; state.tab = 'Profile'; }
    else if (name === 'close-panel') state.selected = '';
    else if (name === 'users-tab') state.tab = id;
    else if (name === 'users-clear') { state.q = ''; state.status = ''; state.role = ''; state.course = ''; }
    else if (name === 'users-sort') { state.ascending = state.sort === id ? !state.ascending : true; state.sort = id; }
    else if (name === 'users-show-access') { state.tab = 'Course access'; UI.closeModal(); }
    else if (name === 'users-add-role' || name === 'users-edit-role') { roleForm(name === 'users-edit-role' ? Number(id) : null); return; }
    else if (name === 'users-remove-role') {
      const u = person(), index = Number(id), entry = u.roles[index], risk = entry.role === 'Instructor' ? orphanedCourses(u, entry.course) : [];
      if (risk.length) { blockOrphan(risk); return; }
      state.pending = { type: 'remove', puid: u.puid, index };
      reviewPending('Remove course access?', `${h(entry.role)} access to <strong>${h(entry.course)}</strong> will be removed. Historical records will remain.`, 'Remove role'); return;
    } else if (name === 'users-state') {
      const u = person(); if (!u || u.admin) return;
      const risk = u.active ? orphanedCourses(u) : []; if (risk.length) { blockOrphan(risk); return; }
      state.pending = { type: 'status', puid: u.puid, active: !u.active };
      reviewPending(u.active ? 'Deactivate this account?' : 'Reactivate this account?', u.active ? 'Platform access will be blocked. Existing questions, course roles and history will be retained.' : 'Platform access and previously assigned course roles will become available again.', u.active ? 'Deactivate account' : 'Reactivate account'); return;
    } else if (name === 'users-confirm') {
      const pending = state.pending; if (!pending) return;
      const all = People.users(), u = all.find(item => item.puid === pending.puid); if (!u) return;
      let detail = '', title = '';
      if (pending.type === 'status') { u.active = pending.active; title = u.active ? 'Account reactivated' : 'Account deactivated'; detail = 'Records and course role history retained.'; }
      if (pending.type === 'remove') { const old = u.roles.splice(pending.index, 1)[0]; title = 'Course role removed'; detail = `${old.course} · ${old.role}`; }
      if (pending.type === 'role') { const entry = { course: pending.course, role: pending.role }; if (pending.index === null) u.roles.push(entry); else u.roles[pending.index] = entry; title = pending.index === null ? 'Course role assigned' : 'Course role changed'; detail = `${entry.course} · ${entry.role}`; }
      People.saveUsers(all); People.record(u.puid, title, detail); state.pending = null; UI.closeModal(); UI.toast(`${title} · saved in prototype`);
    } else if (name === 'users-export') {
      UI.download('financebot-user-directory.csv', UI.csv([['Name', 'CWL', 'PUID', 'Email', 'Status', 'Course roles'], ...filterRows().map(u => [u.name, u.uid, u.puid, u.email, u.active ? 'Active' : 'Deactivated', u.roles.map(r => `${r.course}: ${r.role}`).join('; ')])]), 'text/csv'); UI.toast('Filtered user directory exported'); return;
    } else return;
    UI.render();
  }
  function submit(form) {
    if (form.id !== 'users-role-form') return;
    const u = person(), p = state.pending; if (!u || !p) return;
    const course = p.index !== null ? u.roles[p.index].course : form.elements.course.value;
    const role = form.elements.role.value;
    const error = document.getElementById('users-form-error');
    if (u.roles.some((r, i) => i !== p.index && r.course === course && r.role === role)) { error.textContent = `${u.name} already has this role in ${course}.`; return; }
    if (p.index !== null && u.roles[p.index].role === role) { error.textContent = 'Choose a different role to make a change.'; return; }
    if (p.index !== null && u.roles[p.index].role === 'Instructor' && role !== 'Instructor') { const risk = orphanedCourses(u, course); if (risk.length) { blockOrphan(risk); return; } }
    p.course = course; p.role = role;
    reviewPending('Review course access', `${p.index !== null ? `${h(u.roles[p.index].role)} → ` : 'Assign '}<strong>${h(role)}</strong> in <strong>${h(course)}</strong>. ${role === 'TA' ? 'TA approval and flag resolution remain unavailable.' : ''}`);
  }
  window.AdminPages.users = { title: 'User Directory', subtitle: 'People & access', render, action, submit,
    input(el) { if (el.id === 'users-search') { state.q = el.value; UI.render({ preserveFocus: true }); } },
    change(el) { const keys = { 'users-status': 'status', 'users-role': 'role', 'users-course': 'course' }; if (keys[el.id]) { state[keys[el.id]] = el.value; UI.render(); } },
  };
})();
