import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { RegistrationCodeRow } from '../../client/src/api';
const id = '111111111111111111111111';
const course = { _id: id, name: 'Introduction to Physics', courseCode: 'PHYS 100', section: '222', term: '2026W', ownerPuid: 'teacher', lifecycle: 'published', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 3 }, registrationCode: 'PHYS-123', themes: [] };
async function fixture(page: Page, view: 'settings' | 'people' | 'tas' | 'help', empty = false) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const codes: RegistrationCodeRow[] = [];
  await page.route('**/admin-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Course administration</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/people-workspace.css"></head><body><main id="app" style="padding:24px"></main></body></html>' }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (method !== 'GET') {
      const body = route.request().postData() ? route.request().postDataJSON() : {};
      writes.push({ path, body });
      if (path.endsWith('/registration-codes')) {
        const added = Array.from({ length: Number(body.count) }, (_, index) => ({ id: crypto.randomUUID(), code: `CODE${index}2345678`, status: 'available' as const,
          createdAt: new Date().toISOString(), claimedAt: null, usedAt: null, recipient: null }));
        codes.push(...added);
        return route.fulfill({ status: 201, json: { ids: added.map(code => code.id) } });
      }
      if (method === 'DELETE' && path.includes('/registration-codes/')) {
        const deleting = path.endsWith('/record');
        const codeId = path.split('/').at(deleting ? -2 : -1);
        const found = codes.find(code => code.id === codeId);
        if (found && deleting) codes.splice(codes.indexOf(found), 1);
        else if (found) found.status = 'revoked';
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: path.endsWith('/tas') ? {} : { ...course, ...body } });
    }
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'teacher', platformInstructor: true, courseRoles: [{ courseId: id, role: 'instructor' }] } } });
    if (path.includes('/tutorials')) return route.fulfill({ json: view === 'help' ? [{ id: 'instructor-welcome', role: 'instructor', title: 'Prepare your course', description: 'Sources, objectives and review.', status: 'completed', estimatedSeconds: 30 }, { id: 'instructor-analytics', role: 'instructor', title: 'Read student performance', description: 'Explore topic trends.', status: 'not-viewed', estimatedSeconds: 30 }] : [] });
    if (path.endsWith('/people')) return route.fulfill({ json: { course: { id, name: course.name, code: course.courseCode, term: course.term, ownerPuid: 'teacher' }, canManage: true, people: [], total: 0, counts: { people: 0, invitations: 0 }, page: 1, pageSize: 10, pageCount: 1 } });
    if (path.endsWith('/tas')) return route.fulfill({ json: empty ? [] : [{ email: 'alex@ubc.ca', displayName: 'Alex Chen', status: 'active', activatedPuid: 'alex', permissions: {} }, { email: 'pending@ubc.ca', status: 'pending' }, { email: 'old@ubc.ca', status: 'expired', activatedPuid: 'old' }] });
    if (path.endsWith('/roster')) return route.fulfill({ json: [] });
    if (path.endsWith('/registration-codes')) {
      const filtered = codes.filter(code => !url.searchParams.get('status') || code.status === url.searchParams.get('status'));
      const pageSize = Number(url.searchParams.get('pageSize') ?? 25);
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      const current = Math.min(Number(url.searchParams.get('page') ?? 1), pageCount);
      return route.fulfill({ json: { codes: filtered.slice((current - 1) * pageSize, current * pageSize), total: filtered.length, page: current, pageSize, pageCount } });
    }
    if (path.endsWith('/people-import')) return route.fulfill({ json: { revision: 0, members: [], canManage: true, importedAt: null, fileName: null } });
    if (path === '/api/courses') return route.fulfill({ json: [course] });
    if (path === `/api/courses/${id}`) return route.fulfill({ json: course });
    return route.fulfill({ status: 404, json: { error: 'Unexpected request: ' + path } });
  });
  await page.goto('/admin-fixture');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.evaluate(async ({ id, view }) => {
    location.hash = `/instructor/course/${id}/${view}`;
    await (await import('/js/auth.js')).loadSession();
    const root = document.querySelector('#app')! as HTMLElement;
    if (view === 'settings') (await import('/js/views/instructor/settings.js')).renderSettings(root, { id });
    else if (view === 'people') (await import('/js/views/instructor/people.js')).renderPeople(root, { id });
    else if (view === 'tas') (await import('/js/views/instructor/tas.js')).renderTas(root, { id });
    else await (await import('/js/views/tutorial-help.js')).renderTutorialHelp(root, { id });
  }, { id, view });
  await expect(page.locator(view === 'people' ? '.people-workspace' : '.admin-workbench')).toBeVisible();
  return writes;
}
test('settings retain drafts and save only the current section', async ({ page }) => {
  const writes = await fixture(page, 'settings');
  await page.getByLabel('Course Name', { exact: true }).fill('Unsaved physics name');
  await page.getByRole('button', { name: 'Learning experience', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toEqual({ feedbackStrategy: 'adaptive', expectedRevision: 0 });
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await expect(page.getByLabel('Course Name', { exact: true })).toHaveValue('Unsaved physics name');
  await expect(page.getByRole('button', { name: 'Enrollment', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage people', exact: true })).toHaveAttribute('href', `#/instructor/course/${id}/people`);
  await expect(page.getByRole('button', { name: 'Save Roster' })).toHaveCount(0);
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Course lifecycle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete course permanently' })).toBeVisible();
});
test('supplemental codes can be generated in a batch and revoked independently', async ({ page }) => {
  const writes = await fixture(page, 'people');
  await page.getByRole('button', { name: 'Registration codes', exact: true }).click();
  await page.getByLabel('Number of codes', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Generate codes', exact: true }).click();
  await expect(page.getByText('3 one-time codes generated.')).toBeVisible();
  await expect(page.locator('.registration-code-status').filter({ hasText: /^Unused$/ })).toHaveCount(3);
  expect(writes[0].body).toMatchObject({ count: 3, requestId: expect.any(String) });
  await page.screenshot({ path: 'artifacts/one-time-enrollment-2026-10-06/enrollment-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Revoke code CODE02345678', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Revoke code CODE02345678', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke code', exact: true }).click();
  await expect(page.locator('.registration-code-status').filter({ hasText: /^Revoked$/ })).toBeVisible();
  await expect(page.locator('.registration-code-status').filter({ hasText: /^Unused$/ })).toHaveCount(2);
  expect(writes[1].path).toContain('/registration-codes/');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.admin-workbench,.people-workspace').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/one-time-enrollment-2026-10-06/enrollment-mobile.png', fullPage: true });
});
test('TA invitation accepts CWL without converting it to an email in the browser', async ({ page }) => {
  const writes = await fixture(page, 'tas');
  await page.getByRole('button', { name: 'Invite a TA', exact: true }).click();
  await page.getByLabel('TA UBC email or CWL', { exact: true }).fill('teaching.assistant');
  await page.screenshot({ path: 'artifacts/one-time-enrollment-2026-10-06/ta-cwl-invitation.png', fullPage: true });
  await page.getByRole('button', { name: 'Invite TA', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toEqual({ identifier: 'teaching.assistant' });
});
test('code pages, filters and record deletion handle larger lists and the last page', async ({ page }) => {
  await fixture(page, 'people');
  await page.getByRole('button', { name: 'Registration codes', exact: true }).click();
  await page.getByLabel('Number of codes', { exact: true }).fill('26');
  await page.getByRole('button', { name: 'Generate codes', exact: true }).click();
  await expect(page.locator('.registration-code-row')).toHaveCount(25);
  await page.getByRole('button', { name: 'Next code page' }).click();
  await expect(page.locator('.registration-code-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete code record CODE252345678', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.registration-code-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete code record CODE252345678', exact: true }).click();
  await page.getByRole('button', { name: 'Delete record', exact: true }).click();
  await expect(page.locator('.registration-code-row')).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Next code page' })).toBeDisabled();
  await page.getByLabel('Codes per page', { exact: true }).selectOption('10');
  await expect(page.locator('.registration-code-row')).toHaveCount(10);
  await expect(page.getByText('1–10 of 25 · Page 1 of 3', { exact: true })).toBeVisible();
  await page.getByLabel('Filter code status', { exact: true }).selectOption('used');
  await expect(page.getByText('No codes with this status. Choose another status or generate codes.')).toBeVisible();
  await page.getByLabel('Filter code status', { exact: true }).selectOption('available');
  await expect(page.locator('.registration-code-row')).toHaveCount(10);
  expect((await new AxeBuilder({ page }).include('.registration-codes-panel').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
});
test('TA permissions and invitation use course-scoped APIs; empty search recovers', async ({ page }) => {
  const writes = await fixture(page, 'tas');
  await page.getByRole('button', { name: 'Permissions', exact: true }).click();
  await page.getByLabel('View analytics', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save permissions', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes[0].path).toBe(`/api/courses/${id}/tas/alex/permissions`);
  expect(writes[0].body.permissions).toMatchObject({ 'analytics.view': false });
  await page.getByLabel('Search teaching assistants').fill('zzzz');
  await expect(page.getByText('No matching team members')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: 'Invite a TA', exact: true }).click();
  await page.getByLabel('TA UBC email').fill('new@ubc.ca');
  await page.getByRole('button', { name: 'Invite TA', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toEqual({ identifier: 'new@ubc.ca' });
});
test('help search, course context, reset confirmation and replay destination', async ({ page }) => {
  const writes = await fixture(page, 'help');
  await page.getByLabel('Search tutorials').fill('zzzz');
  await expect(page.getByText('No matching tutorials')).toBeVisible();
  await page.getByRole('button', { name: 'Show all tutorials' }).click();
  await page.getByRole('button', { name: 'Reset instructor tutorials' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Start walkthrough', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/instructor/course/${id}/analytics`));
});
for (const view of ['tas', 'settings', 'help'] as const) test(`${view}: accessible layout, empty and responsive`, async ({ page }) => {
  await fixture(page, view, true);
  await expect(page.getByRole('heading', { name: view === 'tas' ? 'Build your teaching team' : view === 'settings' ? 'General' : 'What would you like to do?', exact: true })).toBeVisible();
  await page.screenshot({ path: `/tmp/live-${view}.png`, fullPage: true });
  const scan = await new AxeBuilder({ page }).include('.admin-workbench,.people-workspace').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect((await new AxeBuilder({ page }).include('.admin-workbench,.people-workspace').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
