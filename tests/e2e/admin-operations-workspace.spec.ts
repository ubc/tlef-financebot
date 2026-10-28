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
const unmatchedOperation = { ...operation, method: 'GET', route: '/unmatched', statusCode: 404,
  actor: undefined, targets: {}, response: { error: 'Not Found' },
  request: { path: '/api/:redacted', pathHash: 'a'.repeat(64), pathRedacted: true, pathTruncated: false, routeMatched: false, client: 'curl', fetchSite: 'unavailable' } };
async function fixture(page: Page, hash = '#/admin/operations', fullShell = false) {
  const reads: URL[] = [];
  const controls = { failList: false, failDetail: false, slowSearch: false, unmatched: false as false | 'new' | 'legacy' };
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
      const items = controls.unmatched ? [{ ...unmatchedOperation, request: controls.unmatched === 'legacy' ? undefined : unmatchedOperation.request }] : url.searchParams.get('q') === 'empty' ? [] : atPage === 2 ? [{ ...operation, requestId: secondId, route: 'Page two action' }] : [operation, { ...operation, requestId: secondId, outcome: 'accepted', response: {}, route: '/api/courses/:courseId/materials' }];
      return route.fulfill({ json: { items, total: items.length ? 27 : 0, page: atPage, ...identities, monitoring } });
    }
    if (url.pathname.startsWith('/api/admin/operations/')) return route.fulfill(controls.failDetail ? { status: 503, json: { error: 'Evidence temporarily unavailable.' } } : { json: { operation: controls.unmatched ? { ...unmatchedOperation, request: controls.unmatched === 'legacy' ? undefined : unmatchedOperation.request } : url.pathname.endsWith(secondId) ? { ...operation, requestId: secondId, outcome: 'accepted', response: {} } : operation, runs: controls.unmatched ? [] : [run] } });
    if (url.pathname === '/api/admin/diagnostic-runs') return route.fulfill({ json: { items: [run], total: 1, page: 1, ...identities } });
    if (url.pathname.startsWith('/api/admin/diagnostic-runs/')) return route.fulfill({ json: { run, ...identities } });
    if (url.pathname === '/api/admin/audit-history') return route.fulfill({ json: { items: [{ _id: courseId, actorPuid: 'PUID-ADMIN', action: 'grant-instructor', targetType: 'user', targetId: 'PUID-FACULTY', createdAt: operation.createdAt, detail: { platformInstructor: true } }], total: 1, page: 1 } });
    return route.fulfill({ json: [] });
  });
  await page.goto((fullShell ? '/' : '/operations-fixture') + hash);
  if (!fullShell) await page.evaluate(async () => {
    const { getAuthState } = await import('/js/api.js');
    await getAuthState();
    const { renderAdminOperations, renderAdminOperationDetail } = await import('/js/views/admin/operations.js');
    const match = location.hash.match(/operations\/(requests|runs)\/([^?]+)/);
    const outlet = document.getElementById('fixture')!;
    if (match) await renderAdminOperationDetail(outlet, { kind: match[1], id: match[2] }); else await renderAdminOperations(outlet);
  });
  await expect(page.getByRole('heading', { name: 'Operations & Issues', exact: true })).toBeVisible();
  await expect(page.locator('.ac-table')).toBeVisible();
  return { reads, writes, controls };
}

test('unmatched 404s retain evidence, searchable hashes and persistent routing filters', async ({ page }) => {
  const state = await fixture(page);
  state.controls.unmatched = 'new';
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Routing', { exact: true }).selectOption('unmatched');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect.poll(() => state.reads.filter(url => url.pathname === '/api/admin/operations').at(-1)?.searchParams.get('routing')).toBe('unmatched');
  await expect(page).toHaveURL(/routing=unmatched/);
  await expect(page.locator('.ac-table')).toContainText('Unmatched route · HTTP 404');
  await page.getByRole('link', { name: 'GET /api/:redacted', exact: true }).click();
  await expect(page.getByText('No API route matched this request.', { exact: false })).toBeVisible();
  await expect(page.locator('.ac-panel')).toContainText(unmatchedOperation.request.pathHash);
  await expect(page.locator('.ac-panel')).toContainText('curl');
  await expect(page.getByText('Operation failed', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.admin-console').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'audit-results/operations-logging/unmatched-404-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).toHaveURL(/routing=unmatched/);
  await page.getByRole('searchbox', { name: 'Search activity' }).fill(unmatchedOperation.request.pathHash);
  await expect.poll(() => state.reads.filter(url => url.pathname === '/api/admin/operations').at(-1)?.searchParams.get('q')).toBe(unmatchedOperation.request.pathHash);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByLabel('Routing', { exact: true })).toHaveValue('unmatched');
  await page.getByLabel('Routing', { exact: true }).selectOption('other');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/routing=other/);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).not.toHaveURL(/routing=/);
  expect(state.writes).toEqual([]);
});

for (const historical of [false, true]) test(`interrupted reads disclose ${historical ? 'historical uncertainty' : 'pre-routing cancellation and proxy evidence'}`, async ({ page }) => {
  await fixture(page);
  const interrupted = { ...unmatchedOperation, outcome: 'interrupted', statusCode: 499,
    request: { ...unmatchedOperation.request, path: '/api/courses/:redacted/materials/:redacted/source',
      ...(historical ? {} : { routeState: 'not-evaluated', proxy: { forwarded: true, trustedPeer: true }, responseStarted: false, rangeRequested: true,
        fingerprints: { day: '2026-10-28', peer: 'a'.repeat(32), agent: 'b'.repeat(32), client: 'c'.repeat(32) } }) },
    response: { failureCategory: 'connection-interrupted' } };
  await page.route(`**/api/admin/operations/${requestId}`, route => route.fulfill({ json: { operation: interrupted, runs: [] } }));
  await page.getByRole('link', { name: 'POST /api/courses/:courseId/generate', exact: true }).first().click();
  await expect(page.locator('.ac-panel')).toContainText(historical ? 'Not confirmed before disconnect' : 'Not evaluated before request ended');
  await expect(page.locator('.ac-panel')).toContainText('Navigation, a replaced preview');
  await expect(page.locator('.ac-panel')).not.toContainText('This action may already have changed data');
  await expect(page.locator('.ac-panel')).not.toContainText('No API route matched');
  if (!historical) {
    await expect(page.locator('.ac-panel')).toContainText('Immediate proxy peer trusted');
    await expect(page.locator('.ac-panel')).toContainText('Resolved client group (trusted proxy)');
    await expect(page.locator('.ac-panel')).toContainText('c'.repeat(32));
  }
});

test('historical unmatched 404s disclose missing original paths without inventing diagnostics', async ({ page }) => {
  const state = await fixture(page);
  state.controls.unmatched = 'legacy';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.ac-table')).toContainText('original path unavailable');
  await page.getByRole('link', { name: 'GET /unmatched', exact: true }).click();
  await expect(page.getByText('The original path was not retained for this historical record.', { exact: false })).toBeVisible();
  await expect(page.getByText('Path hash (SHA-256)', { exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('cause analysis separates observed identity/transport stages from unverified browser initiation', async ({ page }) => {
  await fixture(page);
  const group = 'e'.repeat(32);
  const attributed = { ...unmatchedOperation, outcome: 'interrupted', statusCode: 499,
    actor: { puid: 'SYNTHETIC-TEACHER', uid: 'teacher', displayName: 'Synthetic Teacher' },
    request: { ...unmatchedOperation.request, loginState: 'authenticated',
      session: { credential: 'signed', group }, identity: { stage: 'complete', stageAtEnd: 'user-loading', wait: 'resolved', sessionLookup: 'restored', sessionAccountPuid: 'SYNTHETIC-TEACHER' },
      source: { page: '/instructor/course/:redacted/materials', callsite: 'views/instructor/materials.js:100:20', channel: 'embedded-preview' } },
    response: { failurePhase: 'user-load', failureReason: 'connection-closed-before-identity' } };
  await page.route(`**/api/admin/operations/${requestId}`, route => route.fulfill({ json: { operation: attributed, runs: [] } }));
  await page.getByRole('link', { name: 'POST /api/courses/:courseId/generate', exact: true }).first().click();
  const analysis = page.getByRole('region', { name: 'Request cause analysis', exact: true });
  await expect(analysis).toContainText('Account lookup pending');
  await expect(analysis).toContainText('Loading the account');
  await expect(analysis).toContainText('views/instructor/materials.js:100:20');
  await expect(analysis).toContainText('Browser initiation hints (unverified)');
  await expect(page.locator('.ac-panel')).toContainText('The account resolved from the server session after the connection closed.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await analysis.getByRole('link', { name: 'Compare session requests', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`q=${group}`));
  await expect(page).toHaveURL(/activity=all/);
});

test('notification requests identify initial, timer and focus triggers without page query values', async ({ page }) => {
  await fixture(page);
  const hints: Array<Record<string, string>> = [];
  await page.route('**/api/notifications', route => {
    hints.push(route.request().headers()); return route.fulfill({ json: [] });
  });
  await page.clock.install();
  await page.evaluate(async () => {
    history.replaceState(null, '', '#/admin/operations?private=private-query');
    const { createNotificationBell } = await import('/js/notifications-bell.js');
    document.body.append(createNotificationBell('admin'));
  });
  await expect.poll(() => hints.some(item => item['x-financebot-trigger'] === 'notification-initial')).toBe(true);
  await page.clock.runFor(30000);
  await expect.poll(() => hints.some(item => item['x-financebot-trigger'] === 'notification-timer')).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => hints.some(item => item['x-financebot-trigger'] === 'notification-focus')).toBe(true);
  for (const hint of hints) {
    expect(hint['x-financebot-page']).toBe('/admin/operations');
    expect(hint['x-financebot-callsite']).toMatch(/^notifications-bell\.js:\d+:\d+$/);
    expect(JSON.stringify(hint)).not.toContain('private-query');
  }
});

test('browser API failures report endpoints, HTTP status and server correlation without queries or response content', async ({ page }) => {
  await fixture(page);
  const reports: Array<{ kind: string; request: { endpoint: string; statusCode?: number; relatedRequestId?: string } }> = [];
  await page.route('**/api/diagnostics/client-error', route => { reports.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
  await page.route('**/api/questions/telemetry-fixture?**', route => {
    const mode = new URL(route.request().url()).searchParams.get('mode');
    if (mode === 'network') return route.abort('connectionfailed');
    if (mode === 'invalid-json') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>private response content</html>' });
    return route.fulfill({ status: mode === 'proxy' ? 502 : 404, headers: mode === 'proxy' ? {} : { 'X-Request-ID': secondId }, contentType: 'text/html', body: '<html>private response content</html>' });
  });
  for (const mode of ['missing', 'proxy', 'invalid-json', 'network']) {
    await page.evaluate(async mode => {
      const { apiRequest } = await import('/js/api.js');
      await apiRequest(`/api/questions/telemetry-fixture?mode=${mode}&token=private-query`).catch(() => undefined);
    }, mode);
  }
  await expect.poll(() => reports.length).toBe(4);
  expect(reports.map(report => report.kind)).toEqual(['http', 'http', 'response', 'network']);
  expect(reports[0].request).toEqual({ endpoint: '/api/questions/telemetry-fixture', statusCode: 404, relatedRequestId: secondId });
  expect(reports[1].request.statusCode).toBe(502);
  expect(reports[1].request.relatedRequestId).toBeUndefined();
  expect(reports[2].request.statusCode).toBe(200);
  expect(reports[3].request.statusCode).toBeUndefined();
  expect(JSON.stringify(reports)).not.toMatch(/private|token|\?/);
  await page.evaluate(async () => {
    const { apiRequest } = await import('/js/api.js');
    const controller = new AbortController(); controller.abort();
    await apiRequest('/api/questions/telemetry-fixture?mode=network', { signal: controller.signal }).catch(() => undefined);
    for (let i = 0; i < 4; i++) await apiRequest('/api/questions/telemetry-fixture?mode=missing').catch(() => undefined);
  });
  await expect.poll(() => reports.length).toBe(5);
});

test('browser-reported request links are labelled as unverified evidence', async ({ page }) => {
  await fixture(page);
  await page.route(`**/api/admin/operations/${requestId}`, route => route.fulfill({ json: { operation: { ...operation, method: 'CLIENT', statusCode: 0, response: { error: 'An API request returned HTTP 502.', relatedRequestId: secondId, reportedBy: 'browser' } }, runs: [] } }));
  await page.getByRole('link', { name: 'POST /api/courses/:courseId/generate', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Related server request (browser-reported)', exact: true })).toHaveAttribute('href', `#/admin/operations/requests/${secondId}`);
});

test('expired sessions stop diagnostic reports and a confirmed login restores reporting', async ({ page }) => {
  await fixture(page);
  const reports: unknown[] = [], markers: string[] = [];
  await page.route('**/api/diagnostics/client-error', route => { reports.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
  await page.route('**/api/notifications', route => { markers.push(route.request().headers()['x-financebot-client']); return route.fulfill({ status: 401, json: { error: 'Authentication required.' } }); });
  await page.route('**/api/questions/forbidden-fixture', route => route.fulfill({ status: 403, json: { error: 'Forbidden' } }));
  await page.evaluate(async () => {
    const { apiRequest, setUnauthorizedHandler } = await import('/js/api.js');
    const { reportClientFailure } = await import('/js/diagnostics.js');
    setUnauthorizedHandler(() => undefined);
    await apiRequest('/api/notifications').catch(() => undefined);
    reportClientFailure('runtime', 'Late signed-out runtime event');
  });
  expect(markers).toEqual(['web-v1']);
  expect(reports).toEqual([]);
  await page.evaluate(async () => {
    const { apiRequest, getAuthState } = await import('/js/api.js');
    await getAuthState();
    await apiRequest('/api/questions/forbidden-fixture').catch(() => undefined);
  });
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ kind: 'http', request: { statusCode: 403 } });
});

test('known probes disclose identity limits and retain traffic filters and daily search groups', async ({ page }) => {
  const state = await fixture(page);
  const probe = { ...unmatchedOperation, request: { ...unmatchedOperation.request, loginState: 'not-evaluated', webClient: false,
    probe: { kind: 'phpunit', evidence: 'path-signature' }, fingerprints: { day: '2026-10-28', peer: 'b'.repeat(32), agent: 'c'.repeat(32) } }, response: { error: 'Not Found', failureCategory: 'probe-rejected' } };
  await page.route('**/api/admin/operations?**', route => route.fulfill({ json: { items: [probe], total: 1, page: 1 } }));
  await page.route(`**/api/admin/operations/${requestId}`, route => route.fulfill({ json: { operation: probe, runs: [] } }));
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Traffic classification', { exact: true }).selectOption('probes');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page).toHaveURL(/traffic=probes/);
  await expect(page.locator('.ac-table')).toContainText('Known probe path: PHPUnit');
  await expect(page.locator('.ac-table')).toContainText('Identity not evaluated');
  await expect(page.locator('.ac-metrics')).toContainText('includes 1 probe request');
  await page.getByRole('link', { name: 'GET /api/:redacted', exact: true }).click();
  await expect(page.locator('.ac-panel')).toContainText('rejected before login/session processing');
  await expect(page.locator('.ac-panel')).toContainText('may be a shared proxy');
  await expect(page.locator('.ac-panel')).toContainText(probe.request.fingerprints.peer);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).include('.admin-console').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'audit-results/operations-logging/probe-identity-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).toHaveURL(/traffic=probes/);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).not.toHaveURL(/traffic=/);
  expect(state.writes).toEqual([]);
});

test('rejected diagnostic transport stops reports until the next confirmed sign-in', async ({ page }) => {
  await fixture(page);
  let reports = 0;
  await page.route('**/api/diagnostics/client-error', route => { reports++; return route.fulfill({ status: 401, json: { error: 'Authentication required.' } }); });
  const rejection = page.waitForResponse(response => response.url().endsWith('/api/diagnostics/client-error'));
  await page.evaluate(async () => {
    const { reportClientFailure } = await import('/js/diagnostics.js');
    reportClientFailure('runtime', 'Synthetic transport test');
  });
  await rejection;
  await page.evaluate(async () => {
    const { reportClientFailure } = await import('/js/diagnostics.js');
    reportClientFailure('runtime', 'Late error after rejected report');
  });
  expect(reports).toBe(1);
  await page.evaluate(async () => {
    const { getAuthState } = await import('/js/api.js');
    const { reportClientFailure } = await import('/js/diagnostics.js');
    await getAuthState();
    reportClientFailure('runtime', 'Synthetic report after confirmed login');
  });
  await expect.poll(() => reports).toBe(2);
});

test('anonymous and historical request identity explanations never invent a user', async ({ page }) => {
  const state = await fixture(page);
  state.controls.unmatched = 'new';
  await page.route(`**/api/admin/operations/${requestId}`, route => route.fulfill({ json: { operation: { ...unmatchedOperation,
    request: { ...unmatchedOperation.request, loginState: 'unauthenticated', webClient: true } }, runs: [] } }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.ac-table')).toContainText('Identity not recorded');
  await page.getByRole('link', { name: 'GET /api/:redacted', exact: true }).click();
  await expect(page.locator('.ac-panel')).toContainText('Not signed in');
  await expect(page.locator('.ac-panel')).toContainText('expired/invalid session');
  await expect(page.locator('.ac-panel')).toContainText('does not identify the caller');
});

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
