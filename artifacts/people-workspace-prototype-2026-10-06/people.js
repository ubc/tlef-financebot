/* Independent UI prototype. No fetch, API calls, email or persisted grants. */
'use strict';
const $ = selector => document.querySelector(selector);
const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const initials = name => name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
const isOwner = () => $('#viewer').value === 'owner';
const roleDescription = {
  Student: 'Practice released questions and view their own progress. No access to course authoring.',
  TA: 'Review questions, suggest edits and view student analytics within assigned permissions.',
  Instructor: 'Manage course materials, questions and review. People access changes stay with the course owner.',
};
const knownAccounts = [
  { name: 'Rachel Wu', email: 'rachel.wu@ubc.ca', cwl: 'rachelw', puid: '87655901', login: 'Oct 6, 2026 · 9:30 AM' },
  { name: 'Jamie Cooper', email: 'jamie.cooper@student.ubc.ca', cwl: 'jamiec', puid: '87655902', login: 'Oct 5, 2026 · 1:20 PM' },
];
let people = [], codes = [], page = 1, tab = 'people', nextId = 1000, toastTimer;
const events = new Map();
const statusBadge = status => `<span class="status-badge ${safe(status.toLowerCase())}"><span class="status-dot" aria-hidden="true"></span>${safe(status)}</span>`;
const smallTime = value => value || 'Not signed in';
function seed() {
  people = [
    { id: 1, name: 'John Faculty', email: 'faculty@ubc.ca', cwl: 'faculty', puid: '87654001', role: 'Owner', status: 'Active', source: 'Course creation', login: 'Oct 6, 2026 · 12:58 PM', joined: 'Sep 23, 2026' },
    { id: 2, name: 'Maya Thompson', email: 'maya.thompson@ubc.ca', cwl: 'mayat', puid: '87654002', role: 'Instructor', status: 'Active', source: 'Invitation', login: 'Oct 6, 2026 · 10:24 AM', joined: 'Sep 24, 2026' },
    { id: 3, name: 'Daniel Wong', email: 'daniel.wong@ubc.ca', cwl: 'danielw', puid: '87654003', role: 'Instructor', status: 'Active', source: 'Canvas people CSV', login: 'Oct 5, 2026 · 4:12 PM', joined: 'Sep 25, 2026' },
    { id: 4, name: 'Alex Chen', email: 'alex.chen@ubc.ca', cwl: 'alexchen', puid: '87654004', role: 'TA', status: 'Active', source: 'Invitation', login: 'Oct 6, 2026 · 11:35 AM', joined: 'Sep 25, 2026' },
    { id: 5, name: 'Leila Hassan', email: 'leila.hassan@ubc.ca', cwl: 'leilah', puid: '87654005', role: 'TA', status: 'Active', source: 'Canvas people CSV', login: 'Oct 6, 2026 · 9:08 AM', joined: 'Sep 25, 2026' },
    { id: 6, name: 'Ethan Park', email: 'ethan.park@ubc.ca', cwl: 'ethanp', puid: '87654006', role: 'TA', status: 'Active', source: 'Invitation', login: 'Oct 5, 2026 · 2:47 PM', joined: 'Sep 26, 2026' },
  ];
  const first = ['Sofia', 'Liam', 'Amelia', 'Noah', 'Isabella', 'Oliver', 'Charlotte', 'Lucas', 'Grace', 'Henry', 'Ava', 'James', 'Chloe'];
  const last = ['Patel', 'Kim', 'Wilson', 'Nguyen', 'Brown', 'Garcia'];
  first.forEach((name, i) => last.forEach((surname, j) => {
    const id = people.length + 1;
    people.push({ id, name: `${name} ${surname}`, email: `${name.toLowerCase()}.${surname.toLowerCase()}@student.ubc.ca`, cwl: `${name.toLowerCase()}${j + 1}`, puid: String(87654000 + id), role: 'Student', status: 'Active', source: i === 0 && j === 1 ? 'One-time code' : 'Gradebook CSV', login: `Oct ${6 - i % 3}, 2026 · ${9 + j}:15 AM`, joined: 'Oct 1, 2026' });
  }));
  people.push({ id: 90, name: 'Jordan Lee', email: 'jordan.lee@ubc.ca', cwl: '', puid: '', role: 'TA', status: 'Pending', source: 'Invitation', login: '', joined: 'Oct 6, 2026' },
    { id: 91, name: 'Priya Shah', email: 'priya.shah@ubc.ca', cwl: '', puid: '', role: 'Instructor', status: 'Pending', source: 'Invitation', login: '', joined: 'Oct 5, 2026' },
    { id: 92, name: 'Sam Rivera', email: 'sam.rivera@student.ubc.ca', cwl: '', puid: '', role: 'Student', status: 'Pending', source: 'Invitation', login: '', joined: 'Oct 6, 2026' },
    { id: 93, name: 'Chris Taylor', email: 'chris.taylor@student.ubc.ca', cwl: 'christ', puid: '87654993', role: 'Student', status: 'Banned', source: 'Gradebook CSV', login: 'Oct 3, 2026 · 3:10 PM', joined: 'Oct 1, 2026', banReason: 'Course access suspended pending a meeting.' });
  codes = [
    { id: 'c1', value: '7FS2R94QX8RC', status: 'Revoked', person: '', created: 'Oct 6 · 12:49 PM' },
    { id: 'c2', value: '3G77C2833W2X', status: 'Used', person: 'Sofia Kim', claimed: 'Oct 6 · 12:52 PM', created: 'Oct 6 · 12:49 PM' },
    ...Array.from({ length: 11 }, (_, index) => ({ id: `c${index + 3}`, value: `PHYS${String(index + 1).padStart(8, '0')}`, status: 'Unused', person: '', created: 'Oct 6 · 12:49 PM' })),
  ];
  events.clear(); nextId = 1000;
  for (const person of people) events.set(person.id, [{ text: `${person.role} access ${person.status === 'Pending' ? 'invited' : 'added'} through ${person.source}.`, time: person.joined }]);
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function record(person, text) {
  const history = events.get(person.id) || [];
  history.unshift({ text, time: 'Oct 6, 2026 · just now (prototype)' }); events.set(person.id, history);
}
function feedback(message) { $('#feedback').textContent = message; toast(message); }
function ownerButton(label, attrs = '') { return `<button class="btn btn--secondary" ${attrs} ${isOwner() ? '' : 'disabled'}>${label}</button>`; }
function personRow(person) {
  const locked = person.role === 'Owner';
  const action = person.status === 'Pending' ? 'cancel' : person.status === 'Banned' ? 'unban' : 'ban';
  const actionText = { cancel: 'Cancel invite', unban: 'Unban', ban: 'Ban' }[action];
  return `<tr class="person-row">
  <td><div class="person-cell"><span class="avatar">${safe(initials(person.name))}</span><div><button class="person-name" data-action="profile" data-id="${person.id}">${safe(person.name)}</button><small>${safe(person.email)}</small></div></div></td>
  <td><button class="role-edit" data-action="role" data-id="${person.id}" aria-label="Change role for ${safe(person.name)}" ${locked || !isOwner() ? 'disabled' : ''}>${safe(person.role)}${locked ? '' : '<span aria-hidden="true">⌄</span>'}</button>${person.override ? '<small>Owner override</small>' : ''}</td>
  <td>${person.cwl ? `<code>${safe(person.cwl)}</code><small>Login ID: ${safe(person.puid)}</small>` : '<span class="muted">Available after first CWL login</span>'}</td>
  <td>${statusBadge(person.status)}</td><td class="people-source">${safe(person.source)}<small>${person.status === 'Pending' ? 'Invited' : 'Added'} ${safe(person.joined)}</small></td>
  <td class="time-cell">${safe(smallTime(person.login))}</td>
  <td><div class="row-actions">${ownerButton('View', `data-action="profile" data-id="${person.id}"`).replace(' disabled', '')}${locked ? '<span class="status-badge">Protected</span>' : `<button class="btn btn--ghost ${action === 'ban' ? 'danger-button' : ''}" data-action="${action}" data-id="${person.id}" ${isOwner() ? '' : 'disabled'}>${actionText}</button>`}</div></td></tr>`;
}
function codeRow(code) {
  return `<tr class="code-row"><td><code>${safe(code.value)}</code><small>Created ${safe(code.created)}</small></td><td>${statusBadge(code.status)}</td><td>${safe(code.person || 'Unclaimed')}</td><td>${safe(code.claimed || '—')}</td><td><div class="row-actions">${code.status === 'Unused' ? `<button class="btn btn--secondary" data-code="${code.id}" data-action="copy-code">Copy</button>${ownerButton('Revoke', `data-code="${code.id}" data-action="revoke-code"`)}` : ''}<button class="btn btn--ghost danger-button" data-code="${code.id}" data-action="delete-code" ${isOwner() ? '' : 'disabled'}>Delete</button></div></td></tr>`;
}
function render() {
  const query = $('#search').value.toLowerCase().trim();
  const role = $('#role-filter').value, status = $('#status-filter').value;
  const pending = people.filter(person => person.status === 'Pending').length;
  const invitations = people.filter(person => person.status === 'Pending' && person.source === 'Invitation').length;
  $('#people-count').textContent = people.length; $('#invite-count').textContent = invitations; $('#code-count').textContent = codes.length;
  $('#directory-toolbar').hidden = tab === 'codes'; $('#code-toolbar').hidden = tab !== 'codes';
  $('#status-filter').hidden = tab === 'invitations';
  $('#people-content').setAttribute('aria-labelledby', `tab-${tab}`);
  $('#invite-open').disabled = !isOwner(); $('#import-open').disabled = !isOwner(); $('#generate-form button').disabled = !isOwner(); $('#code-count-input').disabled = !isOwner();
  $('#authority-note').textContent = isOwner() ? 'Course owner can invite people, change roles and ban course access.' : 'Instructor view: browse the directory. Only the course owner can change access.';
  $('#summary').innerHTML = tab === 'codes'
    ? '<strong>One-time student access.</strong> Use Gradebook for the class; one unused code for each additional student.'
    : tab === 'invitations' ? '<strong>Pending first CWL login.</strong> Roles and TA permissions are assigned before activation.'
    : `<strong>${people.length} people</strong> · ${people.filter(p => p.role === 'Student').length} students · ${people.filter(p => ['Owner', 'Instructor', 'TA'].includes(p.role)).length} teaching staff · ${pending} pending · ${people.filter(p => p.status === 'Banned').length} banned`;
  let rows = tab === 'codes' ? codes.filter(code => !$('#code-filter').value || code.status === $('#code-filter').value)
    : people.filter(person => (tab !== 'invitations' || person.status === 'Pending' && person.source === 'Invitation') && (!role || person.role === role) && (tab === 'invitations' || !status || person.status === status)
      && (!query || [person.name, person.email, person.cwl, person.puid].some(value => value.toLowerCase().includes(query))));
  const size = Number($('#page-size').value); const total = rows.length; const pages = Math.max(1, Math.ceil(total / size));
  page = Math.min(page, pages); rows = rows.slice((page - 1) * size, page * size);
  const headers = tab === 'codes' ? ['Code / created', 'Status', 'Claimed by', 'Claimed', 'Actions'] : ['Person', 'Course role', 'CWL / Login ID', 'Status', 'Access source', 'Last CWL login', 'Actions'];
  $('#table-wrap').innerHTML = rows.length ? `<table class="people-table" aria-label="${tab === 'codes' ? 'Registration codes' : 'Course people'}"><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(tab === 'codes' ? codeRow : personRow).join('')}</tbody></table>`
    : `<div class="empty"><h2>${tab === 'invitations' ? 'No pending invitations' : 'No matching records'}</h2><p>${tab === 'invitations' ? 'New invitations appear here until the matching account signs in.' : 'Adjust your search or filters to find the records you need.'}</p><button class="btn btn--secondary" id="clear-filters">Clear filters</button></div>`;
  $('#range').textContent = `${total ? (page - 1) * size + 1 : 0}–${total ? (page - 1) * size + rows.length : 0} of ${total} · Page ${page} of ${pages}`;
  $('#previous').disabled = page === 1; $('#next').disabled = page === pages;
}
function setTab(value) {
  tab = value; page = 1; $('#feedback').textContent = '';
  document.querySelectorAll('[data-tab]').forEach(button => { button.setAttribute('aria-selected', String(button.dataset.tab === value)); button.tabIndex = button.dataset.tab === value ? 0 : -1; });
  render();
}
function showDialog(content) { $('#dialog-body').innerHTML = content; if (!$('#dialog').open) $('#dialog').showModal(); }
function closeDialog() { $('#dialog').close(); }
const footer = (confirmLabel, confirmId, danger = false) => `<div class="dialog-actions"><button class="btn btn--secondary" type="button" data-close>Cancel</button><button class="btn ${danger ? 'btn--secondary danger-button' : 'btn--instr-primary'}" type="button" id="${confirmId}">${confirmLabel}</button></div>`;
function roleControls(role, permissions = {}) {
  return `<div class="dialog-field"><label>Course role</label><div class="role-options">${['Student', 'TA', 'Instructor'].map(value => `<label class="role-option"><input type="radio" name="invite-role" value="${value}" ${value === role ? 'checked' : ''}>${value}</label>`).join('')}</div></div>
  <div class="role-description" id="role-description">${roleDescription[role]}</div>
  <div id="ta-permissions" ${role !== 'TA' ? 'hidden' : ''}><div class="permission-list">${[['review', 'Review questions and leave notes'], ['suggest', 'Suggest question edits'], ['analytics', 'View student analytics']].map(([key, label]) => `<label><input type="checkbox" name="permission-${key}" ${permissions[key] !== false ? 'checked' : ''}>${label}</label>`).join('')}</div><p class="locked-note">TA approval and final flag resolution remain Instructor-only.</p></div>`;
}
function attachRoles() {
  $('#dialog-body').querySelectorAll('input[name="invite-role"]').forEach(radio => radio.addEventListener('change', () => {
    $('#role-description').textContent = roleDescription[radio.value]; $('#ta-permissions').hidden = radio.value !== 'TA';
  }));
}
function selectedRole() { return $('#dialog-body input[name="invite-role"]:checked').value; }
function selectedPermissions() { return Object.fromEntries(['review', 'suggest', 'analytics'].map(key => [key, $(`#dialog-body input[name="permission-${key}"]`).checked])); }
function invite() {
  if (!isOwner()) return;
  showDialog(`<h2 id="dialog-title">Invite person</h2><p class="dialog-lead">Choose access before the person joins PHYS 100.</p><form id="invite-form"><div class="dialog-field"><label for="invite-identity">UBC email or CWL</label><input class="input" id="invite-identity" type="text" required placeholder="name@ubc.ca or CWL" autocomplete="off"><p class="field-note">UBC email works before first sign-in. CWL must match an existing FinanceBot account.</p></div>${roleControls('Student')}<div class="notice-box" id="invite-preview">Student access activates on the matching CWL sign-in. Students need a published course within its term dates.</div><div id="invite-error" class="dialog-error" role="alert"></div>${footer('Create invitation', 'invite-confirm')}</form>`);
  attachRoles();
  $('#dialog-body').querySelectorAll('input[name="invite-role"]').forEach(radio => radio.addEventListener('change', () => { $('#invite-preview').textContent = `${radio.value} access activates on the matching CWL sign-in.${radio.value === 'Student' ? ' Students need a published course within its term dates.' : ' Teaching staff can prepare a draft course.'}`; }));
  const submit = event => {
    event.preventDefault(); const value = $('#invite-identity').value.trim().toLowerCase(); const role = selectedRole();
    const existing = people.find(person => person.email.toLowerCase() === value || person.cwl.toLowerCase() === value && person.cwl);
    if (existing) { $('#invite-error').textContent = `${existing.name} is already in this course. Open their profile to change their role or access.`; return; }
    const account = knownAccounts.find(account => account.cwl === value || account.email === value);
    const validEmail = /^[^\s@]+@(?:[^\s@.]+\.)*ubc\.ca$/i.test(value);
    if (!validEmail && !account) { $('#invite-error').textContent = value.includes('@') ? 'Enter a UBC email address.' : 'This demo CWL is not in the directory. Use a UBC email to invite someone before first sign-in.'; return; }
    const person = { id: nextId++, name: value.split('@')[0].split(/[._-]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '), email: value, cwl: '', puid: '', role, status: 'Pending', source: 'Invitation', login: '', joined: 'Oct 6, 2026', permissions: selectedPermissions() };
    if (account) Object.assign(person, account, { status: 'Active' });
    people.unshift(person); record(person, `${role} invitation created by John Faculty.`); closeDialog();
    $('#search').value = ''; $('#role-filter').value = ''; $('#status-filter').value = ''; setTab(account ? 'people' : 'invitations');
    feedback(account ? `${person.name} added as ${role}. Existing CWL account receives course access immediately.` : `Invitation created for ${value} as ${role}. Pending first CWL login; no email sent in this prototype.`);
  };
  $('#invite-form').addEventListener('submit', submit); $('#invite-confirm').addEventListener('click', submit);
}
function changeRole(person) {
  if (!isOwner() || person.role === 'Owner') return;
  if ($('#inspector').open) $('#inspector').close();
  showDialog(`<h2 id="dialog-title">Change course role</h2><p class="dialog-lead">${safe(person.name)} · ${safe(person.email)}</p>${roleControls(person.role, person.permissions)}<div class="notice-box">${person.status === 'Pending' ? 'The new role and permissions will apply when this invitation activates.' : 'The new role takes effect immediately in this course.'}${person.source.includes('CSV') ? ' The owner override is kept when the roster is imported again.' : ''}${person.status === 'Banned' ? ' This person remains banned until you restore access.' : ''}</div>${footer('Save role', 'role-confirm')}`);
  attachRoles(); $('#role-confirm').addEventListener('click', () => {
    const before = person.role; person.role = selectedRole(); person.permissions = selectedPermissions(); person.override = person.source.includes('CSV');
    record(person, `Role changed from ${before} to ${person.role} by John Faculty.`); closeDialog(); render(); feedback(`${person.name} now has the ${person.role} role${person.status === 'Pending' ? ' when they join' : ' in this course'}.`);
  });
}
function ban(person) {
  if (!isOwner() || person.role === 'Owner') return;
  if ($('#inspector').open) $('#inspector').close();
  showDialog(`<h2 id="dialog-title">Ban from this course?</h2><p class="dialog-lead">${safe(person.name)} · ${safe(person.email)}</p><div class="notice-box danger">This person will lose access to PHYS 100, including access granted by Gradebook, Canvas or a registration code. Other courses are unaffected.</div><div class="dialog-field"><label for="ban-reason">Internal reason <span class="muted">(optional)</span></label><textarea class="input" id="ban-reason" rows="3" placeholder="Record a reason for your teaching team"></textarea></div><p class="field-note">Keep learning history. Re-importing the roster will not lift the course ban.</p>${footer('Ban from course', 'ban-confirm', true)}`);
  $('#ban-confirm').addEventListener('click', () => { person.status = 'Banned'; person.banReason = $('#ban-reason').value.trim(); record(person, 'Course access banned by John Faculty.'); closeDialog(); render(); feedback(`${person.name} is banned from PHYS 100. Learning records are retained.`); });
}
function unban(person) {
  if (!isOwner()) return;
  if ($('#inspector').open) $('#inspector').close();
  showDialog(`<h2 id="dialog-title">Restore course access?</h2><p class="dialog-lead">${safe(person.name)} · ${safe(person.role)}</p><p>Restore this person's ${safe(person.role)} access to PHYS 100. Students still need a published course within its term dates.</p>${footer('Restore access', 'unban-confirm')}`);
  $('#unban-confirm').addEventListener('click', () => { person.status = 'Active'; record(person, 'Course ban lifted by John Faculty.'); closeDialog(); render(); feedback(`Course access restored for ${person.name}.`); });
}
function cancelInvite(person) {
  if (!isOwner()) return;
  if ($('#inspector').open) $('#inspector').close();
  showDialog(`<h2 id="dialog-title">Cancel invitation?</h2><p class="dialog-lead">${safe(person.email)} · ${safe(person.role)}</p><p>This pending invitation will no longer grant course access on first login.</p>${footer('Cancel invitation', 'cancel-confirm', true)}`);
  $('#cancel-confirm').addEventListener('click', () => { people = people.filter(row => row.id !== person.id); closeDialog(); render(); feedback(`Invitation cancelled for ${person.email}.`); });
}
function profile(person) {
  $('#inspector-body').innerHTML = `<div class="profile-intro"><span class="avatar">${safe(initials(person.name))}</span><div><h2 id="inspector-title">${safe(person.name)}</h2>${statusBadge(person.status)}</div></div><p class="dialog-lead">PHYS 100 · Section 222 · Course person</p><dl class="profile-kv"><dt>Email</dt><dd>${safe(person.email)}</dd><dt>CWL</dt><dd>${safe(person.cwl || 'Available after first sign-in')}</dd><dt>Login ID</dt><dd>${safe(person.puid || 'Available after first sign-in')}</dd><dt>Course role</dt><dd>${safe(person.role)}${person.override ? ' · Owner override' : ''}</dd><dt>Access source</dt><dd>${safe(person.source)}</dd><dt>${person.status === 'Pending' ? 'Invited' : 'Added'}</dt><dd>${safe(person.joined)}</dd><dt>Last CWL login</dt><dd>${safe(smallTime(person.login))}</dd><dt>Course term</dt><dd>Winter Term 1, 2026/27</dd></dl>${person.status === 'Banned' ? `<div class="profile-section notice-box danger"><strong>Course access blocked</strong><p>${safe(person.banReason || 'No internal reason recorded.')}</p><small>Importing this person again will not remove the ban.</small></div>` : ''}<section class="profile-section"><h3>Access in this course</h3><p class="field-note">${person.role === 'Owner' ? 'Course ownership is protected. Ownership transfer is a separate action.' : roleDescription[person.role]}</p>${person.role === 'TA' ? `<div class="permission-list">${[['review', 'Review questions and leave notes'], ['suggest', 'Suggest question edits'], ['analytics', 'View student analytics']].map(([key, label]) => `<div class="profile-event">${label}<small>${person.permissions?.[key] === false ? 'Disabled' : 'Enabled'}</small></div>`).join('')}</div><p class="locked-note">Approve questions and resolve flags: Instructor only.</p>` : ''}</section><section class="profile-section"><h3>Access history</h3>${(events.get(person.id) || []).map(event => `<div class="profile-event">${safe(event.text)}<small>${safe(event.time)}</small></div>`).join('')}</section><div class="profile-actions">${person.role === 'Owner' ? '<span class="status-badge">Owner access is protected</span>' : `${ownerButton('Change role', `data-action="role" data-id="${person.id}"`)}<button class="btn btn--secondary ${person.status === 'Active' ? 'danger-button' : ''}" data-action="${person.status === 'Pending' ? 'cancel' : person.status === 'Banned' ? 'unban' : 'ban'}" data-id="${person.id}" ${isOwner() ? '' : 'disabled'}>${person.status === 'Pending' ? 'Cancel invite' : person.status === 'Banned' ? 'Restore access' : 'Ban from course'}</button>`}</div><p class="field-note">Sign-in time is not an online-status indicator.</p>`;
  if (!$('#inspector').open) $('#inspector').showModal();
}
function codeAction(code, action) {
  if (action === 'copy-code') { copy(code.value); return; } if (!isOwner()) return;
  const deleting = action === 'delete-code';
  showDialog(`<h2 id="dialog-title">${deleting ? 'Delete code record?' : 'Revoke unused code?'}</h2><p class="dialog-lead"><code>${safe(code.value)}</code></p><p>${deleting ? `Remove this record from the list.${code.status === 'Unused' ? ' The unused code will stop accepting enrollment.' : ''}` : 'This code will stop accepting enrollment.'} Existing students keep their access.</p>${footer(deleting ? 'Delete record' : 'Revoke code', 'code-confirm', true)}`);
  $('#code-confirm').addEventListener('click', () => { if (deleting) codes = codes.filter(row => row.id !== code.id); else code.status = 'Revoked'; closeDialog(); render(); feedback(deleting ? 'Code record deleted. Student access is unchanged.' : 'Unused code revoked.'); });
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); toast('Copied to clipboard.'); }
  catch { toast(`Select and copy: ${value}`); }
}
function policy() {
  showDialog(`<h2 id="dialog-title">People access rules</h2><p class="dialog-lead">Proposed behavior for the unified People workspace.</p><div class="profile-event"><strong>One person, one course entry</strong><small>Combine Gradebook, Canvas, invitations and code access in this directory.</small></div><div class="profile-event"><strong>Owner controls roles</strong><small>Set a role before invitation; change it later. Imported-role changes keep an explicit owner override.</small></div><div class="profile-event"><strong>Bans apply to this course</strong><small>Retain learning history. Imports and registration codes cannot lift a ban. Platform-wide bans stay with Admin.</small></div><div class="profile-event"><strong>TA permissions stay bounded</strong><small>TA approval and final flag resolution remain unavailable.</small></div><div class="profile-event"><strong>Student access follows release and dates</strong><small>A role or invitation alone does not publish a course or release questions.</small></div><div class="profile-event"><strong>This is an HTML prototype</strong><small>No email, API requests or live role changes occur. Data resets on page reload.</small></div><div class="dialog-actions"><button class="btn btn--instr-primary" data-close>Done</button></div>`);
}
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = ''; if (character === '\r' && text[i + 1] === '\n') i++; }
    else field += character;
  }
  row.push(field); if (row.some(value => value.trim())) rows.push(row); return rows;
}
function importGradebook() {
  if (!isOwner()) return;
  let staged = [];
  showDialog(`<h2 id="dialog-title">Import Gradebook</h2><p class="dialog-lead">Preview Canvas people before updating course access.</p><div class="notice-box">In Canvas: Grades → Export → Export Entire Gradebook. SIS Login ID matches the CWL account. Grade columns are ignored.</div><div class="import-drop"><label for="gradebook-file">Choose a Canvas Gradebook CSV</label><input id="gradebook-file" type="file" accept=".csv,text/csv" style="display:block;max-width:100%;font-size:12px;margin:12px auto 0"></div><button class="text-link" id="sample-import">Load demo Gradebook</button><div class="import-preview" id="import-preview"></div><label class="import-check" hidden id="import-check-label"><input id="import-confirmation" type="checkbox">Replace the previous Gradebook import. Owner role overrides, course bans and other access sources remain.</label><div class="dialog-error" id="import-error" role="alert"></div>${footer('Import students', 'import-confirm')}`);
  $('#import-confirm').disabled = true;
  function preview(rows) {
    staged = rows;
    $('#import-preview').innerHTML = `<strong>${rows.length} students · 0 Instructors · 0 TAs</strong><table><thead><tr><th>Name</th><th>Login ID</th><th>Result</th></tr></thead><tbody>${rows.slice(0, 8).map(row => `<tr><td>${safe(row.name)}</td><td>${safe(row.puid)}</td><td>${people.some(person => person.puid === row.puid) ? 'Existing person' : 'Add student'}</td></tr>`).join('')}</tbody></table><p class="field-note">${rows.length > 8 ? 'First eight rows shown. ' : ''}Gradebook assigns Student only. Use Invite person for teaching staff.</p>`;
    $('#import-check-label').hidden = false; $('#import-confirmation').checked = false; $('#import-confirm').disabled = true;
  }
  $('#sample-import').addEventListener('click', () => preview([{ name: 'Sofia Patel', puid: '87654007' }, { name: 'Riley Adams', puid: '87655001' }, { name: 'Morgan Brooks', puid: '87655002' }]));
  $('#gradebook-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 2000000) { $('#import-error').textContent = 'Choose a CSV smaller than 2 MB for this prototype.'; return; }
    const rows = parseCsv(await file.text()); const headers = (rows.shift() || []).map(value => value.trim().replace(/^\uFEFF/, '').toLowerCase());
    const id = headers.indexOf('sis login id'), name = headers.indexOf('student');
    if (id < 0 || name < 0) { $('#import-error').textContent = 'Use a Gradebook CSV with Student and SIS Login ID columns.'; return; }
    const unique = new Map(); for (const row of rows) if (row[id]?.trim() && row[name]?.trim() && row[name].trim() !== 'Points Possible') unique.set(row[id].trim(), { name: row[name].trim(), puid: row[id].trim() });
    if (!unique.size) { $('#import-error').textContent = 'No usable student rows were found.'; return; }
    $('#import-error').textContent = ''; preview([...unique.values()]);
  });
  $('#import-confirmation').addEventListener('change', () => { $('#import-confirm').disabled = !$('#import-confirmation').checked; });
  $('#import-confirm').addEventListener('click', () => {
    if (!staged.length || !$('#import-confirmation').checked) return;
    const ids = new Set(staged.map(row => row.puid));
    // A prototype snapshot replacement drops prior Gradebook-only members;
    // owner overrides and bans stay visible and are not cleared by imports.
    people = people.filter(person => person.source !== 'Gradebook CSV' || ids.has(person.puid) || person.override || person.status === 'Banned');
    for (const row of staged) {
      const existing = people.find(person => person.puid === row.puid);
      if (existing) { record(existing, 'Included in the updated Gradebook import.'); continue; }
      const person = { id: nextId++, name: row.name, email: 'Available after first sign-in', cwl: '', puid: row.puid, role: 'Student', status: 'Pending', source: 'Gradebook CSV', login: '', joined: 'Oct 6, 2026' };
      people.push(person); record(person, 'Student access imported from Gradebook.');
    }
    closeDialog(); $('#search').value = ''; $('#role-filter').value = ''; $('#status-filter').value = ''; setTab('people'); feedback(`Gradebook import updated with ${staged.length} students. Existing bans and owner overrides were preserved.`);
  });
}
function setupNavigation() {
  const icon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 4a3 3 0 0 1 0 6m4 10v-2a6 6 0 0 0-3-5"/></svg>';
  const groups = [ ['', [['My Courses', '▦'], ['Canvas connection', '↗'], ['Help & Tutorials', '?']]], ['Course workspace', [['Course Dashboard', '⌂'], ['Course Materials', '1'], ['Course Structure', '2'], ['Generate Questions', '3'], ['Review Queue', '4'], ['Question Bank', '5']]], ['Explore & improve', [['Coverage Map', '◇'], ['Student Analytics', '↗'], ['Flags', '!'], ['Import', '⇧']]], ['Course settings', [['Exam Builder', '▤'], ['People', icon], ['Settings', '⚙']]] ];
  $('#sidebar-nav').innerHTML = groups.map(([name, items]) => `<div class="nav__section">${name ? `<div class="nav__group">${name}</div>` : ''}${items.map(([label, glyph]) => `<a class="nav__link ${label === 'People' ? 'nav__link--active' : ''}" href="#people" ${label === 'People' ? 'aria-current="page"' : 'data-preview-nav'} title="${label}"><span class="nav__glyph" aria-hidden="true">${glyph}</span><span class="nav__text">${label}</span></a>`).join('')}</div>`).join('');
}
document.addEventListener('click', event => {
  const button = event.target.closest('button, a'); if (!button) return;
  if (button.id === 'clear-filters') {
    $('#search').value = ''; $('#role-filter').value = ''; $('#status-filter').value = ''; $('#code-filter').value = ''; page = 1; render(); return;
  }
  if (button.hasAttribute('data-close')) { closeDialog(); return; }
  if (button.hasAttribute('data-preview-nav')) { event.preventDefault(); toast('This prototype focuses on the unified People workspace.'); return; }
  if (button.dataset.tab) { setTab(button.dataset.tab); return; }
  if (button.dataset.code) { const code = codes.find(row => row.id === button.dataset.code); if (code) codeAction(code, button.dataset.action); return; }
  const person = people.find(row => row.id === Number(button.dataset.id)); if (!person) return;
  ({ profile, role: changeRole, ban, unban, cancel: cancelInvite })[button.dataset.action]?.(person);
});
for (const id of ['search', 'role-filter', 'status-filter', 'code-filter', 'page-size']) $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', () => { page = 1; render(); });
$('#previous').addEventListener('click', () => { page--; render(); }); $('#next').addEventListener('click', () => { page++; render(); });
$('#invite-open').addEventListener('click', invite); $('#import-open').addEventListener('click', importGradebook); $('#policy-open').addEventListener('click', policy);
$('#viewer').addEventListener('change', () => { if ($('#inspector').open) $('#inspector').close(); if ($('#dialog').open) closeDialog(); render(); toast(isOwner() ? 'Course owner controls enabled.' : 'Instructor view: directory visible, access changes locked.'); });
$('#theme').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
$('#collapse').addEventListener('click', () => { $('#shell').classList.toggle('is-collapsed'); });
$('#mobile-menu').addEventListener('click', () => { $('#shell').classList.toggle('is-open'); }); $('#backdrop').addEventListener('click', () => { $('#shell').classList.remove('is-open'); });
$('#reset').addEventListener('click', () => { seed(); $('#viewer').value = 'owner'; $('#search').value = ''; $('#role-filter').value = ''; $('#status-filter').value = ''; $('#code-filter').value = ''; $('#page-size').value = '10'; setTab('people'); toast('Demo restored. No live data was changed.'); });
$('#notifications').addEventListener('click', () => toast('No notifications in this prototype.'));
$('#share').addEventListener('click', () => { showDialog('<h2 id="dialog-title">Share course link</h2><p class="dialog-lead">Only people already added to this course can open it. Sharing the link does not grant access.</p><label class="field-note" for="share-link">Restricted course link</label><input id="share-link" class="input" style="width:100%;margin-top:8px" readonly value="http://localhost:6118/#/instructor/course/phys100"><div class="dialog-actions"><button class="btn btn--secondary" data-close>Close</button><button class="btn btn--instr-primary" id="copy-share">Copy link</button></div>'); $('#copy-share').addEventListener('click', () => copy($('#share-link').value)); });
$('#generate-form').addEventListener('submit', event => {
  event.preventDefault(); if (!isOwner()) return; const count = Number($('#code-count-input').value); if (!Number.isInteger(count) || count < 1 || count > 50) { feedback('Enter a number from 1 to 50.'); return; }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < count; i++) { const random = crypto.getRandomValues(new Uint8Array(12)); codes.unshift({ id: `c${nextId++}`, value: Array.from(random, value => alphabet[value % alphabet.length]).join(''), status: 'Unused', person: '', created: 'Oct 6 · just now' }); }
  page = 1; $('#code-filter').value = ''; render(); feedback(`${count} one-time student codes generated in this prototype.`);
});
$('.people-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = ['people', 'invitations', 'codes']; const current = tabs.indexOf(tab);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (current + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
  event.preventDefault(); setTab(tabs[index]); $(`#tab-${tabs[index]}`).focus();
});
seed(); setupNavigation(); setTab('people');
