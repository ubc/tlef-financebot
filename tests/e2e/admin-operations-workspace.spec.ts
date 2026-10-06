import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const requestId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const courseId = '111111111111111111111111';
const runId = '222222222222222222222222';
const operation = { _id: courseId, requestId, createdAt: '2026-09-20T18:00:00Z', durationMs: 426, method: 'POST', route: '/api/courses/:courseId/generate', outcome: 'failed', statusCode: 422,
  actor: { puid: 'PUID-FACULTY', uid: 'faculty', displayName: 'Alex Instructor' }, targets: { courseId }, input: { count: 10 }, response: { error: 'Learning objective needs source evidence.' } };
const run = { _id: runId, courseId, kind: 'question-generation', requestedBy: 'PUID-FACULTY', status: 'partial', stage: 'reviewing', completedUnits: 1, totalUnits: 2, revision: 1, warnings: [], createdAt: operation.createdAt, updatedAt: operation.createdAt,
  error: { atStage: 'reviewing', code: 'validation-failed', message: 'One item failed validation.', retryable: true }, input: { count: 2, models: { generator: 'recorded-model' } },
  events: [{ at: operation.createdAt, stage: 'reviewing', status: 'partial', message: 'Second item failed review', completedUnits: 1 }], result: { createdQuestionIds: [courseId], failures: [{ item: 2, message: 'Invalid options' }] } };
const identities = { courses: [{ _id: courseId, name: 'Finance', courseCode: 'FIN 101' }], users: [{ puid: 'PUID-FACULTY', uid: 'faculty', displayName: 'Alex Instructor' }] };
const monitoring = { failedWrites: 0, pendingWrites: 0, oldestRecordAt: operation.createdAt };
async function fixture(page: Page, hash = '#/admin/operations', fullShell = false) {
  const reads: URL[] = [];
  const controls = { failList: false, failDetail: false, slowSearch: false };
  const writes: string[] = [];
  await page.route('**/operations-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" data-admin="true" data-theme="light"><head><title>Operations QA</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/admin-console.css"></head><body><main id="fixture" class="outlet"></main></body></html>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); reads.push(url);
    if (route.request().method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 204 }); }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'PUID-ADMIN', uid: 'admin', displayName: 'Admin', isAdmin: true, courseRoles: [] } } });
    if (url.pathname === '/api/admin/operations') {
      if (controls.failList) return route.fulfill({ status: 503, json: { error: 'Audit temporarily unavailable.' } });
      if (controls.slowSearch && url.searchParams.get('q') === 'slow') await new Promise(resolve => setTimeout(resolve, 650));
      const atPage = Number(url.searchParams.get('page') || 1);
      const items = url.searchParams.get('q') === 'empty' ? [] : atPage === 2 ? [{ ...operation, requestId: secondId, route: 'Page two action' }] : [operation, { ...operation, requestId: secondId, outcome: 'accepted', response: {}, route: '/api/courses/:courseId/materials' }];
      return route.fulfill({ json: { items, total: items.length ? 27 : 0, page: atPage, ...identities, monitoring } });
    }
    if (url.pathname.startsWith('/api/admin/operations/')) return route.fulfill(controls.failDetail ? { status: 503, json: { error: 'Evidence temporarily unavailable.' } } : { json: { operation: url.pathname.endsWith(secondId) ? { ...operation, requestId: secondId, outcome: 'accepted', response: {} } : operation, runs: [run] } });
    if (url.pathname === '/api/admin/diagnostic-runs') return route.fulfill({ json: { items: [run], total: 1, page: 1, ...identities } });
    if (url.pathname.startsWith('/api/admin/diagnostic-runs/')) return route.fulfill({ json: { run, ...identities } });
    if (url.pathname === '/api/admin/audit-history') return route.fulfill({ json: { items: [{ _id: courseId, actorPuid: 'PUID-ADMIN', action: 'grant-instructor', targetType: 'user', targetId: 'PUID-FACULTY', createdAt: operation.createdAt, detail: { platformInstructor: true } }], total: 1, page: 1 } });
    return route.fulfill({ json: [] });
  });
  await page.goto((fullShell ? '/' : '/operations-fixture') + hash);
  if (!fullShell) await page.evaluate(async () => {
    const { renderAdminOperations, renderAdminOperationDetail } = await import('/js/views/admin/operations.js');
    const match = location.hash.match(/operations\/(requests|runs)\/([^?]+)/);
    const outlet = document.getElementById('fixture')!;
    if (match) await renderAdminOperationDetail(outlet, { kind: match[1], id: match[2] }); else await renderAdminOperations(outlet);
  });
  await expect(page.getByRole('heading', { name: 'Operations & Issues', exact: true })).toBeVisible();
  await expect(page.locator('.ac-table')).toBeVisible();
  return { reads, writes, controls };
}

test('operations preserve filters and table context while inspecting and closing evidence', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.locator('.ac-panel')).toBeHidden();
  await expect(page.locator('.ac-metric strong').first()).toHaveText('27');
  await expect(page.locator('.ac-metric strong').nth(1)).toHaveText('1');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('User PUID').fill('PUID-FACULTY');
  await page.getByLabel('Course ID', { exact: true }).fill(courseId);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect.poll(() => state.reads.filter(url => url.pathname === '/api/admin/operations').at(-1)?.searchParams.get('actor')).toBe('PUID-FACULTY');
  await page.getByRole('link', { name: 'POST /api/courses/:courseId/generate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operation details' })).toBeVisible();
  await expect(page.getByText(operation.response.error, { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Input & response' }).click();
  await page.getByText('Recorded input controls', { exact: true }).click();
  await expect(page.locator('pre').filter({ hasText: '"count": 10' })).toBeVisible();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).toHaveURL(/actor=PUID-FACULTY/);
  await expect(page).not.toHaveURL(/operations\/requests/);
  await expect(page.locator('.ac-panel')).toBeHidden();
  expect(state.writes).toEqual([]);
});

test('accepted requests expose final task result, durable timeline and question links', async ({ page }) => {
  const { writes } = await fixture(page, `#/admin/operations/requests/${secondId}?actor=PUID-FACULTY`);
  await expect(page.getByText('The request was accepted. Check associated background work for its final outcome.')).toBeVisible();
  await expect(page.getByText('Accepted — still processing')).toHaveCount(0);
  await page.locator('.ac-linked').click();
  await expect(page.getByRole('heading', { name: 'Background task details' })).toBeVisible();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByText('Second item failed review', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(page.getByRole('link', { name: `Inspect ${courseId}` })).toHaveAttribute('href', `#/admin/questions/${courseId}`);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ac-panel')).toBeHidden();
  expect(writes).toEqual([]);
});

test('tabs, pagination, empty state and stale list responses are handled', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('link', { name: 'POST Page two action', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/page=2/);
  await page.getByRole('button', { name: 'Background tasks', exact: true }).click();
  await expect(page.locator('.ac-table')).toContainText('question generation');
  await expect(page.getByLabel('Outcome')).toContainText('Completed');
  await page.getByRole('button', { name: 'Change history', exact: true }).click();
  await expect(page.getByLabel('Outcome')).toBeHidden();
  await page.getByRole('button', { name: 'grant-instructor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Change details' })).toBeVisible();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.getByRole('button', { name: 'User operations', exact: true }).click();
  state.controls.slowSearch = true;
  await page.getByRole('searchbox', { name: 'Search activity' }).fill('slow');
  await expect.poll(() => state.reads.some(url => url.searchParams.get('q') === 'slow')).toBe(true);
  await page.getByRole('searchbox', { name: 'Search activity' }).fill('empty');
  await expect(page.getByRole('heading', { name: 'No matching activity' })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByRole('heading', { name: 'No matching activity' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export page' })).toBeDisabled();
});

test('list and inspector failures can retry without losing filters', async ({ page }) => {
  const { controls } = await fixture(page);
  controls.failList = true;
  await page.getByRole('searchbox', { name: 'Search activity' }).fill('generation');
  await expect(page.getByText('Audit temporarily unavailable.', { exact: true })).toBeVisible();
  controls.failList = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search activity' })).toHaveValue('generation');
  controls.failDetail = true;
  await page.getByRole('link', { name: 'POST /api/courses/:courseId/generate', exact: true }).click();
  await expect(page.getByText('Evidence temporarily unavailable.', { exact: true })).toBeVisible();
  controls.failDetail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText(`Request ID: ${requestId}`, { exact: true })).toBeVisible();
});

test('audit health, validated ranges and explicitly scoped exports work', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Audit health', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Write counters cover this server process since restart.');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('From (local time)').fill('2026-09-20T10:00');
  await page.getByLabel('Until (local time)').fill('2026-09-19T10:00');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export page', exact: true }).click();
  expect((await exported).suggestedFilename()).toBe('financebot-requests-page-1.csv');
});

for (const theme of ['light', 'dark']) test(`operations density, inspector and accessibility at desktop and narrow widths (${theme})`, async ({ page }) => {
  await fixture(page);
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  for (const width of [1440, 580, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.ac-panel')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator('.ac-table tbody tr').first().boundingBox())!.y).toBeLessThan(400);
    expect((await new AxeBuilder({ page }).include('.admin-console').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.getByRole('link', { name: 'POST /api/courses/:courseId/generate', exact: true }).click();
    await expect(page.getByText(`Request ID: ${requestId}`, { exact: true })).toBeVisible();
    const panelBounds = (await page.locator('.ac-panel').boundingBox())!;
    expect(Math.round(panelBounds.x + panelBounds.width)).toBe(width);
    expect(Math.round(panelBounds.y + panelBounds.height)).toBe(900);
    expect((await new AxeBuilder({ page }).include('.admin-console').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `audit-results/admin-workspace-2026-09-20/operations-${theme}-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Close inspector' }).click();
  }
});

test('real Admin shell places the original Help once after course tools and supports mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page, '#/admin/operations', true);
  const nav = page.getByRole('navigation', { name: 'Admin', exact: true });
  await expect(nav.getByRole('link', { name: 'Help & Tutorials', exact: true })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Course tutorials', exact: true })).toHaveCount(0);
  const names = await nav.getByRole('link').allTextContents();
  await expect(nav.getByRole('link', { name: 'My Courses', exact: true })).toBeVisible();
  expect(names.findIndex(name => name.includes('Help & Tutorials'))).toBeGreaterThan(names.findIndex(name => name.includes('My Courses')));
  expect(names.at(-1)).toContain('Help & Tutorials');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'audit-results/admin-workspace-2026-09-20/admin-shell-desktop.png', fullPage: true });
  await nav.getByRole('link', { name: 'Help & Tutorials', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Help & Tutorials', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Admin tutorials', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Operations & Issues', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Operations & Issues', exact: true }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-open/);
  await expect(page.locator('.ac-table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const tokenTotals = { inputTokens: 100, outputTokens: 40, totalTokens: 140, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, observedCalls: 2, reportedCalls: 1, callsWithKnownTotal: 1, unknownCalls: 1, pendingCalls: 0 };
const tokenSummary = { ...tokenTotals, status: 'partial', scope: 'llm-calls', coverageGaps: 0, untracked: false, retryVisibility: 'unknown', stages: [{ ...tokenTotals, stage: 'generator' }], models: [{ ...tokenTotals, provider: 'test', model: 'resolved-model' }] };
const tokenCall = { _id: 'call-1', trackingSessionId: 'tracked-session', operationId: requestId, runId, courseId, actor: operation.actor, stage: 'generator', provider: 'test', requestedModel: 'requested-model', actualModel: 'resolved-model', responseId: null, requestOptions: {}, startedAt: operation.createdAt, finishedAt: operation.createdAt, durationMs: 500, outcome: 'failed', candidateAttempt: 2, jsonAttempt: 1, retryVisibility: 'unknown', usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, totalOrigin: 'provider', countSource: 'provider-reported' } };

test('Admin model usage filters by user/request/task and exposes recorded links without private text', async ({ page }) => {
  await fixture(page, '#/admin/operations?actor=PUID-FACULTY');
  const reads: URL[] = [];
  await page.route('**/api/admin/model-usage?**', route => { reads.push(new URL(route.request().url())); return route.fulfill({ json: { items: [tokenCall], total: 2, page: 1, summary: tokenSummary, ...identities } }); });
  await page.locator('.ac-main > .ac-tabs').getByRole('button', { name: 'Model usage', exact: true }).click();
  await expect(page.locator('.ac-usage-overview')).toContainText('Partial usage · known subtotal');
  await expect(page.locator('.ac-metric strong').nth(1)).toHaveText('100');
  await expect(page.locator('.ac-metric strong').nth(2)).toHaveText('40');
  expect(reads[0].searchParams.get('actor')).toBe('PUID-FACULTY');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Request ID', { exact: true }).fill(requestId);
  await page.getByLabel('Task ID', { exact: true }).fill(runId);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect.poll(() => reads.at(-1)?.searchParams.get('runId')).toBe(runId);
  expect(reads.at(-1)?.searchParams.get('operationId')).toBe(requestId);
  await page.getByRole('button', { name: 'generator · resolved-model', exact: true }).click();
  const panel = page.locator('.ac-panel');
  await expect(panel).toContainText('Candidate attempt2');
  await expect(panel).toContainText('JSON attempt1');
  await expect(panel.getByRole('link', { name: 'Open recorded request' })).toHaveAttribute('href', `#/admin/operations/requests/${requestId}`);
  await expect(panel.getByRole('link', { name: 'Open recorded task' })).toHaveCount(0);
  await expect(panel).toContainText(`Run ID${runId}`);
  await expect(panel.locator('pre')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '/tmp/financebot-admin-model-usage-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.admin-console').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/financebot-admin-model-usage-mobile.png', fullPage: true });
});

test('Admin workflow timeline requires scope and distinguishes time grouping from recorded links', async ({ page }) => {
  await fixture(page);
  const group = { id: 'window-1', actorPuid: 'PUID-FACULTY', courseId, startedAt: operation.createdAt, endedAt: operation.createdAt, grouping: 'inferred-time-window', entries: [
    { id: requestId, kind: 'operation', createdAt: operation.createdAt, label: 'POST upload material', outcome: 'accepted', requestId, targets: { courseId }, material: { id: 'material-id', name: 'Lecture 3.pdf' }, relations: [{ kind: 'operation-run', confidence: 'recorded', requestId, runId, evidence: 'persisted-operation-id' }] },
    { id: runId, kind: 'run', createdAt: operation.createdAt, label: 'question-generation', outcome: 'partial', runId, targets: { courseId }, relations: [] },
  ] };
  await page.route('**/api/admin/workflows?**', route => route.fulfill({ json: { items: [group], total: 1, page: 1, windowMinutes: 30, truncated: false, limitations: ['Creation times define the requested range.'], ...identities } }));
  await page.getByRole('button', { name: 'Workflow timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a user or course' })).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('User PUID').fill('PUID-FACULTY');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await page.getByRole('button', { name: 'Activity window · 2 records', exact: true }).click();
  const panel = page.locator('.ac-panel');
  await expect(panel).toContainText('Inferred time window');
  await expect(panel).toContainText('not a recording of clicks');
  await expect(panel).toContainText(`Recorded request–task link: ${requestId} → ${runId}`);
  await expect(panel).toContainText('Lecture 3.pdf');
  await expect(panel.getByRole('link', { name: 'Inspect task' })).toHaveAttribute('href', `#/admin/operations/runs/${runId}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '/tmp/financebot-admin-workflow-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.admin-console').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/financebot-admin-workflow-mobile.png', fullPage: true });
});

test('Admin run usage refreshes late metadata while the existing inspector tab stays selected', async ({ page }) => {
  await fixture(page, `#/admin/operations/runs/${runId}`);
  let summary = { ...tokenSummary, status: 'pending', pendingCalls: 1, unknownCalls: 0 };
  await page.route(`**/api/admin/diagnostic-runs/${runId}`, route => route.fulfill({ json: { run, ...identities, modelUsage: summary, modelCalls: [tokenCall], modelCallsTotal: 1 } }));
  await page.locator('.ac-panel').getByRole('button', { name: 'Model usage', exact: true }).click();
  await page.locator('.ac-panel').getByRole('button', { name: 'Refresh model usage', exact: true }).click();
  await expect(page.locator('.ac-panel')).toContainText('Usage still arriving');
  summary = { ...summary, status: 'complete', pendingCalls: 0, reportedCalls: 2, inputTokens: 150, outputTokens: 60, totalTokens: 210 };
  await page.locator('.ac-panel').getByRole('button', { name: 'Refresh model usage', exact: true }).click();
  await expect(page.locator('.ac-panel .mu-totals')).toContainText('Total tokens210');
  await expect(page.locator('.ac-panel').getByRole('button', { name: 'Model usage', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Admin empty historical usage remains unavailable rather than zero', async ({ page }) => {
  await fixture(page);
  const summary = { ...tokenSummary, status: 'unavailable', untracked: true, inputTokens: null, outputTokens: null, totalTokens: null, observedCalls: 0, reportedCalls: 0, unknownCalls: 0, pendingCalls: 0, callsWithKnownTotal: 0, stages: [], models: [] };
  await page.route('**/api/admin/model-usage?**', route => route.fulfill({ json: { items: [], total: 0, page: 1, summary, ...identities } }));
  await page.locator('.ac-main > .ac-tabs').getByRole('button', { name: 'Model usage', exact: true }).click();
  await expect(page.locator('.ac-usage-overview')).toContainText('Usage unavailable');
  await expect(page.locator('.ac-metric strong').nth(1)).toHaveText('Unknown');
  await expect(page.locator('.ac-metric strong').nth(2)).toHaveText('Unknown');
  await expect(page.locator('.ac-metric strong').nth(3)).toHaveText('Unknown');
  await expect(page.locator('.ac-usage-overview')).toContainText('earlier or unrecorded activity cannot be reconstructed');
  await expect(page.locator('.ac-usage-overview')).toContainText('This is not billing');
});
