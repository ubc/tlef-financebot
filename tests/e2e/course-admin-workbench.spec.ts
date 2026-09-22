import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const id = '111111111111111111111111';
const course = { _id: id, name: 'Introduction to Physics', courseCode: 'PHYS 100', section: '222', term: '2026W', ownerPuid: 'teacher', lifecycle: 'published', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 3 }, registrationCode: 'PHYS-123', themes: [] };
async function fixture(page: Page, view: 'settings' | 'tas' | 'help', empty = false) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/admin-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Course administration</title><link rel="stylesheet" href="/styles/main.css"></head><body><main id="app" style="padding:24px"></main></body></html>' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== 'GET') { writes.push({ path, body: route.request().postData() ? route.request().postDataJSON() : {} }); return route.fulfill({ json: path.endsWith('/tas') ? {} : { ...course, ...route.request().postDataJSON() } }); }
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'teacher', platformInstructor: true, courseRoles: [{ courseId: id, role: 'instructor' }] } } });
    if (path.includes('/tutorials')) return route.fulfill({ json: view === 'help' ? [{ id: 'instructor-welcome', role: 'instructor', title: 'Prepare your course', description: 'Sources, objectives and review.', status: 'completed', estimatedSeconds: 30 }, { id: 'instructor-analytics', role: 'instructor', title: 'Read student performance', description: 'Explore topic trends.', status: 'not-viewed', estimatedSeconds: 30 }] : [] });
    if (path.endsWith('/tas')) return route.fulfill({ json: empty ? [] : [{ email: 'alex@ubc.ca', displayName: 'Alex Chen', status: 'active', activatedPuid: 'alex', permissions: {} }, { email: 'pending@ubc.ca', status: 'pending' }, { email: 'old@ubc.ca', status: 'expired', activatedPuid: 'old' }] });
    if (path.endsWith('/roster')) return route.fulfill({ json: [] });
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
    else if (view === 'tas') (await import('/js/views/instructor/tas.js')).renderTas(root, { id });
    else await (await import('/js/views/tutorial-help.js')).renderTutorialHelp(root, { id });
  }, { id, view });
  await expect(page.locator('.admin-workbench')).toBeVisible();
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
  await page.getByRole('button', { name: 'Enrollment', exact: true }).click();
  await expect(page.getByText('No students on the roster yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Course lifecycle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete course permanently' })).toBeVisible();
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
  expect(writes[1].body).toEqual({ email: 'new@ubc.ca' });
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
  const scan = await new AxeBuilder({ page }).include('.admin-workbench').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations).toEqual([]);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect((await new AxeBuilder({ page }).include('.admin-workbench').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
