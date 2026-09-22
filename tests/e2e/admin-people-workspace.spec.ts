import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AdminAccount, AdminDirectoryUser, CourseRole } from '../../client/src/api';

const COURSE = '507f1f77bcf86cd799439011';
const OTHER_COURSE = '507f1f77bcf86cd799439012';
const OPAQUE_PUID = 'Case.Sensitive-Member';
const PENDING_PUID = 'Case.Sensitive-Pending';
const people = (): AdminDirectoryUser[] => [
  { _id: '1', puid: 'PUID-ALPHA', displayName: 'Alex Instructor', uid: 'alex', email: 'alex@example.edu', affiliations: ['faculty'], isAdmin: false, courseRoles: [{ courseId: COURSE, role: 'instructor' }], lastLoginAt: '2026-09-20T18:30:00Z' },
  { _id: '2', puid: 'PUID-ADMIN', displayName: 'Admin User', uid: 'admin', email: 'admin@example.edu', affiliations: ['staff'], isAdmin: true, courseRoles: [], lastLoginAt: '2026-09-20T18:25:00Z' },
  { _id: '3', puid: 'PUID-STUDENT', displayName: 'Sam Student', uid: 'sam', email: 'sam@example.edu', affiliations: ['student'], isAdmin: false, courseRoles: [{ courseId: COURSE, role: 'student' }], lastLoginAt: '2026-09-19T18:20:00Z' },
  { _id: '4', puid: 'PUID-BLOCKED', displayName: 'Blocked Account', uid: 'blocked', email: 'blocked@example.edu', affiliations: ['faculty'], isAdmin: false, courseRoles: [], deactivatedAt: '2026-09-19T18:20:00Z', lastLoginAt: '2026-09-10T18:20:00Z' },
  { _id: '5', puid: OPAQUE_PUID, displayName: 'Case Member', uid: 'case', email: 'case@example.edu', affiliations: ['faculty'], isAdmin: false, courseRoles: [], lastLoginAt: '2026-09-19T18:20:00Z' },
];
const grants = (users: AdminDirectoryUser[]): AdminAccount[] => [
  ...users.map(user => ({
    puid: user.puid, status: user.deactivatedAt ? 'deactivated' as const : 'active' as const,
    uid: user.uid, displayName: user.displayName, email: user.email, affiliations: user.affiliations,
    isAdmin: user.isAdmin, platformInstructor: user.puid === 'PUID-ALPHA', lastLoginAt: user.lastLoginAt,
    ...(user.puid === 'PUID-ALPHA' ? { grantedAt: '2026-09-10T18:00:00Z' } : {}),
  })),
  { puid: PENDING_PUID, status: 'pending', uid: '', displayName: PENDING_PUID, email: '', affiliations: [], isAdmin: false, platformInstructor: true, grantedAt: '2026-09-19T18:00:00Z' },
];

const personRow = (page: Page, name: string) => page.locator('.ac-table tbody tr').filter({ has: page.getByRole('button', { name, exact: true }) });

async function openGrants(page: Page, scope: Locator): Promise<Locator> {
  const trigger = scope.getByRole('button', { name: 'Grant', exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const menu = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
  await expect(menu).toBeVisible();
  return menu;
}

async function grantAction(page: Page, scope: Locator, name: string): Promise<void> {
  const menu = await openGrants(page, scope);
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

async function expectGrantOption(page: Page, scope: Locator, name: string): Promise<void> {
  const menu = await openGrants(page, scope);
  await expect(menu.getByRole('menuitem', { name, exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
}

async function fixture(page: Page, name: 'users' | 'accounts', theme = 'light') {
  const users = people();
  const accounts = grants(users);
  const writes: Array<{ path: string; method: string }> = [];
  await page.route('**/people-workspace-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en" data-admin="true" data-theme="${theme}"><head><title>Admin workspace test</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/admin-console.css"><link rel="stylesheet" href="/styles/admin-people.css"></head><body><main id="fixture" class="outlet"></main></body></html>` }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (method !== 'GET') writes.push({ path, method });
    if (path === '/api/admin/directory') {
      const q = url.searchParams.get('q')?.toLowerCase() || '';
      const role = url.searchParams.get('role');
      return route.fulfill({ json: users.filter(user => JSON.stringify(user).toLowerCase().includes(q) && (!role || user.courseRoles.some(entry => entry.role === role))) });
    }
    if (path === '/api/admin/users') {
      const q = url.searchParams.get('query')?.toLowerCase() || '';
      return route.fulfill({ json: accounts.filter(account => JSON.stringify(account).toLowerCase().includes(q)) });
    }
    if (path === '/api/admin/courses') return route.fulfill({ json: [
      { _id: COURSE, name: 'Finance Foundations', courseCode: 'FIN 101', section: '001', term: '2026W1', lifecycle: 'published' },
      { _id: OTHER_COURSE, name: 'Advanced Finance', courseCode: 'FIN 201', section: '002', term: '2026W1', lifecycle: 'draft' },
    ] });
    if (path.startsWith('/api/admin/platform-instructors/')) {
      const puid = decodeURIComponent(path.split('/').pop()!);
      const account = accounts.find(user => user.puid === puid)!;
      account.platformInstructor = method === 'PUT';
      if (method === 'PUT') { account.grantedAt = '2026-09-20T19:00:00Z'; return route.fulfill({ json: account }); }
      delete account.grantedAt;
      if (account.status === 'pending') accounts.splice(accounts.indexOf(account), 1);
      return route.fulfill({ json: { puid, granted: false, revoked: true } });
    }
    const roleMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/courses\/([^/]+)\/roles\/([^/]+)$/);
    if (roleMatch) {
      const user = users.find(user => user.puid === decodeURIComponent(roleMatch[1]))!;
      const role = roleMatch[3] as CourseRole;
      if (method === 'PUT') user.courseRoles.push({ courseId: roleMatch[2], role });
      else user.courseRoles = user.courseRoles.filter(entry => entry.courseId !== roleMatch[2] || entry.role !== role);
      return method === 'PUT' ? route.fulfill({ status: 204 }) : route.fulfill({ json: { removed: true } });
    }
    const stateMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/(deactivate|reactivate)$/);
    if (stateMatch) {
      const puid = decodeURIComponent(stateMatch[1]);
      const user = users.find(user => user.puid === puid)!;
      if (stateMatch[2] === 'deactivate') user.deactivatedAt = '2026-09-20T19:00:00Z';
      else delete user.deactivatedAt;
      accounts.find(account => account.puid === puid)!.status = user.deactivatedAt ? 'deactivated' : 'active';
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: `Unconfigured fixture API: ${path}` } });
  });
  await page.goto('/people-workspace-fixture');
  await page.evaluate(async name => {
    const outlet = document.getElementById('fixture')!;
    if (name === 'users') { const { renderAdminUsers } = await import('/js/views/admin/users.js'); renderAdminUsers(outlet, {}); }
    else { const { renderAdminAccounts } = await import('/js/views/admin/accounts.js'); renderAdminAccounts(outlet, {}); }
  }, name);
  await expect(page.locator('.ac-table')).toBeVisible();
  return { users, accounts, writes };
}

test('unified directory preserves search, investigation links and protected Admins', async ({ page }) => {
  await fixture(page, 'users');
  await expect(page.getByRole('heading', { name: 'User Directory' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Instructor', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('UBC PUID', { exact: true })).toHaveCount(0);
  await expect(page.locator('.ac-table tbody tr')).toHaveCount(6);
  await expect(personRow(page, 'Admin User').getByRole('button', { name: 'Ban user', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Admin User', exact: true }).click();
  await expect(page.locator('.ac-panel').getByRole('button', { name: 'Ban user', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close user details' }).click();
  await page.getByLabel('Search users', { exact: true }).fill('Alex');
  await expect(page.locator('.ac-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Alex Instructor', exact: true }).click();
  await expect(page.getByRole('link', { name: 'View activity' })).toHaveAttribute('href', '#/admin/operations?actor=PUID-ALPHA');
  await expect(page.getByRole('link', { name: 'Created questions' })).toHaveAttribute('href', '#/admin/questions?actor=PUID-ALPHA');
  await page.getByRole('tab', { name: 'Course access' }).click();
  await expect(page.getByRole('button', { name: `Remove Instructor from ${COURSE}` })).toBeVisible();
  await page.getByRole('button', { name: 'Close user details' }).click();
  await expect(page.getByLabel('Search users', { exact: true })).toHaveValue('Alex');
});

test('legacy accounts view keeps pending grants in the unified directory and filters platform access locally', async ({ page }) => {
  await fixture(page, 'accounts');
  await expect(page.getByRole('heading', { name: 'User Directory' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Instructor', exact: true })).toHaveCount(0);
  await page.getByLabel('User role', { exact: true }).selectOption('instructor');
  await expect(page.locator('.ac-table tbody tr')).toHaveCount(2);
  await expect(personRow(page, PENDING_PUID)).toBeVisible();
  await page.getByLabel('Account status', { exact: true }).selectOption('pending');
  await expect(page.locator('.ac-table tbody tr')).toHaveCount(1);
  const pending = personRow(page, PENDING_PUID);
  await expect(pending.getByText('Pending first login', { exact: true })).toBeVisible();
  const pendingMenu = await openGrants(page, pending);
  await expect(pendingMenu.getByRole('menuitem', { name: 'Revoke Instructor', exact: true })).toBeEnabled();
  await expect(pendingMenu.getByRole('menuitem', { name: 'Grant TA', exact: true })).toBeDisabled();
  await expect(pendingMenu.getByRole('menuitem', { name: 'Grant Student', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(pending.getByRole('button', { name: 'Ban user', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: PENDING_PUID, exact: true }).click();
  await expect(page.locator('.ac-panel').getByText(/has not signed in/)).toBeVisible();
  await expect(page.locator('.ac-panel').getByRole('button', { name: 'Ban user', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close user details' }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByLabel('Account status', { exact: true }).selectOption('deactivated');
  await expect(page.locator('.ac-table tbody tr')).toHaveCount(1);
  await expect(personRow(page, 'Blocked Account').getByRole('button', { name: 'Grant', exact: true })).toBeDisabled();
  await expect(personRow(page, 'Blocked Account').getByRole('button', { name: 'Unban user', exact: true })).toBeEnabled();
});

test('row Instructor grant preserves the exact PUID, retries failures and locks repeated submissions', async ({ page }) => {
  const state = await fixture(page, 'users');
  let requests = 0;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const received: Array<{ method: string; puid: string }> = [];
  await page.route('**/api/admin/platform-instructors/*', async route => {
    requests++;
    const puid = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    received.push({ method: route.request().method(), puid });
    if (requests === 1) { await pending; return route.fulfill({ status: 503, json: { error: 'Grant could not be saved. Try again.' } }); }
    const account = state.accounts.find(account => account.puid === puid)!;
    account.platformInstructor = route.request().method() === 'PUT';
    return route.fulfill({ json: route.request().method() === 'PUT' ? account : { puid, granted: false, revoked: true } });
  });
  const row = personRow(page, 'Case Member');
  await grantAction(page, row, 'Grant Instructor');
  await expect.poll(() => requests).toBe(1);
  await expect(row.getByRole('button', { name: 'Grant', exact: true })).toBeDisabled();
  // A second DOM-dispatched click also exercises the request guard itself.
  await row.getByRole('button', { name: 'Grant', exact: true }).dispatchEvent('click');
  expect(requests).toBe(1);
  finish();
  await expect(page.getByText('Grant could not be saved. Try again.', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Grant', exact: true })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Grant', exact: true })).toBeFocused();
  await grantAction(page, row, 'Grant Instructor');
  await expectGrantOption(page, row, 'Revoke Instructor');
  expect(received).toEqual([{ method: 'PUT', puid: OPAQUE_PUID }, { method: 'PUT', puid: OPAQUE_PUID }]);
  await page.getByLabel('User role', { exact: true }).selectOption('instructor');
  await expect(row).toBeVisible(); // Platform access does not need an existing course role.
  await grantAction(page, row, 'Revoke Instructor');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(requests).toBe(2);
  await grantAction(page, row, 'Revoke Instructor');
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke access', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(received[2]).toEqual({ method: 'DELETE', puid: OPAQUE_PUID });
});

test('successful row grant keeps a failed directory refresh retryable without repeating the write', async ({ page }) => {
  const state = await fixture(page, 'users');
  let failRefresh = true;
  await page.route('**/api/admin/directory**', route => failRefresh
    ? route.fulfill({ status: 503, json: { error: 'Directory refresh is temporarily unavailable.' } })
    : route.fallback());
  await grantAction(page, personRow(page, 'Case Member'), 'Grant Instructor');
  await expect(page.getByRole('alert')).toContainText('Access may have changed. Refresh the directory before making another change.');
  await expect(page.getByText('Directory refresh is temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.locator('button[data-mutation]:enabled')).toHaveCount(0);
  expect(state.accounts.find(account => account.puid === OPAQUE_PUID)!.platformInstructor).toBe(true);
  expect(state.writes).toEqual([{ path: `/api/admin/platform-instructors/${OPAQUE_PUID}`, method: 'PUT' }]);

  failRefresh = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expectGrantOption(page, personRow(page, 'Case Member'), 'Revoke Instructor');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

test('TA and Student row actions select real courses, preserve failure drafts and prevent duplicate roles', async ({ page }) => {
  const state = await fixture(page, 'users');
  let assignments = 0;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const paths: string[] = [];
  await page.route('**/api/admin/users/PUID-STUDENT/courses/**', async route => {
    assignments++; paths.push(new URL(route.request().url()).pathname);
    if (assignments === 1) { await pending; return route.fulfill({ status: 503, json: { error: 'Course access is temporarily unavailable.' } }); }
    const path = new URL(route.request().url()).pathname.split('/');
    state.users.find(user => user.puid === 'PUID-STUDENT')!.courseRoles.push({ courseId: path[6], role: path[8] as CourseRole });
    return route.fulfill({ status: 204 });
  });
  await grantAction(page, personRow(page, 'Sam Student'), 'Grant TA');
  await expect(page.getByRole('tab', { name: 'Course access', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Course role', { exact: true })).toHaveValue('ta');
  await expect(page.getByLabel('Course', { exact: true }).getByRole('option', { name: /Advanced Finance/ })).toHaveCount(1);
  await page.getByLabel('Course', { exact: true }).selectOption(OTHER_COURSE);
  await page.getByRole('button', { name: 'Assign course role', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Assign course role', exact: true })).toBeDisabled();
  await expect.poll(() => assignments).toBe(1);
  finish();
  await expect(page.getByText('Course access is temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign course role', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Course', { exact: true })).toHaveValue(OTHER_COURSE);
  await expect(page.getByLabel('Course role', { exact: true })).toHaveValue('ta');
  await page.getByRole('button', { name: 'Assign course role', exact: true }).click();
  await expect(page.getByRole('button', { name: `Remove TA from ${OTHER_COURSE}` })).toBeVisible();
  expect(paths).toEqual(Array(2).fill(`/api/admin/users/PUID-STUDENT/courses/${OTHER_COURSE}/roles/ta`));
  await page.getByRole('button', { name: 'Close user details' }).click();
  await grantAction(page, personRow(page, 'Sam Student'), 'Grant Student');
  await expect(page.getByLabel('Course role', { exact: true })).toHaveValue('student');
  await page.getByLabel('Course', { exact: true }).selectOption(COURSE);
  await page.getByRole('button', { name: 'Assign course role', exact: true }).click();
  await expect(page.getByText('This user already has that role in this course.', { exact: true })).toBeVisible();
  expect(assignments).toBe(2);
  await page.getByLabel('Course', { exact: true }).selectOption(OTHER_COURSE);
  await page.getByRole('button', { name: 'Assign course role', exact: true }).click();
  await expect(page.getByRole('button', { name: `Remove Student from ${OTHER_COURSE}` })).toBeVisible();
  expect(paths[2]).toBe(`/api/admin/users/PUID-STUDENT/courses/${OTHER_COURSE}/roles/student`);
});

test('Ban and Unban require confirmation, refresh row state and retain course history', async ({ page }) => {
  const state = await fixture(page, 'users');
  const row = personRow(page, 'Sam Student');
  await row.getByRole('button', { name: 'Ban user', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ban Sam Student?', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.writes).toEqual([]);
  await row.getByRole('button', { name: 'Ban user', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ban user', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Unban user', exact: true })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Grant', exact: true })).toBeDisabled();
  expect(state.writes).toEqual([{ path: '/api/admin/users/PUID-STUDENT/deactivate', method: 'POST' }]);
  await page.getByRole('button', { name: 'Sam Student', exact: true }).click();
  await page.getByRole('tab', { name: 'Course access', exact: true }).click();
  await expect(page.getByRole('button', { name: `Remove Student from ${COURSE}` })).toBeVisible();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.locator('.ac-panel').getByRole('button', { name: 'Unban user', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unban Sam Student?', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Unban user', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Ban user', exact: true })).toBeEnabled();
  expect(state.writes[1]).toEqual({ path: '/api/admin/users/PUID-STUDENT/reactivate', method: 'POST' });
  expect(state.users.find(user => user.puid === 'PUID-STUDENT')!.courseRoles).toEqual([{ courseId: COURSE, role: 'student' }]);
});

test('directory honors actual HTTP 409 orphan warning, cancellation and explicit final-role removal', async ({ page }) => {
  const state = await fixture(page, 'users');
  let confirmedRemovals = 0;
  const requests: string[] = [];
  await page.route('**/api/admin/users/PUID-ALPHA/courses/**', route => {
    requests.push(route.request().url());
    if (!route.request().url().endsWith('confirm=true')) return route.fulfill({ status: 409, json: { removed: false, warning: 'orphans-course', courseId: COURSE } });
    confirmedRemovals++;
    state.users.find(user => user.puid === 'PUID-ALPHA')!.courseRoles = [];
    return route.fulfill({ json: { removed: true } });
  });
  await page.getByRole('button', { name: 'Alex Instructor', exact: true }).click();
  await page.getByRole('tab', { name: 'Course access' }).click();
  await page.getByRole('button', { name: `Remove Instructor from ${COURSE}` }).click();
  await page.getByRole('button', { name: 'Remove role', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Leave course without an instructor?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(confirmedRemovals).toBe(0);
  await expect(page.getByText('Course role kept.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Remove Instructor from ${COURSE}` }).click();
  await page.getByRole('button', { name: 'Remove role', exact: true }).click();
  await page.getByRole('button', { name: 'Remove final Instructor', exact: true }).click();
  await expect(page.getByRole('button', { name: `Remove Instructor from ${COURSE}` })).toHaveCount(0);
  expect(confirmedRemovals).toBe(1);
  expect(requests.some(url => url.endsWith('confirm=false'))).toBe(true);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expectGrantOption(page, page.locator('.ac-panel'), 'Revoke Instructor');
});

test('Grant groups role choices while Ban stays separate, with keyboard navigation and focus return', async ({ page }) => {
  const state = await fixture(page, 'users');
  const row = personRow(page, 'Sam Student');
  const trigger = row.getByRole('button', { name: 'Grant', exact: true });
  await expect(row.getByRole('button', { name: 'Ban user', exact: true })).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Grant role for Sam Student', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(3);
  await expect(menu.getByRole('menuitem', { name: 'Grant Instructor', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Grant TA', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Grant Student', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Grant Instructor', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await openGrants(page, row);
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await expect(row.getByRole('button', { name: 'Ban user', exact: true })).toBeFocused();
  await openGrants(page, row);
  await trigger.click();
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await openGrants(page, row);
  await page.getByRole('heading', { name: 'User Directory', exact: true }).click();
  await expect(menu).toBeHidden();
  expect(state.writes).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`Grant popover stays visible at the last row and inside Profile at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 520 });
    const state = await fixture(page, 'users');
    const checkPopover = async (menu: Locator): Promise<void> => {
      await expect(menu).toBeVisible();
      expect(await menu.evaluate(node => node.matches(':popover-open'))).toBe(true);
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(520);
      for (const option of await menu.getByRole('menuitem').all()) {
        expect(await option.evaluate(node => {
          const box = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBe(true);
      }
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    };
    const row = personRow(page, 'Sam Student');
    await row.getByRole('button', { name: 'Grant', exact: true }).scrollIntoViewIfNeeded();
    await checkPopover(await openGrants(page, row));
    await page.screenshot({ path: `audit-results/admin-workspace-2026-09-20/grant-last-row-${width}.png` });
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: 'Sam Student', exact: true }).click();
    const profile = page.locator('.ac-panel');
    await checkPopover(await openGrants(page, profile));
    await page.screenshot({ path: `audit-results/admin-workspace-2026-09-20/grant-profile-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(profile).toBeVisible();
    await expect(profile.getByRole('button', { name: 'Grant', exact: true })).toBeFocused();
    expect(state.writes).toEqual([]);
  });
}

for (const name of ['users', 'accounts'] as const) for (const theme of ['light', 'dark']) {
  test(`${name} ${theme} remains compact and accessible at desktop and narrow widths`, async ({ page }) => {
    await fixture(page, name, theme);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    for (const width of [1440, 580, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await page.locator('.ac-table tbody tr').first().boundingBox())!.y).toBeLessThan(400);
      const analysis = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(analysis.violations).toEqual([]);
    }
    await page.getByRole('button', { name: 'Alex Instructor', exact: true }).click();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.getByRole('tab', { name: 'Course access', exact: true }).click();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `audit-results/admin-workspace-2026-09-20/${name}-${theme}-390.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator('.ac-panel')).toHaveCount(0);
  });
}
