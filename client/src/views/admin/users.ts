import { attachTutorial } from '../../tutorials.js';
import {
  ApiError, assignAdminCourseRole, listAdminUsers, listAdminAccounts, listAdminCourses,
  grantPlatformInstructor, revokePlatformInstructor, removeAdminCourseRole, setAdminUserActive,
  grantPlatformAdmin, revokePlatformAdmin, saveCwlAssignment, cancelPlatformCwlAssignment,
  type AdminAccount, type AdminCourseOption, type AdminDirectoryUser, type CourseRole,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { inviteCoursePerson } from '../../course-people-api.js';
import { runButtonAction } from '../../action-state.js';
import { confirmDialog } from '../../modal.js';
import { currentQuery, type RouteParams } from '../../router.js';
import { emptyState, errorState, loadingState } from '../../ui.js';

const roleName = (role: CourseRole): string => role === 'ta' ? 'TA' : role === 'instructor' ? 'Instructor' : 'Student';
const message = (error: unknown): string => error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The request could not be completed.';
const date = (value?: string): string => value ? new Date(value).toLocaleString() : 'Not recorded';
const badge = (text: string, tone = ''): HTMLElement => el('span', { class: `ac-badge ${tone ? `ac-badge--${tone}` : ''}`, text });

type DirectoryPerson = AdminDirectoryUser & { platformInstructor: boolean; adminGrant?: boolean; pendingCwl?: string; pending: boolean; grantedAt?: string };
const hasStudentIdentity = (user: AdminDirectoryUser): boolean => (user.affiliations ?? []).some(value => value.trim().toLowerCase() === 'student');
const defaultWorkspace = (user: DirectoryPerson): string => user.pending ? 'Pending first login' : user.deactivatedAt ? 'Banned' : user.isAdmin ? 'Admin' : user.platformInstructor || user.courseRoles.some(r => r.role === 'instructor') ? 'Instructor' : user.courseRoles.some(r => r.role === 'ta') ? 'TA' : 'Student';
const personStatus = (user: DirectoryPerson): string => user.pending ? 'Pending first login' : user.deactivatedAt ? 'Banned' : 'Active';

function mergePeople(directory: AdminDirectoryUser[], accounts: AdminAccount[], search = ''): DirectoryPerson[] {
  const byPuid = new Map(accounts.map(account => [account.puid, account]));
  const needle = search.toLowerCase();
  return [
    ...directory.map(user => {
      const account = byPuid.get(user.puid);
      return { ...user, pending: false, isAdmin: account?.isAdmin ?? user.isAdmin, adminGrant: account?.adminGrant,
        platformInstructor: account?.platformInstructor ?? false, grantedAt: account?.grantedAt };
    }),
    ...accounts.filter(account => account.status === 'pending' && !directory.some(user => user.puid === account.puid)
      && account.puid.toLowerCase().includes(needle)).map(account => ({
      ...account, _id: '', courseRoles: [], lastLoginAt: '', pending: true,
    })),
  ];
}

async function renderInner(outlet: HTMLElement): Promise<void> {
  const query = currentQuery();
  const root = el('div', { class: 'view view--admin admin-console admin-people' });
  const metrics = el('div', { class: 'ac-metrics', 'aria-label': 'Loaded directory summary' });
  const status = el('div', { class: 'ac-feedback', role: 'status', 'aria-live': 'polite' });
  const search = el('input', { class: 'input', id: 'admin-directory-search', type: 'search', maxlength: '100', placeholder: 'Name, email, Login ID (PUID) or CWL username', 'aria-label': 'Search users' });
  search.value = query.get('puid') || '';
  const accountFilter = el('select', { class: 'input', 'aria-label': 'Account status' },
    el('option', { value: '', text: 'All statuses' }), el('option', { value: 'active', text: 'Active' }), el('option', { value: 'deactivated', text: 'Banned' }), el('option', { value: 'pending', text: 'Pending first login' }));
  const roleFilter = el('select', { class: 'input', 'aria-label': 'User role' },
    el('option', { value: '', text: 'All roles' }), el('option', { value: 'admin', text: 'Admin' }),
    ...(['instructor', 'ta', 'student'] as CourseRole[]).map(role => el('option', { value: role, text: roleName(role) })));
  const tableSlot = el('div', { class: 'ac-table-scroll admin-user-list', tabindex: '0', role: 'region', 'aria-label': 'Users table' }, loadingState('Loading users…'));
  const footer = el('div', { class: 'ac-footer' });
  const inspectorSlot = el('div', { class: 'ac-people-inspector-slot' });
  let users: DirectoryPerson[] = [];
  let selected: DirectoryPerson | undefined;
  let detailTab: 'Profile' | 'Course access' = 'Profile';
  let generation = 0;
  let page = 1;
  let ascending = true;
  let loaded = false;
  let mutating = false;
  let needsRefresh = false;
  let roleDraft = { puid: '', courseId: '', role: 'student' as CourseRole };
  let courses: AdminCourseOption[] | undefined;
  let coursesLoading = false;
  let coursesError = '';
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let grantMenuId = 0;
  const pageSize = 20;

  const report = (error: unknown): void => { status.textContent = message(error); status.classList.add('ac-feedback--error'); };
  const notice = (text: string): void => { status.textContent = text; status.classList.remove('ac-feedback--error'); };
  function visibleUsers(): DirectoryPerson[] {
    return users.filter(user => (!accountFilter.value || (accountFilter.value === 'pending' ? user.pending
      : accountFilter.value === 'deactivated' ? Boolean(user.deactivatedAt) : !user.pending && !user.deactivatedAt))
      && (!roleFilter.value || (roleFilter.value === 'admin' ? user.isAdmin
        : roleFilter.value === 'instructor' && user.platformInstructor || roleFilter.value === 'student' && (hasStudentIdentity(user) || defaultWorkspace(user) === 'Student') || user.courseRoles.some(entry => entry.role === roleFilter.value))))
      .sort((a, b) => (a.displayName || a.puid).localeCompare(b.displayName || b.puid) * (ascending ? 1 : -1));
  }
  function renderMetrics(): void {
    metrics.replaceChildren(...[
      [users.length, 'Loaded people'], [users.filter(user => user.platformInstructor).length, 'Instructor grants'],
      [users.filter(user => user.pending).length, 'Pending first login'],
      [users.filter(user => user.deactivatedAt).length, 'Banned'],
    ].map(([value, label]) => el('div', { class: 'ac-metric' }, el('strong', { text: String(value) }), el('span', { text: String(label) }))));
  }
  function closeInspector(): void {
    const previous = selected?.puid;
    selected = undefined;
    renderInspector(); renderTable();
    Array.from(tableSlot.querySelectorAll<HTMLButtonElement>('button[data-person]')).find(button => button.dataset.person === previous)?.focus();
  }
  function inspect(user: DirectoryPerson, tab: typeof detailTab = 'Profile'): void {
    selected = user; detailTab = tab; renderTable(); renderInspector();
    if (tab === 'Course access') void loadCourses();
    inspectorSlot.querySelector<HTMLButtonElement>('[aria-label="Close user details"]')?.focus();
  }
  function renderTable(): void {
    const filtered = visibleUsers();
    page = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
    const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
    const table = el('table', { class: 'ac-table ac-people-table' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', 'aria-sort': ascending ? 'ascending' : 'descending' }, el('button', { class: 'ac-sort', type: 'button', text: `Person ${ascending ? '↑' : '↓'}`, onclick: () => { ascending = !ascending; renderTable(); } })),
        el('th', { scope: 'col', class: 'ac-people-roles', text: 'Roles' }),
        el('th', { scope: 'col', class: 'ac-people-courses', text: 'Courses' }),
        el('th', { scope: 'col', text: 'Status' }),
        el('th', { scope: 'col', class: 'ac-people-access', text: 'Manage access' }),
      )), el('tbody', {}, ...slice.map(user => {
        const roles = [...new Set(user.courseRoles.map(entry => `Course ${roleName(entry.role)}`))];
        return el('tr', { class: selected?.puid === user.puid ? 'is-selected' : '' },
          el('td', {}, el('div', { class: 'ac-person' },
            el('span', { class: 'ac-person-avatar', 'aria-hidden': 'true', text: (user.displayName || user.puid).split(/\s+/).slice(0, 2).map(value => value[0]).join('').toUpperCase() }),
            el('div', { class: 'ac-person-copy' },
              el('button', { type: 'button', class: 'ac-cell-link', 'data-person': user.puid, text: user.displayName || user.puid, onclick: () => inspect(user) }),
              el('small', { text: user.email || 'Email not released' }),
              el('small', { class: 'ac-person-login' }, user.pendingCwl ? 'CWL username: ' : 'Login ID (PUID): ',
                el('code', { text: user.pendingCwl || user.puid }))))),
          el('td', { class: 'ac-people-roles' }, user.isAdmin ? badge('Admin', 'info') : false, user.platformInstructor ? badge('Instructor', 'info') : false, hasStudentIdentity(user) ? el('span', { class: 'ac-badge', text: 'Student (CWL)', title: 'Student affiliation reported by CWL. Course access is shown separately.' }) : false, ...roles.map(role => badge(role)), !roles.length && !hasStudentIdentity(user) && defaultWorkspace(user) === 'Student' ? el('span', { class: 'ac-badge', text: 'Student workspace', title: 'Default Student workspace for this account. This is not a course membership or a CWL affiliation claim.' }) : false, !roles.length && !user.isAdmin && !user.platformInstructor && !hasStudentIdentity(user) && defaultWorkspace(user) !== 'Student' ? 'No roles' : false),
          el('td', { class: 'ac-people-courses', text: String(new Set(user.courseRoles.map(entry => entry.courseId)).size) }),
          el('td', {}, badge(personStatus(user), user.deactivatedAt ? 'danger' : user.pending ? 'warning' : 'success')),
          el('td', { class: 'ac-people-access' }, accessActions(user)));
      })));
    tableSlot.replaceChildren(filtered.length ? table : emptyState('No users match. Try a different search or clear the filters.'));
    footer.replaceChildren(el('span', { text: filtered.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length} matching people` : '0 matching people' }),
      el('span', { class: 'ac-people-limit', text: users.length >= 200 ? 'Latest 200 matches · narrow your search for more' : 'Includes grants awaiting first CWL sign-in' }),
      el('div', { class: 'ac-actions' },
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Previous', disabled: page <= 1, onclick: () => { page--; renderTable(); tableSlot.scrollTop = 0; } }),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Next', disabled: page * pageSize >= filtered.length, onclick: () => { page++; renderTable(); tableSlot.scrollTop = 0; } })));
  }
  function properties(items: Array<[string, string]>): HTMLElement {
    return el('dl', { class: 'ac-people-properties' }, ...items.flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]));
  }
  async function refreshSelected(): Promise<void> {
    if (!selected) return;
    const puid = selected.puid;
    const [directory, accounts] = await Promise.all([listAdminUsers({ q: puid }), listAdminAccounts()]);
    if (!root.isConnected || selected?.puid !== puid) return;
    selected = mergePeople(directory, accounts, puid).find(user => user.puid === puid);
  }
  async function mutate(action: () => Promise<unknown>, success: string): Promise<void> {
    if (mutating || needsRefresh) return;
    mutating = true;
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('[data-mutation], .ac-panel input, .ac-panel select').forEach(control => { control.disabled = true; });
    try {
      await action(); if (success) notice(success);
      needsRefresh = true;
      await refreshSelected();
      await load(false);
    } catch (error) {
      report(error);
      if (needsRefresh) tableSlot.replaceChildren(errorState('Access may have changed. Refresh the directory before making another change.', () => void load()));
    }
    finally { mutating = false; if (root.isConnected) { if (!needsRefresh) renderTable(); renderInspector(); } }
  }
  function accessActions(user: DirectoryPerson, location: 'row' | 'profile' = 'row'): HTMLElement {
    const menuId = `grant-role-${++grantMenuId}`;
    const trigger = el('button', {
      class: 'btn btn--secondary btn--sm ac-grant-trigger', type: 'button', 'data-mutation': 'true',
      'data-grant-person': user.puid, 'data-grant-location': location,
      'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId,
      popovertarget: menuId,
      disabled: mutating || needsRefresh || Boolean(user.deactivatedAt) && !user.platformInstructor && !user.adminGrant,
    }, 'Grant', el('span', { 'aria-hidden': 'true', text: '⌄' }));
    const menu = el('div', { class: 'ac-grant-menu', id: menuId, popover: 'auto', role: 'menu', 'aria-label': `Grant role for ${user.displayName || user.puid}` });
    const close = (restoreFocus = false): void => {
      if (menu.matches(':popover-open')) menu.hidePopover();
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    };
    const enabledItems = (): HTMLButtonElement[] => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const open = (last = false): void => {
      if (trigger.disabled || mutating || needsRefresh) return;
      menu.showPopover();
      const anchor = trigger.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
      const top = anchor.bottom + 6 + bounds.height <= window.innerHeight - 8 ? anchor.bottom + 6 : anchor.top - bounds.height - 6;
      menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`;
      trigger.setAttribute('aria-expanded', 'true');
      const items = enabledItems();
      items[last ? items.length - 1 : 0]?.focus();
    };
    trigger.addEventListener('click', event => {
      event.preventDefault();
      if (menu.matches(':popover-open')) close(true);
      else open();
    });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(event.key === 'ArrowUp'); }
    });
    menu.addEventListener('beforetoggle', event => {
      if ((event as ToggleEvent).newState === 'closed') trigger.setAttribute('aria-expanded', 'false');
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key === 'Tab') { close(true); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = enabledItems();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    });
    async function changeInstructor(): Promise<void> {
      close();
      await runButtonAction(trigger, () => mutate(async () => {
        if (user.platformInstructor) {
          if (!await confirmDialog({ title: 'Revoke Instructor access?', message: user.pending
            ? `The saved grant for ${user.pendingCwl || user.puid} will no longer activate on sign-in.`
            : `Remove course-creation access for ${user.displayName || user.puid}? Existing course roles and Admin access remain.`, confirmLabel: 'Revoke access', tone: 'danger' })) return;
          if (user.pendingCwl) await cancelPlatformCwlAssignment(user.pendingCwl, 'platform-instructor');
          else await revokePlatformInstructor(user.puid);
          notice('Instructor access revoked.');
        } else {
          await grantPlatformInstructor(user.puid); notice('Instructor access granted.');
        }
      }, ''));
      if (!root.isConnected) return;
      Array.from(root.querySelectorAll<HTMLButtonElement>('.ac-grant-trigger')).find(button =>
        button.dataset.grantPerson === user.puid && button.dataset.grantLocation === location)?.focus();
    }
    const grant = el('button', {
      class: `ac-grant-option${user.platformInstructor ? ' ac-grant-option--revoke' : ''}`, type: 'button', role: 'menuitem', 'data-mutation': 'true',
      'aria-label': user.platformInstructor ? 'Revoke Instructor' : 'Grant Instructor',
      disabled: mutating || needsRefresh || Boolean(user.deactivatedAt) && !user.platformInstructor,
      onclick: changeInstructor,
    }, el('span', { text: user.platformInstructor ? 'Revoke Instructor' : 'Instructor' }),
    el('small', { text: user.platformInstructor ? 'Remove course creation access' : 'Allow course creation' }));
    if (user.adminGrant) menu.append(el('button', {
      class: 'ac-grant-option ac-grant-option--revoke', type: 'button', role: 'menuitem', 'data-mutation': 'true',
      disabled: mutating || needsRefresh,
      onclick: async () => {
        close(true);
        if (!await confirmDialog({ title: 'Revoke Admin access?', message: `Remove the Admin grant for ${user.displayName || user.puid}?`, confirmLabel: 'Revoke Admin', tone: 'danger' })) return;
        await mutate(() => user.pendingCwl ? cancelPlatformCwlAssignment(user.pendingCwl, 'admin') : revokePlatformAdmin(user.puid), 'Admin grant revoked.');
      },
    }, 'Revoke Admin'));
    if (!user.pendingCwl || user.platformInstructor) menu.append(grant);
    menu.append(
      ...(['ta', 'student'] as const).map(role => el('button', {
        class: 'ac-grant-option', type: 'button', role: 'menuitem', 'data-mutation': 'true', 'aria-label': `Grant ${roleName(role)}`,
        disabled: mutating || needsRefresh || user.pending || Boolean(user.deactivatedAt),
        onclick: () => { close(); if (mutating || needsRefresh) return; roleDraft = { puid: user.puid, courseId: '', role }; inspect(user, 'Course access'); },
      }, el('span', { text: roleName(role) }), el('small', { text: user.pending ? 'Available after first login' : 'Choose a course' }))),
    );
    return el('div', { class: 'ac-person-actions', role: 'group', 'aria-label': `Manage access for ${user.displayName || user.puid}` }, trigger, menu,
      user.pending || user.isAdmin ? false : banButton(user));
  }
  function banButton(user: DirectoryPerson): HTMLButtonElement {
    return el('button', {
      class: user.deactivatedAt ? 'btn btn--secondary btn--sm' : 'btn btn--danger btn--sm', type: 'button', 'data-mutation': 'true', disabled: mutating || needsRefresh,
      text: user.deactivatedAt ? 'Unban user' : 'Ban user',
      onclick: () => mutate(async () => {
        if (!await confirmDialog({ title: `${user.deactivatedAt ? 'Unban' : 'Ban'} ${user.displayName || user.puid}?`,
          message: user.deactivatedAt ? 'Platform access and previously assigned roles will become available again.' : 'This blocks all platform access. Questions, course roles and historical records are retained.',
          confirmLabel: user.deactivatedAt ? 'Unban user' : 'Ban user', tone: user.deactivatedAt ? 'default' : 'danger' })) return;
        await setAdminUserActive(user.puid, Boolean(user.deactivatedAt)); notice(user.deactivatedAt ? 'User unbanned.' : 'User banned.');
      }, ''),
    });
  }
  async function loadCourses(): Promise<void> {
    if (courses || coursesLoading) return;
    coursesLoading = true; coursesError = ''; renderInspector();
    try { courses = await listAdminCourses(); }
    catch (error) { coursesError = message(error); }
    finally { coursesLoading = false; if (root.isConnected) renderInspector(); }
  }
  async function removeRole(user: DirectoryPerson, entry: AdminDirectoryUser['courseRoles'][number]): Promise<void> {
    await mutate(async () => {
      if (!await confirmDialog({ title: 'Remove course role?', message: `Remove ${roleName(entry.role)} access to course ${entry.courseId} for ${user.displayName || user.puid}? Historical records remain.`, confirmLabel: 'Remove role', tone: 'danger' })) return;
      try {
        const result = await removeAdminCourseRole(user.puid, entry.courseId, entry.role);
        if (result.warning === 'orphans-course') throw new ApiError('orphans-course', 409);
      } catch (error) {
        // This endpoint returns { warning: 'orphans-course' } with HTTP 409.
        if (!(error instanceof ApiError) || (error.status !== 409 && error.message !== 'orphans-course')) throw error;
        if (!await confirmDialog({ title: 'Leave course without an instructor?', message: 'This is the final Instructor role. Assign another Instructor first, or explicitly confirm leaving this course without an Instructor.', confirmLabel: 'Remove final Instructor', tone: 'danger' })) { notice('Course role kept.'); return; }
        await removeAdminCourseRole(user.puid, entry.courseId, entry.role, true);
      }
      notice(`${roleName(entry.role)} role removed.`);
    }, '');
  }
  function renderInspector(): void {
    root.classList.toggle('has-inspector', Boolean(selected));
    if (!selected) { inspectorSlot.replaceChildren(); return; }
    const user = selected;
    const focused = inspectorSlot.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    const tabs = el('div', { class: 'ac-tabs', role: 'tablist', 'aria-label': 'User details' });
    (['Profile', 'Course access'] as const).forEach((tab, index) => {
      const button = el('button', { type: 'button', role: 'tab', id: `user-detail-tab-${index}`, 'aria-controls': 'user-detail-content', 'aria-selected': detailTab === tab, tabindex: detailTab === tab ? '0' : '-1', text: tab,
        onclick: () => { detailTab = tab; renderInspector(); if (tab === 'Course access') void loadCourses(); inspectorSlot.querySelector<HTMLButtonElement>(`#user-detail-tab-${index}`)?.focus(); },
        onkeydown: (event: KeyboardEvent) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; detailTab = next ? 'Course access' : 'Profile'; renderInspector(); if (detailTab === 'Course access') void loadCourses(); inspectorSlot.querySelector<HTMLButtonElement>(`#user-detail-tab-${next}`)?.focus(); } },
      }); tabs.append(button);
    });
    const content = el('div', { class: 'ac-panel-body', id: 'user-detail-content', role: 'tabpanel', 'aria-labelledby': `user-detail-tab-${detailTab === 'Profile' ? '0' : '1'}` });
    if (detailTab === 'Profile') {
      content.append(el('div', { class: 'ac-people-section ac-actions' }, badge(personStatus(user), user.deactivatedAt ? 'danger' : user.pending ? 'warning' : 'success'), user.isAdmin ? badge('Admin', 'info') : ''),
        properties([['Login ID (PUID)', user.pendingCwl ? 'Assigned at matching CWL sign-in' : user.puid], ['CWL username', user.uid || 'Not released'], ['Email', user.email || 'Not released'], ['Last sign-in', date(user.lastLoginAt)], ['Affiliations', user.affiliations.join(', ') || 'Not released']]),
        ...(user.pendingCwl ? [] : [el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Copy Login ID', onclick: async () => {
          try { await navigator.clipboard.writeText(user.puid); notice('Login ID copied.'); }
          catch { notice('Unable to copy. Select the Login ID above and copy it manually.'); }
        } }),
        el('p', { class: 'ac-note', text: user.pending ? 'Provisioned PUID; awaiting first CWL sign-in.' : 'Identity received from CWL (ubcEduCwlPuid). Student (CWL) describes affiliation; Course Student describes course access from manual, People, Gradebook or Canvas grants. Student workspace indicates the default app workspace when CWL has not released student affiliation; it does not grant course access.' }),
        el('h3', { class: 'ac-people-section-title', text: 'Investigation' }),
        el('a', { class: 'ac-people-link', text: 'View activity →', href: `#/admin/operations?actor=${encodeURIComponent(user.puid)}` }),
        el('a', { class: 'ac-people-link', text: 'Created questions →', href: `#/admin/questions?actor=${encodeURIComponent(user.puid)}` })]),
        el('h3', { class: 'ac-people-section-title', text: 'Manage access' }),
        el('p', { class: 'ac-note', text: 'Instructor grants allow course creation. TA and Student access apply to the course you choose. Multiple roles can coexist.' }),
        accessActions(user, 'profile'),
        user.platformInstructor ? el('p', { class: 'ac-note', text: `Instructor grant: ${user.pending ? 'pending first login' : user.deactivatedAt ? 'blocked while banned' : 'active'} · Granted ${date(user.grantedAt)}` }) : '',
        user.pending ? el('p', { class: 'ac-people-callout', text: user.pendingCwl
          ? 'This assignment is waiting for a matching CWL sign-in.'
          : 'This PUID has not signed in. Saved platform grants activate at the first matching CWL sign-in.' }) : '',
        user.deactivatedAt ? el('p', { class: 'ac-people-callout', text: 'This user is banned. All platform access is blocked until you unban them; existing roles and records are retained.' }) : '',
        user.isAdmin ? el('p', { class: 'ac-note', text: 'Admin accounts cannot be banned from this directory.' }) : '');
    } else {
      content.append(el('p', { class: 'ac-note', text: 'Choose the course that this role should apply to. Platform Instructor grants allow course creation.' }),
        el('h3', { class: 'ac-people-section-title', text: `Assigned roles (${user.courseRoles.length})` }));
      content.append(...(user.courseRoles.length ? user.courseRoles.map(entry => el('div', { class: 'ac-people-course-role' },
        el('div', {}, badge(roleName(entry.role)), el('span', { class: 'mono', text: entry.courseId })),
        user.syncedCourseRoles?.some(role => role.courseId === entry.courseId && role.role === entry.role)
          ? el('a', { class: 'ac-people-link', href: `#/instructor/course/${entry.courseId}/people`, text: 'Manage in People', title: 'This role comes from Gradebook or Canvas. Use course People to change or remove access.' })
          : el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-mutation': 'true', disabled: mutating || needsRefresh, text: 'Remove', 'aria-label': `Remove ${roleName(entry.role)} from ${entry.courseId}`, onclick: () => removeRole(user, entry) }))) : [el('p', { class: 'ac-note', text: 'No course roles assigned.' })]));
      if (roleDraft.puid !== user.puid) roleDraft = { puid: user.puid, courseId: '', role: 'student' };
      const courseId = el('select', { class: 'input', required: 'required', 'aria-label': 'Course', disabled: mutating || needsRefresh || user.pending || Boolean(user.deactivatedAt) || !courses?.length },
        el('option', { value: '', text: coursesLoading ? 'Loading courses…' : 'Choose a course' }),
        ...(courses ?? []).map(course => el('option', { value: course._id, text: `${course.courseCode} · ${course.name}${course.section ? ` · ${course.section}` : ''} · ${course.term}${course.lifecycle === 'archived' ? ' (Archived)' : ''}` })));
      const role = el('select', { class: 'input', 'aria-label': 'Course role', disabled: mutating || needsRefresh || user.pending || Boolean(user.deactivatedAt) }, ...(['student', 'ta', 'instructor'] as CourseRole[]).map(value => el('option', { value, text: roleName(value) })));
      courseId.value = roleDraft.courseId; role.value = roleDraft.role;
      courseId.addEventListener('change', () => { roleDraft.courseId = courseId.value; });
      role.addEventListener('change', () => { roleDraft.role = role.value as CourseRole; });
      content.append(el('form', { class: 'ac-people-role-form', onsubmit: (event: Event) => {
        event.preventDefault(); const targetId = courseId.value; const targetRole = role.value as CourseRole;
        if (mutating || needsRefresh || user.pending || user.deactivatedAt || !courses?.some(course => course._id === targetId)) return;
        if (user.courseRoles.some(entry => entry.courseId === targetId && entry.role === targetRole)) { report(new Error('This user already has that role in this course.')); return; }
        return mutate(async () => {
          await assignAdminCourseRole(user.puid, targetId, targetRole);
          roleDraft = { puid: user.puid, courseId: '', role: 'student' };
        }, `${roleName(targetRole)} role assigned.`);
      } }, el('h3', { class: 'ac-people-section-title', text: 'Assign a role' }),
      el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Course' }), courseId),
      el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Course role' }), role),
      el('button', { class: 'btn btn--secondary btn--sm', type: 'submit', 'data-mutation': 'true', disabled: mutating || needsRefresh || user.pending || Boolean(user.deactivatedAt) || !courses?.length, text: 'Assign course role' })));
      if (coursesError) content.append(errorState(coursesError, () => void loadCourses()));
      if (courses && !courses.length) content.append(el('p', { class: 'ac-note', text: 'No courses are available yet.' }));
      if (user.pending || user.deactivatedAt) content.append(el('p', { class: 'ac-people-callout', text: user.pending ? 'Course roles are available after the first CWL sign-in.' : 'Unban this user before granting course access.' }));
    }
    inspectorSlot.replaceChildren(el('aside', { class: 'ac-panel', 'aria-label': 'User details', onkeydown: (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeInspector(); } } },
      el('div', { class: 'ac-panel-header' }, el('div', {}, el('span', { class: 'ac-eyebrow', text: 'User details' }), el('h2', { text: user.displayName || user.puid })),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '×', 'aria-label': 'Close user details', onclick: closeInspector })),
      tabs, content, el('div', { class: 'ac-panel-footer' }, el('span', { class: 'ac-note', text: 'Changes take effect immediately.' }))));
    if (focused) {
      Array.from(inspectorSlot.querySelectorAll<HTMLElement>('button, select, input, a')).find(control =>
        focused.id ? control.id === focused.id : focused.getAttribute('aria-label')
          ? control.getAttribute('aria-label') === focused.getAttribute('aria-label')
          : control.tagName === focused.tagName && control.textContent === focused.textContent)?.focus();
    }
  }
  async function load(showLoading = true): Promise<void> {
    const request = ++generation;
    if (showLoading) tableSlot.replaceChildren(loadingState('Loading users…'));
    try {
      const needle = search.value.trim();
      const [directory, accounts] = await Promise.all([listAdminUsers({ q: needle }), listAdminAccounts()]);
      const result = mergePeople(directory, accounts, needle);
      if (request !== generation || !root.isConnected) return;
      users = result; loaded = true; needsRefresh = false;
      if (!selected && query.get('puid')) { selected = users.find(user => user.puid === query.get('puid')); query.delete('puid'); }
      if (selected) selected = users.find(user => user.puid === selected?.puid) ?? selected;
      renderMetrics(); renderTable(); renderInspector();
    } catch (error) {
      if (request !== generation || !root.isConnected) return;
      tableSlot.replaceChildren(errorState(message(error), () => void load()));
      if (!showLoading) throw error;
    }
  }
  function openAdvanceGrant(): void {
    const opener = document.activeElement;
    const dialog = el('dialog', { class: 'app-dialog ac-people-dialog', 'aria-labelledby': 'advance-grant-title' });
    const role = el('select', { class: 'input', 'aria-label': 'Role to grant', required: true },
      el('option', { value: '', text: 'Choose a role' }),
      el('optgroup', { label: 'Platform access' },
        el('option', { value: 'admin', text: 'Admin' }),
        el('option', { value: 'platform-instructor', text: 'Platform Instructor (can create courses)' })),
      el('optgroup', { label: 'Access to an existing course' },
        ...(['instructor', 'ta', 'student'] as const).map(value => el('option', { value, text: `Course ${roleName(value)}` }))));
    const isPlatformRole = () => role.value === 'admin' || role.value === 'platform-instructor';
    const course = el('select', { class: 'input', 'aria-label': 'Course', disabled: true });
    const courseField = el('label', { class: 'form-field', hidden: true },
      el('span', { class: 'form-field__label', text: 'Course' }), course);
    const method = el('select', { class: 'input', 'aria-label': 'Identify recipient by', disabled: true },
      el('option', { value: 'cwl', text: 'CWL username' }),
      el('option', { value: 'puid', text: 'Login ID (PUID)' }),
      el('option', { value: 'email', text: 'UBC email' }));
    const methodField = el('label', { class: 'form-field', hidden: true },
      el('span', { class: 'form-field__label', text: 'Identify recipient by' }), method);
    const identifier = el('input', { id: 'advance-grant-identity', class: 'input', required: true, disabled: true, autocomplete: 'off', 'aria-describedby': 'advance-grant-help' });
    const identityLabel = el('label', { class: 'form-field__label', for: identifier.id });
    const help = el('p', { class: 'ac-note', id: 'advance-grant-help' });
    const identityField = el('div', { class: 'form-field', hidden: true }, identityLabel, identifier, help);
    const error = el('div', { class: 'ac-feedback ac-feedback--error', role: 'alert' });
    const save = el('button', { class: 'btn btn--primary', type: 'submit', text: 'Save grant', disabled: true });
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: () => dialog.close() });
    let saving = false;
    let request = 0;

    function updateIdentity(): void {
      const byPuid = method.value === 'puid';
      const byCwl = method.value === 'cwl';
      identifier.value = '';
      identifier.disabled = identityField.hidden = !role.value;
      method.disabled = methodField.hidden = !role.value;
      identityLabel.textContent = byPuid ? 'Login ID (PUID)' : byCwl ? 'CWL username' : 'UBC email';
      identifier.maxLength = byPuid ? 128 : byCwl ? 64 : 254;
      if (byPuid || byCwl) identifier.pattern = byPuid ? '[A-Za-z0-9._\\-]+' : '[A-Za-z0-9._\\-]{2,64}';
      else identifier.removeAttribute('pattern');
      help.textContent = byPuid ? 'Enter the exact UBC PUID. Access activates at the matching CWL sign-in.'
        : byCwl ? 'The role activates when UBC sign-in returns this CWL username. The person can sign in for the first time after you save.'
          : 'The role activates when CWL returns this UBC email. No email is sent.';
      error.textContent = '';
    }
    method.addEventListener('change', updateIdentity);
    role.addEventListener('change', async () => {
      const revision = ++request;
      const platform = isPlatformRole();
      const courseRole = !!role.value && !platform;
      mount(method, el('option', { value: 'cwl', text: 'CWL username' }),
        el('option', { value: platform ? 'puid' : 'email', text: platform ? 'Login ID (PUID)' : 'UBC email' }));
      updateIdentity();
      course.disabled = courseField.hidden = !courseRole;
      course.required = courseRole;
      save.disabled = !platform;
      if (!courseRole) return;
      mount(course, el('option', { value: '', text: 'Loading courses…' }));
      try {
        courses ??= await listAdminCourses();
        if (request !== revision || !dialog.open) return;
        const available = courses.filter(item => item.lifecycle !== 'archived');
        mount(course, el('option', { value: '', text: available.length ? 'Choose a course' : 'No courses available' }),
          ...available.map(item => el('option', { value: item._id, text: [item.courseCode, item.name, item.section, item.term].filter(Boolean).join(' · ') })));
        save.disabled = !available.length;
      } catch (failure) {
        if (request === revision && dialog.open) {
          mount(course, el('option', { value: '', text: 'Courses unavailable' }));
          error.textContent = `${message(failure)} Reopen this dialog to retry.`;
        }
      }
    });
    const fields = el('fieldset', { class: 'admin-account-create' },
      el('label', { class: 'form-field' }, el('span', { class: 'form-field__label', text: 'Role' }), role),
      courseField, methodField, identityField);
    const form = el('form', { class: 'admin-account-create', onsubmit: async (event: Event) => {
      event.preventDefault();
      if (saving || save.disabled || !role.value) return;
      saving = fields.disabled = cancel.disabled = save.disabled = true;
      error.textContent = '';
      try {
        const value = identifier.value.trim();
        const platform = isPlatformRole();
        const admin = role.value === 'admin';
        const byCwl = method.value === 'cwl';
        const recipient = `${byCwl ? 'CWL' : 'Login ID'} ${value}`;
        if (platform && !await confirmDialog({
          title: admin ? 'Grant platform Admin?' : 'Grant Platform Instructor?',
          message: admin ? `Grant full platform access to ${recipient}?` : `Allow ${recipient} to create courses?`,
          confirmLabel: admin ? 'Grant Admin' : 'Grant Instructor',
        })) return;
        if (!dialog.open || !root.isConnected) return;
        const result = byCwl
          ? await saveCwlAssignment(value, platform ? { role: admin ? 'admin' : 'platform-instructor' } : { role: role.value as CourseRole, courseId: course.value })
          : platform ? await (admin ? grantPlatformAdmin(value) : grantPlatformInstructor(value))
          : await inviteCoursePerson(course.value, value, role.value as CourseRole, {});
        if (!dialog.open || !root.isConnected) return;
        dialog.close();
        notice(result.status === 'pending'
          ? platform ? `${admin ? 'Admin' : 'Platform Instructor'} grant saved. Access starts at the matching CWL sign-in.`
            : 'Course invitation saved. Access starts at the matching CWL sign-in. Manage the invitation in Course Settings → People.'
          : 'Role saved.');
        await load();
      } catch (failure) {
        error.textContent = message(failure);
      } finally {
        saving = fields.disabled = cancel.disabled = save.disabled = false;
      }
    } }, fields, error, el('div', { class: 'app-dialog__actions' }, cancel, save));
    dialog.append(el('div', { class: 'app-dialog__surface' }, el('h2', { id: 'advance-grant-title', text: 'Grant before first login' }), form));
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    const routeChanged = () => dialog.close();
    dialog.addEventListener('close', () => {
      window.removeEventListener('hashchange', routeChanged);
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }, { once: true });
    window.addEventListener('hashchange', routeChanged);
    root.append(dialog);
    dialog.showModal();
  }
  function exportDirectory(): void {
    const rows = [['Name', 'CWL', 'PUID', 'Email', 'Status', 'Platform Instructor', 'Default workspace', 'CWL affiliations', 'Course roles'], ...visibleUsers().map(user => [user.displayName, user.uid, user.pendingCwl ? '' : user.puid, user.email, personStatus(user), user.platformInstructor ? 'Granted' : 'Not granted', defaultWorkspace(user), user.affiliations.join('; '), user.courseRoles.map(entry => `${entry.courseId}: ${entry.role}`).join('; ')])];
    const csv = rows.map(row => row.map(value => `"${(/^[=+@\-\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = el('a', { href: url, download: 'financebot-user-directory.csv' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(`Exported ${visibleUsers().length} loaded matching users.`);
  }
  const toolbar = el('form', { class: 'ac-toolbar admin-directory-search', onsubmit: (event: Event) => { event.preventDefault(); if (debounce) clearTimeout(debounce); page = 1; return load(); } }, search, accountFilter, roleFilter,
    el('button', { class: 'btn btn--ghost btn--sm', type: 'submit', text: 'Search' }),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Clear', onclick: () => { search.value = ''; accountFilter.value = ''; roleFilter.value = ''; page = 1; return load(); } }));
  search.addEventListener('input', () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => { if (root.isConnected) { page = 1; void load(); } }, 300); });
  accountFilter.addEventListener('change', () => { page = 1; if (loaded) renderTable(); });
  roleFilter.addEventListener('change', () => { page = 1; if (loaded) renderTable(); });
  root.append(el('header', { class: 'ac-header' }, el('div', {}, el('h1', { text: 'User Directory' }), el('p', { text: 'Manage Instructor, TA and Student access, or ban a user, in one place.' })),
    el('div', { class: 'ac-actions' }, el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Grant before first login', onclick: openAdvanceGrant }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Export', onclick: exportDirectory }), el('button', { class: 'btn btn--secondary btn--sm', type: 'button', text: 'Refresh', onclick: () => load() }))),
    metrics, status, el('div', { class: 'ac-workspace' }, el('section', { class: 'ac-main', 'aria-label': 'User directory' }, toolbar, tableSlot, footer), inspectorSlot));
  mount(outlet, root);
  await load();
  attachTutorial(root, location.hash.split('?')[0] === '#/admin/accounts' ? 'admin-accounts' : 'admin-users', { 'admin-users-search': '.admin-directory-search', 'admin-users-list': '.admin-user-list' });
}

export function renderAdminUsers(outlet: HTMLElement, _params: RouteParams): void { void renderInner(outlet); }
