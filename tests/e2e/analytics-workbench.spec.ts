import { test, expect, type Page } from '@playwright/test';

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
    if (path.endsWith('/exam-scores')) return route.fulfill({ json: { items: [{ id: 's', puid: 'learner', displayName: 'Alex', templateId: 'exam', templateKind: 'midterm', submittedAt: '2026-09-14', score: 12, maxScore: 20 }], excludedUnscored: 0 } });
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

test('workbench tabs preserve question scope and show submitted scores', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Risk', exact: true }).click();
  await page.getByRole('button', { name: 'Value at Risk →', exact: true }).first().click();
  await expect(page.getByRole('combobox', { name: 'Question patterns learning objective' })).toHaveValue(objective);
  await page.getByRole('button', { name: 'View version 1 answers', exact: true }).click();
  await expect(page.getByText('Recorded historical stem', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Scores', exact: true }).click();
  await page.getByRole('button', { name: 'View Exam Prep scores', exact: true }).click();
  await expect(page.getByText('12 / 20', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alex', exact: true })).toHaveAttribute('href', /student\/learner$/);
  await page.screenshot({ path: '/tmp/analytics-live-scores.png', fullPage: true });
});
test('aggregate viewers cannot request named score records', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', r => { if (r.url().includes('/exam-scores')) requested.push(r.url()); });
  await fixture(page, false);
  await page.getByRole('button', { name: 'Scores', exact: true }).click();
  await expect(page.getByText('Student score records require individual analytics permission.')).toBeVisible();
  expect(requested).toEqual([]);
});


test('master profile shows recorded mastery, answers and submitted scores', async ({ page }) => {
  await fixture(page);
  for (const file of ['katex.min.js', 'katex-auto-render.min.js', 'marked.min.js', 'purify.min.js']) await page.addScriptTag({ url: `/vendor/${file}` });
  await page.route('**/students/alex/analytics', route => route.fulfill({ json: {
    student: { puid: 'alex', uid: 'alex', displayName: 'Alex' },
    objectives: [{ loId: objective, name: 'Value at Risk', topic: 'Risk' }],
    mastery: [{ loId: objective, status: 'in-progress', attemptCount: 6, windowAccuracy: .5, rationale: 'Needs more evidence.' }],
    history: [{ loId: objective, createdAt: '2026-09-13', mode: 'topic-practice', correct: false, selectedKey: 'B', selectedRole: 'common-misconception', difficulty: 'easy', stem: 'Recorded value 12', options: [{ key: 'B', text: 'Saved answer 10', explanation: 'Recorded explanation', role: 'common-misconception' }] }],
    reviewBook: [], flags: [], engagement: { attempts: 6, sessions: 2, topicPracticeAttempts: 6, examPrepAttempts: 0 },
  } }));
  await page.evaluate(async id => {
    (await import('/js/views/instructor/student-profile.js')).renderStudentProfile(document.querySelector('#app')!, { id, puid: 'alex' });
  }, course);
  await expect(page.getByText('Needs more evidence.')).toBeVisible();
  await page.getByRole('button', { name: 'Answer history', exact: true }).click();
  await page.locator('.master-attempt summary').click();
  await expect(page.getByText('Recorded value 12')).toBeVisible();
  await expect(page.getByText('B. Saved answer 10')).toBeVisible();
  await page.getByRole('button', { name: 'Exam scores', exact: true }).click();
  await expect(page.getByRole('cell', { name: '12 / 20', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Events & activity', exact: true }).click();
  await expect(page.getByText('No recorded question flags.')).toBeVisible();
});


test('prototype topic inspector and question search send real scopes', async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole('complementary', { name: 'Topic detail' })).toContainText('Value at Risk');
  const scoped = page.waitForRequest(req => req.url().includes('question-patterns') && req.url().includes('themeId=theme'));
  await page.getByRole('button', { name: 'Inspect topic questions →' }).click();
  await scoped;
  await expect(page.getByRole('heading', { name: 'Version 1 · Historical content' })).toBeVisible();
  const searched = page.waitForRequest(req => req.url().includes('question-patterns') && req.url().includes('q=historical'));
  await page.getByRole('searchbox', { name: 'Search questions' }).fill('historical');
  await searched;
});
