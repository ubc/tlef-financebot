import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const courseId = '507f1f77bcf86cd799439011', examId = '507f1f77bcf86cd799439022', loId = '507f1f77bcf86cd799439033';
const base = `/api/courses/${courseId}/exam-builder/${examId}`;
const settings = () => ({ title: 'Fall midterm', kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: '2026-10-13T19:00:00.000Z', closesAt: '2026-10-13T21:00:00.000Z', timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] as Array<{ puid: string; extraMinutes: number }> });

async function fixture(page: Page, options: { blankOpening?: boolean; published?: boolean; dark?: boolean } = {}) {
  const exam = { _id: examId, courseId, revision: 4, settings: settings(), items: [{ id: '5eae1bc4-b4ab-4414-a0cf-10085511515a', source: 'bank', familyId: 'market-risk', loIds: [loId], type: 'true-false', difficulty: 'easy', stem: 'Diversification removes all market risk.', options: [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Market risk remains.' }, { key: 'B', text: 'False', role: 'correct', explanation: 'Market risk remains.' }], points: 1, minutes: 1, validated: true, practiceExposure: true, approval: { by: 'teacher', at: '2026-10-12T00:00:00.000Z' } }], createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z', createdBy: 'teacher', publishedRevision: options.published ? 4 : undefined, publicationId: options.published ? '507f1f77bcf86cd799439099' : undefined };
  if (options.blankOpening) exam.settings.opensAt = '';
  const state = { exam, failNextSave: false, holdSave: undefined as Promise<void> | undefined, holdPublish: undefined as Promise<void> | undefined, calls: [] as Array<{ path: string; body: { revision?: number; settings?: ReturnType<typeof settings> } }>, unhandled: [] as string[], errors: [] as string[] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(() => {
    class ExamEventSource extends EventTarget {
      private listener = (event: Event) => this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify((event as CustomEvent).detail) }));
      constructor(public url: string) { super(); window.addEventListener('exam-test-snapshot', this.listener); }
      close() { window.removeEventListener('exam-test-snapshot', this.listener); }
    }
    Object.defineProperty(window, 'EventSource', { value: ExamEventSource });
  });
  await page.route('**/exam-publish-autosave-test.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en" data-theme="${options.dark ? 'dark' : 'light'}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Exam publication</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/exam-builder.css"><script defer src="/vendor/katex.min.js"></script><script defer src="/vendor/katex-auto-render.min.js"></script><script defer src="/vendor/marked.min.js"></script><script defer src="/vendor/purify.min.js"></script></head><body><main id="app"></main><script type="module">import { renderExamBuilder } from '/js/views/instructor/exam-builder.js'; await renderExamBuilder(document.getElementById('app'), { id: '${courseId}', examId: '${examId}' });</script></body></html>` }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'GET' ? {} : route.request().postDataJSON();
    if (path === `${base}/settings` || path === `${base}/publish`) {
      state.calls.push({ path, body });
      if (path.endsWith('/settings') && state.holdSave) await state.holdSave;
      if (path.endsWith('/publish') && state.holdPublish) await state.holdPublish;
      if (path.endsWith('/settings') && state.failNextSave) { state.failNextSave = false; return route.fulfill({ status: 503, json: { error: 'Settings could not be saved. Try again.' } }); }
      if (body.revision !== exam.revision) return route.fulfill({ status: 409, json: { error: 'This exam changed in another session. Reload before saving.' } });
      if (path.endsWith('/settings')) exam.settings = structuredClone(body.settings);
      exam.revision++;
      if (path.endsWith('/publish')) { exam.publishedRevision = exam.revision; exam.publicationId = '507f1f77bcf86cd799439099'; }
      return route.fulfill({ json: exam });
    }
    if (path === base) return route.fulfill({ json: { exam, candidates: [], runs: [] } });
    if (path === `/api/courses/${courseId}/outline`) return route.fulfill({ json: { course: { _id: courseId, name: 'Corporate Finance' }, themes: [{ _id: loId, name: 'Risk', los: [{ _id: loId, name: 'Explain diversification' }] }] } });
    if (path === `/api/courses/${courseId}/exam-builder/bank`) return route.fulfill({ json: { total: 0, questions: [] } });
    state.unhandled.push(path); return route.fulfill({ status: 404, json: { error: `Missing fixture ${path}` } });
  });
  await page.goto('/exam-publish-autosave-test.html');
  await page.getByRole('button', { name: '3 Publish', exact: true }).click();
  return state;
}

async function snapshot(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  await page.evaluate(data => window.dispatchEvent(new CustomEvent('exam-test-snapshot', { detail: data })), { exam: state.exam, candidates: [], runs: [] });
}

function clean(state: Awaited<ReturnType<typeof fixture>>) { expect(state.errors).toEqual([]); expect(state.unhandled).toEqual([]); }

test('review autosaves every current field and publishes the exact saved revision', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByRole('button', { name: 'Save settings', exact: true })).toHaveCount(0);
  await page.getByLabel('Exam title', { exact: true }).fill('Renamed paper');
  await page.getByLabel('Duration (minutes)', { exact: true }).fill('90');
  await page.getByLabel('Score and answer release').selectOption('after-close');
  await page.getByLabel('Opens · your timezone', { exact: false }).fill('2026-10-13T12:34');
  await page.getByLabel('Shuffle question order').check();
  await page.getByText('Individual timing accommodations', { exact: true }).click();
  await page.getByLabel('Student PUID, extra minutes').fill('PUID-STUDENT-0001, 30');
  await page.screenshot({ path: 'audit-results/assessment-preview-2026-10-13/settings-before-auto-save.png', fullPage: true });
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('dialog')).toContainText('Renamed paper');
  await page.screenshot({ path: 'audit-results/assessment-preview-2026-10-13/settings-auto-saved-confirmation.png', fullPage: true });
  await expect(page.getByRole('dialog')).toContainText('90 minutes');
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0]).toMatchObject({ path: `${base}/settings`, body: { revision: 4, settings: { title: 'Renamed paper', durationMinutes: 90, feedback: 'after-close', opensAt: '2026-10-13T19:34:00.000Z', timeZone: 'America/Vancouver', shuffle: true, accommodations: [{ puid: 'PUID-STUDENT-0001', extraMinutes: 30 }] } } });
  await page.getByRole('button', { name: 'Publish exam', exact: true }).click();
  await expect(page.getByText('Published revision', { exact: true })).toBeVisible();
  expect(state.calls[1]).toEqual({ path: `${base}/publish`, body: { revision: 5 } });
  expect(state.exam.settings.title).toBe('Renamed paper'); clean(state);
});

test('failed save retains edits, blocks publication and allows retry', async ({ page }) => {
  const state = await fixture(page); state.failNextSave = true;
  await page.getByLabel('Exam title', { exact: true }).fill('Keep this title');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('alert')).toContainText('Settings could not be saved');
  await expect(page.getByLabel('Exam title', { exact: true })).toHaveValue('Keep this title');
  await expect(page.getByLabel('Exam title', { exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.exam.settings.title).toBe('Fall midterm');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.calls.filter(call => call.path.endsWith('/settings'))).toHaveLength(2);
  expect(state.calls.filter(call => call.path.endsWith('/publish'))).toHaveLength(0); clean(state);
});

test('invalid availability, duration and accommodations remain editable before any save', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Closes · your timezone').fill('');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('alert')).toContainText('closing time');
  await page.getByLabel('Closes · your timezone').fill('2026-10-13T14:00');
  await page.getByLabel('Duration (minutes)').fill('1.5');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('alert')).toContainText('whole number');
  await page.getByLabel('Duration (minutes)').fill('60');
  await page.getByText('Individual timing accommodations', { exact: true }).click();
  await page.getByLabel('Student PUID, extra minutes').fill('PUID-STUDENT');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('alert')).toContainText('one student PUID');
  await expect(page.getByLabel('Student PUID, extra minutes')).toHaveValue('PUID-STUDENT');
  expect(state.calls).toEqual([]); clean(state);
});

test('a slow save freezes fields and ignores duplicate review clicks', async ({ page }) => {
  const state = await fixture(page); let release!: () => void;
  state.holdSave = new Promise<void>(resolve => { release = resolve; });
  await page.getByLabel('Exam title', { exact: true }).fill('Only once');
  await page.getByRole('button', { name: 'Review & publish' }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => state.calls.length).toBe(1);
  await expect(page.getByLabel('Exam title', { exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.calls).toHaveLength(1); clean(state);
});

test('dirty inputs survive a concurrent revision and save fails with original CAS', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Exam title', { exact: true }).fill('My unsaved title');
  state.exam.revision = 5; state.exam.settings.title = 'Another instructor title';
  await snapshot(page, state);
  await expect(page.getByLabel('Exam title', { exact: true })).toHaveValue('My unsaved title');
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('alert')).toContainText('another session');
  expect(state.calls[0].body.revision).toBe(4);
  await expect(page.getByLabel('Exam title', { exact: true })).toHaveValue('My unsaved title');
  await expect(page.getByRole('dialog')).toHaveCount(0); clean(state);
});

test('a newer paper revision invalidates the reviewed confirmation', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  state.exam.revision++; state.exam.settings.title = 'Changed after review';
  await snapshot(page, state);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('alert')).toContainText('changed after your review');
  expect(state.calls.filter(call => call.path.endsWith('/publish'))).toEqual([]); clean(state);
});

test('an empty legacy opening defaults to now in browser timezone without overwriting chosen release', async ({ page }) => {
  const before = Date.now(); const state = await fixture(page, { blankOpening: true });
  const opening = await page.getByLabel('Opens · your timezone', { exact: false }).inputValue();
  const instant = await page.evaluate(value => new Date(value).getTime(), opening);
  expect(Math.abs(instant - before)).toBeLessThan(60000);
  await expect(page.getByLabel('Score and answer release')).toHaveValue('instructor');
  expect(state.exam.settings.opensAt).toBe(''); expect(state.calls).toEqual([]);
  await page.screenshot({ path: 'audit-results/assessment-preview-2026-10-13/default-opening-now.png', fullPage: true }); clean(state);
});

test('existing explicit settings and published snapshots remain unchanged', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByLabel('Opens · your timezone', { exact: false })).toHaveValue('2026-10-13T12:00');
  await expect(page.getByLabel('Score and answer release')).toHaveValue('instructor');
  expect(state.calls).toEqual([]);
  const published = await fixture(page, { published: true });
  await expect(page.getByText('Published revision', { exact: true })).toBeVisible();
  await expect(page.locator('[data-setting]')).toHaveCount(0);
  expect(published.calls).toEqual([]); clean(published);
});

test('unsaved settings can move between paper tabs and return intact', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Exam title', { exact: true }).fill('Keep between tabs');
  await page.getByRole('button', { name: '2 Review paper', exact: true }).click();
  await page.getByRole('button', { name: '3 Publish', exact: true }).click();
  await expect(page.getByLabel('Exam title', { exact: true })).toHaveValue('Keep between tabs');
  expect(state.calls).toEqual([]); clean(state);
});

test('compact publication settings retain accessible mobile dark layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, { dark: true });
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include('.eb-content').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]); clean(state);
});

test('Student preview saves a partial draft before entering the isolated assessment route', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Exam title', { exact: true }).fill('Rehearsal paper');
  await page.getByLabel('Closes · your timezone').fill('');
  await page.getByRole('button', { name: 'Student preview', exact: true }).click();
  await expect.poll(() => page.url()).toContain(`/preview/course/${courseId}/assessments?examId=${examId}&workspace=student`);
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0].body.settings).toMatchObject({ title: 'Rehearsal paper', closesAt: '' });
  expect(state.calls[0].path).toBe(`${base}/settings`); clean(state);
});

test('reviewing unchanged settings preserves stored seconds and needs no save request', async ({ page }) => {
  const state = await fixture(page);
  state.exam.settings.opensAt = '2026-10-13T19:00:32.123Z';
  state.exam.settings.closesAt = '2026-10-13T21:00:45.456Z';
  state.exam.revision++;
  await snapshot(page, state);
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.calls).toEqual([]);
  expect(state.exam.settings.opensAt).toBe('2026-10-13T19:00:32.123Z'); clean(state);
});

test('duplicate final publication clicks issue only one request', async ({ page }) => {
  const state = await fixture(page); let release!: () => void;
  state.holdPublish = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await page.getByRole('button', { name: 'Publish exam', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => state.calls.filter(call => call.path.endsWith('/publish')).length).toBe(1);
  release();
  await expect(page.getByText('Published revision', { exact: true })).toBeVisible();
  expect(state.calls).toHaveLength(1); clean(state);
});

test('Student preview save failure keeps the editor and draft instead of navigating', async ({ page }) => {
  const state = await fixture(page); state.failNextSave = true;
  await page.getByLabel('Exam title', { exact: true }).fill('Unsaved rehearsal');
  await page.getByRole('button', { name: 'Student preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Settings could not be saved');
  await expect(page.getByLabel('Exam title', { exact: true })).toHaveValue('Unsaved rehearsal');
  expect(page.url()).not.toContain('/preview/course'); clean(state);
});

test.use({ timezoneId: 'America/Vancouver' });
