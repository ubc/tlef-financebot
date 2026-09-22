import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { CourseSharingSummary } from '../../client/src/course-sharing-api';

const COURSE = '507f1f77bcf86cd799439011';
const BASE: CourseSharingSummary = {
  courseId: COURSE, courseName: 'Finance Foundations', courseCode: 'FIN 101', section: '001', term: '2026W1',
  ownerPuid: 'owner-puid', canManage: true,
  members: [
    { puid: 'owner-puid', displayName: 'Course Owner', email: 'owner@ubc.ca', role: 'owner', deactivated: false },
    { puid: 'Colleague.PUID', displayName: 'Teaching Colleague', email: 'colleague@ubc.ca', role: 'co-instructor', deactivated: false },
  ],
  invitations: [{ id: 'pending-1', email: 'pending@ubc.ca', status: 'pending', invitedAt: '2026-09-20T20:00:00Z', updatedAt: '2026-09-20T20:00:00Z' }],
};

async function fixture(page: Page, options: { canManage?: boolean; theme?: string; surface?: 'page' | 'dialog' } = {}) {
  const summary = structuredClone(BASE);
  summary.canManage = options.canManage ?? true;
  const writes: Array<{ path: string; method: string; body: unknown }> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/sharing-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en" data-theme="${options.theme ?? 'light'}"><head><title>Course sharing</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/course-sharing.css"></head><body><header><button id="share" class="btn">Share</button></header><main id="fixture" class="outlet"></main></body></html>` }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== 'GET') writes.push({ path, method, body: route.request().postDataJSON() });
    if (path === `/api/courses/${COURSE}/instructors` && method === 'GET') return route.fulfill({ json: summary });
    if (!summary.canManage) return route.fulfill({ status: 403, json: { error: 'Only the owner or an Admin can manage sharing.' } });
    if (path === `/api/courses/${COURSE}/instructor-invitations` && method === 'POST') {
      const { identifier } = route.request().postDataJSON() as { identifier: string };
      const active = identifier === 'known@ubc.ca' || identifier === 'knowncwl';
      const email = identifier === 'knowncwl' ? 'known@ubc.ca' : identifier;
      if (active) summary.members.push({ puid: 'known-puid', displayName: 'Known Colleague', email, role: 'co-instructor', deactivated: false });
      summary.invitations.push({ id: `invite-${summary.invitations.length}`, email, status: active ? 'active' : 'pending', invitedAt: '2026-09-20T21:00:00Z', updatedAt: '2026-09-20T21:00:00Z' });
      return route.fulfill({ json: summary });
    }
    if (path.startsWith(`/api/courses/${COURSE}/instructor-invitations/`) && method === 'DELETE') {
      const invite = summary.invitations.find(invitation => invitation.id === path.split('/').pop());
      if (invite) invite.status = 'revoked';
      return route.fulfill({ json: summary });
    }
    if (path.startsWith(`/api/courses/${COURSE}/instructors/`) && method === 'DELETE') {
      summary.members = summary.members.filter(member => member.puid !== decodeURIComponent(path.split('/').pop()!));
      return route.fulfill({ json: summary });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected sharing API: ${path}` } });
  });
  await page.goto('/sharing-fixture');
  await page.addStyleTag({ content: '*,*::before,*::after { animation:none!important; transition:none!important }' });
  await page.evaluate(async ({ courseId, surface }) => {
    const { openCourseSharing } = await import('/js/course-sharing.js');
    document.getElementById('share')!.addEventListener('click', () => openCourseSharing(courseId));
    if (surface === 'page') {
      const { renderCoInstructors } = await import('/js/views/instructor/co-instructors.js');
      renderCoInstructors(document.getElementById('fixture')!, { id: courseId });
    }
  }, { courseId: COURSE, surface: options.surface });
  return { summary, writes, errors };
}

async function openShare(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share course', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Finance Foundations', exact: true })).toBeVisible();
  return dialog;
}

test('owner sees member and pending identities, protected ownership, and a restricted copy link', async ({ page }) => {
  const state = await fixture(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } } }));
  const dialog = await openShare(page);
  await expect(dialog.locator('[data-member-puid="owner-puid"]')).toContainText('Owner');
  await expect(dialog.locator('[data-member-puid="owner-puid"]').getByRole('button')).toHaveCount(0);
  await expect(dialog.getByText('Awaiting first CWL sign-in', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/No email is sent/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(copied).toBe(`http://127.0.0.1:6118/#/instructor/course/${COURSE}?workspace=instructor`);
  await expect(dialog.getByRole('status')).toContainText('Only people with course access');
  expect(state.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeFocused();
  expect(state.errors).toEqual([]);
});

test('known CWL accounts activate immediately; new UBC emails remain pending without sending email', async ({ page }) => {
  const state = await fixture(page, { surface: 'page' });
  await expect(page.getByRole('heading', { name: 'Co-instructors', exact: true })).toBeVisible();
  await expect(page.getByLabel('UBC email or CWL', { exact: true })).toBeVisible();
  await page.getByLabel('UBC email or CWL', { exact: true }).fill('New.Colleague@sauder.ubc.ca');
  await page.getByRole('button', { name: 'Add co-instructor', exact: true }).click();
  await expect(page.getByText('new.colleague@sauder.ubc.ca', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Invitation saved');
  await page.getByLabel('UBC email or CWL', { exact: true }).fill('knowncwl');
  await page.getByRole('button', { name: 'Add co-instructor', exact: true }).click();
  await expect(page.getByText('Known Colleague', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Co-instructor access is active.');
  await expect(page.getByLabel('UBC email or CWL', { exact: true })).toHaveValue('');
  expect(state.writes.map(write => write.body)).toEqual([{ identifier: 'new.colleague@sauder.ubc.ca' }, { identifier: 'knowncwl' }]);
  expect(state.writes.every(write => write.path.endsWith('/instructor-invitations'))).toBe(true);
  expect(state.errors).toEqual([]);
});

test('failed invitations retain the draft; request progress blocks duplicate writes and closing', async ({ page }) => {
  await fixture(page);
  let calls = 0;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/courses/${COURSE}/instructor-invitations`, async route => {
    calls++;
    if (calls === 1) {
      await wait;
      return route.fulfill({ status: 503, json: { error: 'Invitation could not be saved. Try again.' } });
    }
    return route.fallback();
  });
  const dialog = await openShare(page);
  const add = dialog.getByRole('button', { name: 'Add co-instructor', exact: true });
  await dialog.getByLabel('UBC email or CWL', { exact: true }).fill('retry@ubc.ca');
  await add.click();
  await expect(add).toHaveAttribute('aria-busy', 'true');
  await expect(add).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close course sharing', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await add.dispatchEvent('click');
  expect(calls).toBe(1);
  release();
  await expect(dialog.getByRole('alert')).toHaveText('Invitation could not be saved. Try again.');
  await expect(dialog.getByLabel('UBC email or CWL', { exact: true })).toHaveValue('retry@ubc.ca');
  await expect(add).toBeEnabled();
  await add.click();
  await expect(dialog.getByText('retry@ubc.ca', { exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

test('removal and revocation require confirmation and only change the selected course identity', async ({ page }) => {
  const state = await fixture(page);
  const dialog = await openShare(page);
  await dialog.getByRole('button', { name: 'Remove Teaching Colleague', exact: true }).click();
  await page.getByRole('dialog', { name: 'Remove co-instructor?', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Remove Teaching Colleague', exact: true }).click();
  await page.getByRole('dialog', { name: 'Remove co-instructor?', exact: true }).getByRole('button', { name: 'Remove co-instructor', exact: true }).click();
  await expect(dialog.getByText('Teaching Colleague', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Revoke invitation for pending@ubc.ca', exact: true }).click();
  await page.getByRole('dialog', { name: 'Revoke invitation?', exact: true }).getByRole('button', { name: 'Revoke invitation', exact: true }).click();
  await expect(dialog.getByText('pending@ubc.ca', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Course Owner', { exact: true })).toBeVisible();
  expect(state.writes.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: 'DELETE', path: `/api/courses/${COURSE}/instructors/Colleague.PUID` },
    { method: 'DELETE', path: `/api/courses/${COURSE}/instructor-invitations/pending-1` },
  ]);
  expect(state.errors).toEqual([]);
});

test('co-instructors can inspect and copy access while owner-only controls stay absent', async ({ page }) => {
  const state = await fixture(page, { canManage: false, surface: 'page' });
  await expect(page.getByText('Only the course owner or an Admin can add or remove co-instructors.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('UBC email or CWL', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: /^Remove |^Revoke invitation/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByText('Teaching Colleague', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('load failures retry, invalid email stays local, and clipboard denial selects the restricted link', async ({ page }) => {
  const state = await fixture(page);
  let reads = 0;
  await page.route(`**/api/courses/${COURSE}/instructors`, route => {
    reads++;
    return reads === 1 ? route.fulfill({ status: 503, json: { error: 'Course access is temporarily unavailable.' } }) : route.fallback();
  });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard denied'); } } }));
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share course', exact: true });
  await expect(dialog.getByRole('alert')).toHaveText('Course access is temporarily unavailable.');
  await dialog.getByRole('button', { name: 'Refresh access', exact: true }).click();
  await expect(dialog.getByLabel('UBC email or CWL', { exact: true })).toBeVisible();
  await dialog.getByLabel('UBC email or CWL', { exact: true }).fill('outsider@example.com');
  await dialog.getByRole('button', { name: 'Add co-instructor', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter a UBC email address or CWL');
  expect(state.writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Restricted course link', exact: true })).toBeFocused();
  await expect(dialog.getByRole('alert')).toContainText('Copy the selected course link');
  expect(await dialog.getByRole('textbox', { name: 'Restricted course link', exact: true }).evaluate(node => (node as HTMLInputElement).selectionEnd)).toBeGreaterThan(0);
});

test('a closed dialog ignores a late course-access response and releases focus', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/courses/${COURSE}/instructors`, async route => { await wait; return route.fulfill({ json: BASE }); });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText('Loading course access…', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeFocused();
  await expect(page.getByText('Course Owner', { exact: true })).toHaveCount(0);
});

for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
  test(`sharing dialog remains readable and accessible at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page, { theme });
    const dialog = await openShare(page);
    await expect(dialog.getByRole('button', { name: 'Add co-instructor', exact: true })).toHaveCSS('background-color', 'rgb(26, 31, 26)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.course-sharing-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `audit-results/course-sharing/share-${width}-${theme}.png` });
  });
}
