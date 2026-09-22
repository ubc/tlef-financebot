import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const questionId = '111111111111111111111111';
const secondId = '222222222222222222222222';
const courseId = 'cccccccccccccccccccccccc';
const oldVersion = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const currentVersion = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const attemptId = 'dddddddddddddddddddddddd';
const createdAt = '2026-09-20T18:42:00Z';
const identities = { courses: [{ _id: courseId, name: 'Finance foundations', courseCode: 'COMM 298' }], users: [{ puid: 'original-teacher', displayName: 'Jordan Lee', uid: 'jordan' }, { puid: 'latest-editor', displayName: 'Robin Patel', uid: 'robin' }, { puid: 'learner', displayName: 'Taylor Chen', uid: 'taylor' }] };
const question = { _id: questionId, courseId, currentVersionId: currentVersion, currentVersion: 2, state: 'draft', loIds: [], themeIds: [], labels: [], internalNotes: [], createdAt, updatedAt: createdAt };
const rows = [
  { ...question, creator: 'original-teacher', stem: 'Edited present value {{x}}', origin: { kind: 'manual' } },
  { ...question, _id: secondId, creator: 'original-teacher', stem: 'Second question', state: 'approved' },
];
const versions = [{ _id: currentVersion, version: 2, createdBy: 'latest-editor', createdAt, provenance: { kind: 'edited', parentVersionId: oldVersion } }, { _id: oldVersion, version: 1, createdBy: 'original-teacher', createdAt, provenance: { kind: 'generated', runId: 'eeeeeeeeeeeeeeeeeeeeeeee', item: 1 } }];
const detail = { ...identities, question, versions, recentFlags: [{ _id: 'f'.repeat(24), puid: 'learner', questionVersionId: oldVersion, reason: 'Wording needs clarification', state: 'open', createdAt }], recentAttempts: [{ _id: attemptId, puid: 'learner', questionVersionId: oldVersion, createdAt, selectedKey: 'B', correct: false, mode: 'topic-practice' }] };

async function fixture(page: Page, options: { hash?: string; list?: (route: Route) => Promise<void>; reproduction?: (route: Route) => Promise<void>; detail?: (route: Route) => Promise<void> } = {}) {
  const reads: string[] = [];
  const writes: string[] = [];
  await page.route('**/questions-workspace-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en" data-admin="true" data-theme="light"><head><title>All questions</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/admin-console.css"><link rel="stylesheet" href="/styles/admin-questions.css"><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script></head><body><main class="outlet" id="app"></main></body></html>` }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    reads.push(url.pathname + url.search);
    if (request.method() !== 'GET') writes.push(url.pathname);
    if (url.pathname === '/api/admin/all-questions') {
      if (options.list) return options.list(route);
      let items = rows;
      if (url.searchParams.get('q')) items = items.filter(item => item.stem.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase()));
      if (url.searchParams.get('state')) items = items.filter(item => item.state === url.searchParams.get('state'));
      return route.fulfill({ json: { ...identities, items, total: items.length, page: 1 } });
    }
    if (url.pathname.endsWith('/reproduce')) {
      if (options.reproduction) return options.reproduction(route);
      const recorded = !!url.searchParams.get('attemptId');
      const old = recorded || url.searchParams.get('versionId') === oldVersion;
      const seed = Number(url.searchParams.get('seed') || 1);
      const value = recorded ? 777 : seed * 10;
      return route.fulfill({ json: { version: { ...(old ? versions[1] : versions[0]), questionId, stem: 'Value {{x}}', type: 'mcq', difficulty: 'easy', options: [], sourceRefs: [] }, rendered: { stem: `${old ? 'Original' : 'Edited'} present value ${value}`, options: [{ key: 'A', text: `${value} units`, role: 'correct', explanation: 'Use this value.' }, { key: 'B', text: 'No value', role: 'clearly-wrong', explanation: 'Incorrect.' }] }, values: { x: value }, warnings: [], seed: recorded ? null : seed, source: recorded ? 'recorded-attempt' : 'seeded-sample', attempt: recorded ? { _id: attemptId, puid: 'learner', selectedKey: 'B', correct: false, createdAt } : null } });
    }
    if (url.pathname.startsWith('/api/admin/all-questions/')) {
      if (options.detail) return options.detail(route);
      return route.fulfill({ json: { ...detail, question: { ...question, _id: url.pathname.endsWith(secondId) ? secondId : questionId } } });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected API: ${url.pathname}` } });
  });
  await page.goto('/questions-workspace-fixture');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.evaluate(async hash => {
    location.hash = hash;
    const module = await import('/js/views/admin/questions.js');
    const render = () => {
      const id = location.hash.split('?')[0].split('/')[3];
      return id ? module.renderAdminQuestionDetail(document.querySelector('#app')!, { id }) : module.renderAdminQuestions(document.querySelector('#app')!);
    };
    window.addEventListener('hashchange', () => { void render(); });
    await render();
  }, options.hash || '#/admin/questions');
  return { reads, writes };
}

test('question filters survive inspection, pinned replay and closing without writes', async ({ page }) => {
  const { reads, writes } = await fixture(page, { hash: '#/admin/questions?actor=original-teacher&courseId=' + courseId });
  await expect(page.getByRole('button', { name: `Inspect question ${questionId}` })).toBeVisible();
  await expect(page.locator('.ac-metric').first()).toContainText('2');
  await page.getByLabel('Search questions').fill('Unsubmitted search draft');
  await page.getByRole('button', { name: `Inspect question ${questionId}` }).click();
  await expect(page).not.toHaveURL(/q=Unsubmitted/);
  await expect(page.getByRole('heading', { name: 'Version 2 · Seed 1', exact: true })).toBeVisible();
  await expect(page.getByText('Original creator', { exact: true }).last()).toBeVisible();
  await page.getByRole('tab', { name: 'Flags & attempts' }).click();
  await page.getByRole('button', { name: 'Replay this attempt' }).click();
  await expect(page.getByRole('heading', { name: 'Recorded attempt replay' })).toBeVisible();
  await expect(page.getByText('Original present value 777', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Question version', exact: true })).toBeDisabled();
  expect(reads.at(-1)).toContain(`attemptId=${attemptId}`);
  expect(reads.at(-1)).not.toContain('seed=');
  await expect(page).toHaveURL(new RegExp(`actor=original-teacher.*attemptId=${attemptId}`));
  await page.getByRole('button', { name: 'Close question details' }).click();
  await expect(page.locator('.aq-inspector')).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/admin/questions\\?actor=original-teacher&courseId=${courseId}$`));
  await expect(page.getByRole('button', { name: `Inspect question ${questionId}` })).toBeVisible();
  expect(writes).toEqual([]);
});

test('deep-linked recorded attempts and flagged versions retain exact evidence inputs', async ({ page }) => {
  const { reads } = await fixture(page, { hash: `#/admin/questions/${questionId}?attemptId=${attemptId}&versionId=${currentVersion}&seed=999` });
  await expect(page.getByText('Original present value 777', { exact: true })).toBeVisible();
  expect(reads.filter(url => url.includes('/reproduce')).every(url => url.endsWith(`attemptId=${attemptId}`))).toBe(true);
  await page.getByRole('tab', { name: 'Flags & attempts' }).click();
  await page.getByRole('button', { name: 'Inspect flagged version' }).click();
  await expect(page.getByRole('heading', { name: 'Version 1 · Seed 1', exact: true })).toBeVisible();
  expect(reads.at(-1)).toContain(`versionId=${oldVersion}&seed=1`);
  await page.getByRole('button', { name: 'Reproduce', exact: true }).click();
  await page.getByLabel('Random seed').fill('42');
  await expect(page.getByRole('heading', { name: 'Version 1 · Seed 1', exact: true })).toHaveCount(0);
  await page.locator('.aq-reproduce-form').getByRole('button', { name: 'Reproduce', exact: true }).click();
  await expect(page.getByText('Original present value 420', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`versionId=${oldVersion}&seed=42`));
});

test('missing replay evidence is explicit; version and filters remain recoverable after errors', async ({ page }) => {
  let fail = true;
  await fixture(page, { hash: `#/admin/questions/${questionId}?versionId=${oldVersion}&seed=7`, reproduction: async route => {
    if (fail) return route.fulfill({ status: 404, json: { error: 'The requested version is no longer retained.' } });
    return route.fulfill({ json: { version: { ...versions[1], options: [], sourceRefs: [] }, rendered: { stem: 'Retained template {{x}}', options: [] }, values: {}, error: 'This attempt did not retain parameter values; an exact replay is unavailable.', warnings: ['Unresolved placeholders remain in this sample.'], seed: null, source: 'recorded-attempt', attempt: { _id: attemptId, puid: 'learner', selectedKey: 'B', correct: false, createdAt } } });
  } });
  await expect(page.getByText('The requested version is no longer retained.')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry reproduction' }).click();
  await expect(page.getByRole('alert')).toContainText('an exact replay is unavailable');
  await page.keyboard.press('Escape');
  await page.getByLabel('Search questions').fill('does not exist');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching questions' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page.getByRole('button', { name: `Inspect question ${questionId}` })).toBeVisible();
});

test('server pagination totals stay truthful and stale searches cannot overwrite the latest query', async ({ page }) => {
  let delayed: Route | undefined;
  await fixture(page, { list: async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'old') { delayed = route; return; }
    return route.fulfill({ json: { ...identities, items: rows, total: 102, page: Number(url.searchParams.get('page') || 1) } });
  } });
  await expect(page.locator('.ac-metric').first()).toContainText('102');
  await expect(page.locator('.ac-metric').nth(1)).toContainText('2');
  await expect(page.getByText('1–2 of 102 questions')).toBeVisible();
  await page.getByRole('button', { name: 'Next result page' }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.getByLabel('Search questions').fill('old');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect.poll(() => !!delayed).toBe(true);
  await page.getByLabel('Publication state').selectOption('approved');
  // The second response stays independent of the earlier in-flight request.
  await page.getByLabel('Search questions').fill('latest');
  await page.getByLabel('Publication state').selectOption('draft');
  await expect(page.getByRole('button', { name: `Inspect question ${questionId}` })).toBeVisible();
  await delayed!.fulfill({ json: { ...identities, items: [], total: 0, page: 1 } });
  await expect(page.getByRole('button', { name: `Inspect question ${questionId}` })).toBeVisible();
  await expect(page).toHaveURL(/q=latest&state=draft/);
});

for (const width of [1440, 580, 390]) test(`compact questions and inspector are accessible at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page);
  await expect(page.getByRole('button', { name: `Inspect question ${questionId}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const rowTop = await page.locator('.aq-table tbody tr').first().evaluate(node => node.getBoundingClientRect().top);
  expect(rowTop).toBeLessThan(400);
  const scan = async () => (await new AxeBuilder({ page }).include('.admin-questions').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
  expect(await scan()).toEqual([]);
  await page.getByRole('button', { name: `Inspect question ${questionId}` }).click();
  await expect(page.getByRole('heading', { name: 'Version 2 · Seed 1', exact: true })).toBeVisible();
  expect(await scan()).toEqual([]);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  expect(await scan()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `audit-results/admin-workspace/questions-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('.aq-inspector')).toBeHidden();
});
