import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { CoursePerson } from '../../client/src/course-people-api';

const courseId = '507f1f77bcf86cd799439011';
const base = `/api/courses/${courseId}/people`;
async function fixture(page: Page, options: { manage?: boolean; partial?: boolean; failure?: boolean; theme?: string } = {}) {
  const rows: CoursePerson[] = Array.from({ length: 23 }, (_, n) => ({
    id: `puid:PERSON-${n}`, puid: `PERSON-${n}`, cwl: n === 2 ? null : `person${n}`, email: n === 2 ? null : `person${n}@ubc.ca`,
    displayName: n === 0 ? 'Course Owner' : n === 1 ? 'Platform Admin' : `Person ${String(n).padStart(2, '0')}`,
    role: n < 2 ? 'instructor' : 'student', owner: n === 0, protected: n < 2, status: n === 2 ? 'pending' : 'active',
    sources: n === 2 ? ['Canvas'] : ['Gradebook / CSV'], addedAt: '2026-10-01T12:00:00Z', lastLoginAt: null, revision: 0, permissions: {},
  }));
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/people-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Course People</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/people-workspace.css"></head><body><main id="app" style="padding:16px"></main></body></html>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === base && method === 'GET') {
      const search = url.searchParams.get('search')?.toLowerCase();
      const filtered = rows.filter(row => row.status !== 'revoked' && (!search || row.displayName.toLowerCase().includes(search))
        && (!url.searchParams.get('role') || row.role === url.searchParams.get('role')));
      const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      const current = Math.min(Number(url.searchParams.get('page') ?? 1), pageCount);
      return route.fulfill({ json: { course: { id: courseId, name: 'Finance', code: 'FIN 101', term: '2026W', ownerPuid: 'PERSON-0' },
        canManage: options.manage ?? true, people: filtered.slice((current - 1) * pageSize, current * pageSize), total: filtered.length,
        counts: { people: rows.filter(row => row.status !== 'revoked').length, invitations: 0 }, page: current, pageSize, pageCount } });
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push({ method, path: url.pathname, body });
    if (options.failure) return route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
    if (method === 'PATCH') {
      const row = rows.find(row => row.id === decodeURIComponent(url.pathname.split('/').at(-1)!))!;
      if (body.action === 'remove') row.status = 'revoked';
      if (body.action === 'ban') row.status = 'banned';
      row.revision++;
      return route.fulfill({ json: { id: row.id, revision: row.revision, status: row.status } });
    }
    if (method === 'POST' && url.pathname === `${base}/remove`) {
      const people = body.people as Array<{ id: string; expectedRevision: number }>;
      const removed: string[] = []; const failed: Array<{ id: string; status: number; message: string }> = [];
      for (const [index, person] of people.entries()) {
        if (options.partial && index === 0) { failed.push({ id: person.id, status: 409, message: 'Access changed. Refresh People and try again.' }); continue; }
        const row = rows.find(row => row.id === person.id)!;
        row.status = 'revoked'; row.revision++; removed.push(person.id);
      }
      return route.fulfill({ json: { removed, failed } });
    }
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}`);
  });
  await page.goto('/people-fixture');
  await page.evaluate(async ({ courseId, theme }) => {
    document.documentElement.dataset.theme = theme;
    const { renderPeople } = await import('/js/views/instructor/people.js');
    renderPeople(document.querySelector<HTMLElement>('#app')!, { id: courseId });
  }, { courseId, theme: options.theme ?? 'light' });
  await expect(page.locator('.people-table tbody tr')).toHaveCount(10);
  return { writes, rows, errors };
}

test('single removal supports a Canvas person awaiting first sign-in and cancellation preserves the row', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByRole('checkbox', { name: 'Select Course Owner', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Select Platform Admin', exact: true })).toBeDisabled();
  const remove = page.getByRole('button', { name: 'Remove Person 02 from course', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Remove person from course?' });
  await expect(dialog).toContainText('Canvas enrollments are retained');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(remove).toBeEnabled(); await expect(remove).toBeFocused();
  expect(state.writes).toHaveLength(0);
  await remove.click();
  await dialog.getByRole('button', { name: 'Remove person', exact: true }).click();
  await expect(page.locator('.people-workspace > .people-panel > .inline-feedback')).toContainText('Person 02 removed');
  await expect(remove).toHaveCount(0);
  expect(state.writes).toEqual([{ method: 'PATCH', path: `${base}/puid%3APERSON-2`, body: { action: 'remove', expectedRevision: 0 } }]);
  expect(state.errors).toEqual([]);
});

test('selection persists across pages and submits only explicit identities with revisions', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('checkbox', { name: 'Select Person 02', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Select people on this page' })).toHaveJSProperty('indeterminate', true);
  await page.getByRole('button', { name: 'Next people page' }).click();
  await page.getByRole('checkbox', { name: 'Select Person 10', exact: true }).check();
  await expect(page.locator('.people-selected-count')).toContainText('2 selected');
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove 2 people from course?' });
  await expect(dialog).toContainText('Person 02, Person 10');
  await dialog.getByRole('button', { name: 'Remove 2 people', exact: true }).click();
  await expect(page.locator('.people-selected-count')).toContainText('0 selected');
  expect(state.writes).toEqual([{ method: 'POST', path: `${base}/remove`, body: { people: [{ id: 'puid:PERSON-2', expectedRevision: 0 }, { id: 'puid:PERSON-10', expectedRevision: 0 }] } }]);
  expect(state.rows.filter(row => row.status === 'revoked').map(row => row.id)).toEqual(['puid:PERSON-2', 'puid:PERSON-10']);
  expect(state.errors).toEqual([]);
});

test('select page excludes protected people and changing filters clears hidden selections', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('checkbox', { name: 'Select people on this page' }).check();
  await expect(page.locator('.people-selected-count')).toContainText('8 selected');
  await page.getByRole('button', { name: 'Next people page' }).click();
  await page.getByRole('checkbox', { name: 'Select people on this page' }).check();
  await expect(page.locator('.people-selected-count')).toContainText('18 selected');
  await page.getByRole('searchbox', { name: 'Search people' }).fill('Person 21');
  await expect(page.locator('.people-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.people-selected-count')).toContainText('0 selected');
  await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

test('partial removal keeps successes removed and explains a stale member separately', async ({ page }) => {
  const state = await fixture(page, { partial: true });
  await page.getByRole('checkbox', { name: 'Select Person 02', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Person 03', exact: true }).check();
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove 2 people', exact: true }).click();
  await expect(page.locator('.directory-error')).toContainText('Person 02: Access changed');
  await expect(page.getByRole('button', { name: 'Remove Person 03 from course', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Person 02', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.people-selected-count')).toContainText('0 selected');
  expect(state.writes).toHaveLength(1);
});

test('failed removal preserves people and refreshes before enabling another attempt', async ({ page }) => {
  const state = await fixture(page, { failure: true });
  await page.getByRole('button', { name: 'Remove Person 02 from course', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove person', exact: true }).click();
  await expect(page.locator('.directory-error')).toContainText('Temporary failure');
  await expect(page.getByRole('button', { name: 'Remove Person 02 from course', exact: true })).toBeEnabled();
  expect(state.rows.filter(row => row.status === 'revoked')).toHaveLength(0);
  expect(state.writes).toHaveLength(1);
});

test('read-only co-instructors receive neither removal controls nor selection', async ({ page }) => {
  const state = await fixture(page, { manage: false });
  await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toBeHidden();
  await expect(page.locator('.people-select-person')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove .+ from course$/ })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('Ban remains independent and its completion unlocks filters and row actions', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Ban Person 03', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ban from course', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search people' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Unban Person 03', exact: true })).toBeEnabled();
  expect(state.writes[0].body).toMatchObject({ action: 'ban', expectedRevision: 0 });
});

for (const theme of ['light', 'dark']) test(`removal selection and confirmation fit mobile and pass accessibility in ${theme} mode`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { theme });
  await page.getByRole('checkbox', { name: 'Select people on this page' }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).include('.people-workspace').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `audit-results/course-people/removal-mobile-${theme}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  expect((await new AxeBuilder({ page }).include('.app-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove selected', exact: true })).toBeFocused();
});
