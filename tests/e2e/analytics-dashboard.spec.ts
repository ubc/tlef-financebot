import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const course = '111111111111111111111111', objective = '222222222222222222222222';
const question = '333333333333333333333333', historical = '444444444444444444444444';
const current = '555555555555555555555555';
const rates = [{ themeId: 'theme', name: 'Risk', attempts: 12, insufficient: false, failureRate: .5, los: [{ loId: objective, name: 'Value at Risk', attempts: 12, insufficient: false, failureRate: .5 }, { loId: 'empty', name: 'Duration', attempts: 0, insufficient: true }] }];
const patterns = { items: [
  { questionId: question, versionId: historical, version: 1, isCurrent: false, available: true, stem: 'How much is the historical value?', loId: objective, loName: 'Value at Risk', themeId: 'theme', themeName: 'Risk', attempts: 6, insufficient: false, failureRate: 0 },
  { questionId: question, versionId: current, version: 2, isCurrent: true, available: true, objectiveCount: 2, stem: 'How much is the current value?', loId: objective, loName: 'Value at Risk', themeId: 'theme', themeName: 'Risk', attempts: 6, insufficient: false, failureRate: 1 },
], total: 2, limit: 20 };
async function fixture(page: Page, individual = true) {
  await page.route('**/analytics-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Analytics</title><link rel="stylesheet" href="/styles/main.css"></head><body><main id="app"></main></body></html>' }));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'teacher', courseRoles: [{ courseId: course, role: 'instructor' }] } } });
    if (path.includes('/tutorials')) return route.fulfill({ json: [] });
    if (path.endsWith('/capabilities/me')) return route.fulfill({ json: { 'analytics.individual': individual } });
    if (path.endsWith('/failure-rates')) return route.fulfill({ json: url.searchParams.get('mode') === 'exam-prep' ? [{ ...rates[0], attempts: 3, insufficient: true, failureRate: undefined, los: rates[0].los.map((item) => ({ ...item, attempts: 3, insufficient: true, failureRate: undefined })) }] : rates });
    if (path.endsWith('/question-patterns')) return route.fulfill({ json: patterns });
    if (path.endsWith('/distribution')) return route.fulfill({ json: { questionId: question, versionId: historical, version: 1, stem: 'Recorded historical stem', isCurrent: false, attempts: 6, insufficient: false, misconceptionHighlight: false, options: [{ key: 'A', text: 'Recorded old answer', role: 'correct', count: 6, pct: 1 }] } });
    if (path.endsWith('/engagement')) return route.fulfill({ json: { totals: { questionsAttempted: 12, sessionsPerStudent: 2, avgSessionMinutes: 5, loCoverageRate: .5, reviewBookActivityRate: 0 }, weeks: [{ week: '2026-08-30', questionsAttempted: 12, sessions: 2, activeStudents: 1, avgSessionMinutes: 5 }, { week: '2026-09-06', questionsAttempted: 0, sessions: 0, activeStudents: 0, avgSessionMinutes: 0 }] } });
    if (path.endsWith('/low-engagement')) return route.fulfill({ json: [] });
    if (path.endsWith('/students')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: 'Unmocked API' } });
  });
  await page.goto('/analytics-fixture');
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  await page.evaluate(async (id) => {
    window.location.hash = `/instructor/course/${id}/analytics`;
    await (await import('/js/auth.js')).loadSession();
    (await import('/js/views/instructor/analytics.js')).renderAnalytics(document.querySelector('#app')!, { id });
  }, course);
  await expect(page.getByText(/Last updated/)).toBeVisible();
}
test('scope, objective/version selection and CSV match; search submits with Enter', async ({ page }) => {
  await fixture(page);
  await expect(page.getByText(/Across 2 learning objectives/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Topic Practice', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('Risk · 50% incorrect · 12 attempts', { exact: true }).click();
  await expect(page.getByText('No attempts in this scope. Review question availability.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Question patterns learning objective' }).selectOption(objective);
  await page.getByRole('button', { name: 'View version 1 answers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Version 1 · Historical content' })).toBeVisible();
  await expect(page.getByText('A. Recorded old answer · correct · 6 (100%)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review question (recorded version 1)' })).toHaveAttribute('href', new RegExp(`analyticsVersionId=${historical}`));
  const request = page.waitForRequest((req) => req.url().includes('failure-rates') && req.url().includes('mode=exam-prep'));
  await page.getByRole('button', { name: 'Exam Prep', exact: true }).click(); await request;
  await expect(page.getByText('Risk · Insufficient data · 3 attempts', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Outcome date range' }).selectOption('7');
  await expect(page.getByRole('link', { name: 'Export weekly CSV' })).toHaveAttribute('href', /mode=exam-prep&from=.+&to=/);
  await expect(page.getByRole('combobox', { name: 'Question patterns learning objective' })).toHaveValue(objective);
  await page.getByRole('textbox', { name: 'Student search' }).fill('Nobody'); await page.keyboard.press('Enter');
  await expect(page.getByText('No matching students in this course.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Student search' })).toBeFocused();
});
test('late mode responses cannot overwrite newer selected scope', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/analytics/failure-rates**', async (route) => {
    if (route.request().url().includes('mode=exam-prep')) { await delayed; return route.fulfill({ json: [{ ...rates[0], name: 'STALE EXAM' }] }); }
    return route.fulfill({ json: rates });
  });
  await page.getByRole('button', { name: 'Exam Prep', exact: true }).click();
  await page.getByRole('button', { name: 'Topic Practice', exact: true }).click();
  await expect(page.getByText('Risk · 50% incorrect · 12 attempts', { exact: true })).toBeVisible();
  release(); await page.waitForTimeout(150);
  await expect(page.getByText(/STALE EXAM/)).toHaveCount(0);
});
test('empty patterns, insufficient distribution, section retries and profile permission stay scoped', async ({ page }) => {
  await fixture(page, false);
  await expect(page.getByText('Individual profiles are unavailable with your course permissions.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Student search' })).toHaveCount(0);
  await page.route('**/analytics/questions/**/distribution**', (route) => route.fulfill({ json: { version: 1, stem: 'Tiny sample', isCurrent: false, attempts: 3, insufficient: true, options: [{ key: 'A', text: 'Do not infer', count: 3 }] } }));
  await page.getByRole('button', { name: 'View version 1 answers', exact: true }).click();
  await expect(page.getByText(/3 attempts · Insufficient data/)).toBeVisible();
  await expect(page.getByText(/Do not infer/)).toHaveCount(0);
  await page.route('**/analytics/question-patterns**', (route) => route.fulfill({ json: { items: [], total: 0, limit: 20 } }));
  await page.route('**/analytics/engagement?**', (route) => route.fulfill({ status: 503, json: { error: 'Temporary engagement outage' } }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/No question attempts in this scope/)).toBeVisible();
  await expect(page.getByText('Temporary engagement outage')).toBeVisible();
  await expect(page.getByText('Risk · 50% incorrect · 12 attempts', { exact: true })).toBeVisible();
});
for (const width of [390, 1280]) for (const theme of ['light', 'dark']) test(`analytics readable and accessible ${width}px ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await fixture(page);
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/private/tmp/financebot-role-experience/analytics-${width}-${theme}.png`, fullPage: true });
});

test('late distribution and student search results cannot survive a newer selection', async ({ page }) => {
  await fixture(page);
  let releaseDistribution!: () => void;
  const distributionGate = new Promise<void>((resolve) => { releaseDistribution = resolve; });
  await page.route('**/analytics/questions/**/distribution**', async (route) => {
    if (route.request().url().includes(historical)) await distributionGate;
    return route.fulfill({ json: { version: route.request().url().includes(historical) ? 1 : 2, stem: route.request().url().includes(historical) ? 'Stale distribution' : 'Current distribution', isCurrent: true, attempts: 6, insufficient: false, options: [] } });
  });
  await page.getByRole('button', { name: 'View version 1 answers', exact: true }).click();
  await page.getByRole('button', { name: 'View version 2 answers', exact: true }).click();
  await expect(page.getByText('Current distribution', { exact: true })).toBeVisible();
  releaseDistribution(); await page.waitForTimeout(100);
  await expect(page.getByText('Stale distribution', { exact: true })).toHaveCount(0);
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
  await page.route('**/students?q=First', async (route) => { await searchGate; return route.fulfill({ json: [{ puid: 'student', uid: 'first', displayName: 'Stale student' }] }); });
  await page.getByRole('textbox', { name: 'Student search' }).fill('First'); await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Student search' }).fill('Second');
  releaseSearch(); await page.waitForTimeout(100);
  await expect(page.getByText(/Stale student/)).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/another'; });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForTimeout(100);
  await expect(page.getByText(/Last updated/)).toHaveCount(0);
});

test('sort cannot restore previous-scope evidence while a refresh is pending or failed', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/analytics/failure-rates**', async (route) => {
    await gate;
    return route.fulfill({ status: 503, json: { error: 'New scope unavailable' } });
  });
  await page.getByRole('button', { name: 'Exam Prep', exact: true }).click();
  const sort = page.getByRole('combobox', { name: 'Sort outcomes' });
  await expect(sort).toBeDisabled();
  // A queued/programmatic change must also be unable to render invalidated data.
  await sort.dispatchEvent('change');
  await expect(page.getByText('Risk · 50% incorrect · 12 attempts', { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText('New scope unavailable')).toBeVisible();
  await sort.dispatchEvent('change');
  await expect(page.getByText('New scope unavailable')).toBeVisible();
  await expect(page.getByText('Risk · 50% incorrect · 12 attempts', { exact: true })).toHaveCount(0);
  await expect(sort).toBeDisabled();
});

test('historical review distinguishes transient errors and retries without resetting the editor', async ({ page }) => {
  await fixture(page);
  await page.route(`**/api/questions/${question}`, (route) => route.fulfill({ json: {
    id: question, courseId: course, currentVersionId: current, currentVersion: 2, state: 'draft', loIds: [], themeIds: [], labels: [], internalNotes: [], versions: [],
    current: { _id: current, questionId: question, version: 2, type: 'mcq', stem: 'Current editable stem', difficulty: 'easy', options: [], sourceRefs: [], createdBy: 'teacher', createdAt: '2026-09-01' },
  } }));
  await page.route(`**/api/courses/${course}`, (route) => route.fulfill({ json: { id: course, name: 'Analytics fixture', themes: [] } }));
  let calls = 0;
  await page.route('**/analytics/questions/**/distribution**', (route) => {
    calls += 1;
    return calls === 1 ? route.fulfill({ status: 503, json: { error: 'Historical service interrupted' } })
      : route.fulfill({ json: { version: 1, isCurrent: false, stem: 'Historical recovered stem', options: [] } });
  });
  await page.evaluate(async ({ id, questionId, versionId }) => {
    location.hash = `/instructor/course/${id}/bank/${questionId}?analyticsVersionId=${versionId}`;
    (await import('/js/views/instructor/question-detail.js')).renderQuestionDetail(document.querySelector('#app')!, { id, questionId });
  }, { id: course, questionId: question, versionId: historical });
  const notice = page.getByRole('region', { name: 'Recorded analytics version' });
  await expect(notice.getByText(/Historical service interrupted/)).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Question stem', exact: true });
  await editor.fill('Unsaved local edit');
  await notice.getByRole('button', { name: 'Try again' }).click();
  await expect(notice.getByText('Historical recovered stem', { exact: true })).toBeVisible();
  await expect(editor).toHaveValue('Unsaved local edit');
  await page.route('**/analytics/questions/**/distribution**', (route) => route.fulfill({ status: 404, json: { error: 'question-version-not-found' } }));
  await page.evaluate(async ({ id, questionId }) => {
    (await import('/js/views/instructor/question-detail.js')).renderQuestionDetail(document.querySelector('#app')!, { id, questionId });
  }, { id: course, questionId: question });
  await expect(notice.getByText('The requested recorded version was not found or its identifier is invalid.')).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});
