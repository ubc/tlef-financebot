import { test, expect, type Page } from '@playwright/test';
import { TUTORIAL_DEFINITIONS } from '../../client/src/tutorial-definitions';
import AxeBuilder from '@axe-core/playwright';
const COURSE = '507f1f77bcf86cd799439011';
const SECOND = '507f1f77bcf86cd799439012';
async function fixture(page: Page, legacy = false) {
  await page.route('**/canvas-workspace-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Canvas workspace</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/canvas-integration.css"></head><body><main id="fixture"></main></body></html>' }));
  const people = Array.from({ length: 25 }, (_, i) => ({ canvasUserId: String(i), name: i === 0 ? 'Alex Instructor' : i === 1 ? 'Sam TA' : `Member ${i}`, sourceIds: ['101'], identity: '…ABCD', status: 'CWL account matched', roles: [i === 0 ? 'Instructor' : i === 1 ? 'TA' : i === 2 ? 'Observer' : 'Student'], states: [i === 2 ? 'invited' : 'active'], isSelf: i === 0 }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { authenticated: true, user: { puid: 'SELF', uid: 'alex', displayName: 'Alex Instructor', isAdmin: false, platformInstructor: true, affiliations: ['faculty'], courseRoles: [{ courseId: COURSE, role: 'instructor' }] } } });
    if (path === '/api/tutorials') return route.fulfill({ json: TUTORIAL_DEFINITIONS.map(d => ({ id: d.id, role: d.role, version: 1, status: 'dismissed' })) });
    if (path === '/api/notifications') return route.fulfill({ json: [] });
    if (path === '/api/canvas/status') return route.fulfill({ json: { configured: true, connected: true, domain: 'https://canvas.example.edu', canvasUserId: '0' } });
    if (path === '/api/courses') return route.fulfill({ json: [COURSE, SECOND].map((_id, i) => ({ _id, name: `Finance ${i + 1}`, courseCode: 'COMM 298', term: '2026W1', published: true })) });
    if (path.endsWith('/canvas')) return route.fulfill({ json: { revision: 'v1', sources: [{ id: '101', name: 'Finance 101', code: 'COMM 298 101' }], people, students: people.filter(p => p.roles.includes('Student')), autoEnroll: true, validUntil: '2099-01-01', syncedAt: '2026-10-01T16:00:00Z' } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto(`/canvas-workspace-fixture#/instructor/${legacy ? `course/${COURSE}/canvas` : `canvas/${COURSE}`}`);
  await page.evaluate(async () => {
    const { startRouter } = await import('/js/router.js');
    const { renderCanvas } = await import('/js/views/instructor/canvas.js');
    startRouter({ routes: [{ path: '/instructor/canvas', render: renderCanvas }, { path: '/instructor/canvas/:id', render: renderCanvas }, { path: '/instructor/course/:id/canvas', render: renderCanvas }], outlet: document.getElementById('fixture')!, fallback: '/instructor/canvas' });
  });
  await expect(page.getByRole('heading', { name: 'Canvas connection', exact: true })).toBeVisible();
}
test('all roles and self appear; pagination, search and role filter reset correctly', async ({ page }) => {
  await fixture(page);
  await page.getByRole('tab', { name: /People/ }).click();
  await expect(page.getByText('You', { exact: true })).toBeVisible();
  await expect(page.getByText('1–20 of 25 people')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('21–25 of 25 people')).toBeVisible();
  await page.getByLabel('Filter by Canvas role').selectOption('TA');
  await expect(page.getByText('Sam TA', { exact: true })).toBeVisible();
  await expect(page.getByText('1–1 of 1 people')).toBeVisible();
  await page.getByLabel('Filter by Canvas role').selectOption('');
  await page.getByLabel('Search people').fill('Alex');
  await expect(page.getByText('You', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByLabel('Search people').fill('');
  await expect(page.getByText('1–20 of 25 people')).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.canvas-workspace').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'audit-results/canvas-workspace/people-desktop.png', fullPage: true });
});
test('legacy course URLs redirect to global workspace and course switching stays outside course shell', async ({ page }) => {
  await fixture(page, true);
  await expect(page).toHaveURL(new RegExp(`#/instructor/canvas/${COURSE}$`));
  await page.getByLabel('FinanceBot course', { exact: true }).selectOption(SECOND);
  await expect(page).toHaveURL(new RegExp(`#/instructor/canvas/${SECOND}$`));
  expect(await page.evaluate(async () => {
    const { courseIdFromPath, INSTRUCTOR_NAV, isNavItemActive } = await import('/js/views/instructor/shell.js');
    const nav = INSTRUCTOR_NAV[0].items.find((item: {label: string}) => item.label === 'Canvas connection')!;
    return { course: courseIdFromPath(location.hash.slice(1)), active: isNavItemActive(nav, location.hash.slice(1)) };
  })).toEqual({ course: null, active: true });
});
test('mobile dark people list scrolls within table and keeps filters usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.getByRole('tab', { name: /People/ }).click();
  await page.getByLabel('Filter by Canvas role').selectOption('Observer');
  await expect(page.getByText('invited', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'audit-results/canvas-workspace/people-mobile.png', fullPage: true });
});

test('production shell shows global Canvas navigation and hides course workspace while switching courses', async ({ page }) => {
  await fixture(page);
  await page.goto(`/#/instructor/canvas/${COURSE}`);
  await expect(page.locator('.app-shell--unified')).toBeVisible();
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Canvas connection' })).toBeVisible();
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Course Dashboard' })).toBeHidden();
  await page.getByRole('tab', { name: /People/ }).click();
  await expect(page.getByText('Alex Instructor', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'audit-results/canvas-workspace/people-full-shell.png', fullPage: true });
  await page.getByLabel('FinanceBot course', { exact: true }).selectOption(SECOND);
  await expect(page).toHaveURL(new RegExp(`#/instructor/canvas/${SECOND}$`));
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Course Dashboard' })).toBeHidden();
});
