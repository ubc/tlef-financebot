import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TUTORIAL_DEFINITIONS } from '../../client/src/tutorial-definitions';

const beaconReceivers = new Set<Server>();
test.afterEach(async () => {
  await Promise.all([...beaconReceivers].map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
  beaconReceivers.clear();
});

const courseId = '507f1f77bcf86cd799439011', examId = '507f1f77bcf86cd799439021', attemptId = '507f1f77bcf86cd799439031';
const secret = 'SECRET EXPLANATION: beta measures systematic risk.';
const longStem = `A portfolio analyst compares cash flows and systematic risk across several projects. Use the course notation $E[R_i] = r_f + \\beta_i(E[R_M]-r_f)$.\n\n` + Array.from({ length: 20 }, (_, i) => `Case ${i + 1}: The project requires an initial investment, generates annual cash flows, and has exposure to market risk. Compare its expected return and its total volatility carefully. The portfolio includes several independent sources of firm-specific risk; distinguish these from systematic market factors.`).join('\n\n') + '\n\nWhich conclusion is supported by the model?';
const longOption = 'Consider the project cash flows, the stated beta and the market premium using the lecture notation. ';
const paper = Array.from({ length: 12 }, (_, i) => ({
  id: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
  stem: i === 0 ? longStem : `Assessment problem ${i + 1}: Calculate or interpret the stated financial relationship. $PV = \\frac{CF_1}{1+r}$.`,
  type: i === 2 ? 'true-false' : 'mcq', points: i === 0 ? 2 : 1,
  options: i === 2 ? [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }] : ['A', 'B', 'C', 'D'].map((key, index) => ({ key, text: i === 0 ? `${key}: ${longOption.repeat(5)} The expected return is $${10 + index}\\%$.` : `${key}: Financial interpretation ${index + 1} for problem ${i + 1}.` })),
}));
interface Receipt { path: string; method: string; query: URLSearchParams; body: Record<string, unknown> }
interface Attempt { selected: Map<string, string>; revision: number; submitted: boolean; session: string; windowId?: string; windowExpiresAt?: string; submissionReason?: string }

async function fixture(page: Page, setup: { mode?: 'preview' | 'live'; dark?: boolean; restricted?: boolean; seconds?: number; expiredReadFailure?: boolean; rejectBind?: boolean; dropCloseBeacon?: boolean; failTerminalStateRead?: boolean } = {}) {
  const preview = setup.mode !== 'live', restricted = Boolean(setup.restricted);
  const base = preview ? `/preview/${restricted ? 'restricted/' : ''}course/${courseId}` : `/course/${courseId}`;
  const apiBase = `/api/courses/${courseId}/${preview ? 'preview/' : ''}`;
  const receipts: Receipt[] = [], unhandled: string[] = [], errors: string[] = [];
  const attempt: Attempt = { selected: new Map(), revision: 0, submitted: false, session: '' };
  let deadline = new Date(Date.now() + 3600000).toISOString();
  let attemptReads = 0, failedExpiredRead = false;
  const state = { receipts, attempt, base, apiBase, failNextAnswer: false, failNextSubmit: false, failHeartbeat: false, terminalWindowReceipt: false, holdAnswer: undefined as Promise<void> | undefined, holdSubmit: undefined as Promise<void> | undefined, started: false };
  const snapshot = () => ({ id: attemptId, title: 'Finance practice midterm', submitted: attempt.submitted, deadline, serverTime: new Date().toISOString(), answerRevision: attempt.revision,
    windowExpiresAt: attempt.windowExpiresAt, submissionReason: attempt.submissionReason,
    questions: paper.map(q => ({ ...q, selectedKey: attempt.selected.get(q.id) ?? null })), ...(preview ? { preview: true, previewMode: restricted ? 'restricted' : 'unrestricted' } : {}) });
  // Page teardown can cancel routed keepalive deliveries in this harness.
  // Redirect only the close beacon host to a real, isolated HTTP receiver; its
  // original path, access query and payload still pass through native sendBeacon.
  const receiver = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? 'http://127.0.0.1:6118');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let raw = ''; request.setEncoding('utf8'); request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      receipts.push({ path: url.pathname, method: request.method ?? '', query: url.searchParams, body });
      const valid = url.pathname === `${apiBase}assessment-attempts/${attemptId}/window/close` && body.windowId === attempt.windowId
        && (!preview || body.previewSessionId === attempt.session) && url.searchParams.get('access') === (restricted ? 'restricted' : null);
      if (valid) { attempt.submitted = true; attempt.submissionReason = 'window-closed'; }
      else errors.push('The close beacon did not match its fixture window, course, session and mode.');
      response.writeHead(valid ? 200 : 409, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ submitted: valid }));
    });
  });
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve)); beaconReceivers.add(receiver);
  const receiverOrigin = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  await page.addInitScript(({ origin, drop }) => {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (value: string | URL, data?: BodyInit | null) => {
      const url = new URL(String(value), window.location.href);
      if (drop && url.pathname.endsWith('/window/close')) return true;
      return nativeBeacon(url.pathname.endsWith('/window/close') ? `${origin}${url.pathname}${url.search}` : value, data);
    } });
  }, { origin: receiverOrigin, drop: Boolean(setup.dropCloseBeacon) });
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(dark => localStorage.setItem('tlef-theme', dark ? 'dark' : 'light'), Boolean(setup.dark));
  await page.context().route('http://127.0.0.1:6118/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    const body = method === 'GET' ? {} : route.request().postDataJSON() ?? {};
    const receipt = { path, method, query: url.searchParams, body }; receipts.push(receipt);
    const respond = (json: unknown) => route.fulfill({ json });
    if (path === '/api/auth/me') return respond({ authenticated: true, user: { puid: preview ? 'PREVIEW-INSTRUCTOR' : 'LIVE-STUDENT', uid: preview ? 'faculty' : 'student', displayName: preview ? 'Instructor User' : 'Student User', isAdmin: false, platformInstructor: preview, affiliations: [preview ? 'faculty' : 'student'], courseRoles: [{ courseId, role: preview ? 'instructor' : 'student' }] } });
    if (path === '/api/tutorials') return respond(TUTORIAL_DEFINITIONS.map(d => ({ id: d.id, role: d.role, version: d.version, status: 'dismissed' })));
    if (path === '/api/notifications') return respond([]);
    const course = { _id: courseId, name: 'Corporate Finance', courseCode: 'FIN 301', term: '2026W1', published: true, lifecycle: 'published', themes: [] };
    if (path === '/api/courses') return respond([course]);
    if (path === '/api/enrollments') return respond([{ ...course, courseId, active: true }]);
    if (path === `/api/courses/${courseId}`) return respond(course);
    if (path.endsWith('/preview/identity')) return respond({ name: course.name, courseCode: course.courseCode, term: course.term });
    if (path.endsWith('/exams')) return respond([]);
    if (path.endsWith('/capabilities/me')) return respond({ 'question.review': true });
    if (path === `${apiBase}assessments`) return respond([{ id: examId, title: 'Finance practice midterm', source: 'published', kind: 'midterm', purpose: 'formal', questionCount: paper.length, durationMinutes: 60, opensAt: new Date(Date.now() - 60000).toISOString(), closesAt: new Date(Date.now() + 7200000).toISOString(), timeZone: 'America/Vancouver', feedback: 'after-close', canStart: true, ...(state.started ? { attemptId, submitted: attempt.submitted } : {}) }]);
    if (path === `${apiBase}assessments/${examId}/start`) {
      state.started = true; deadline = new Date(Date.now() + (setup.seconds ?? 3600) * 1000).toISOString(); attempt.session = preview ? String(body.previewSessionId) : 'live';
      attempt.windowId = String(body.windowId); attempt.windowExpiresAt = new Date(Date.now() + 120000).toISOString(); return respond(snapshot());
    }
    if (path.startsWith(`${apiBase}assessment-attempts/${attemptId}`)) {
      if (preview) {
        const session = method === 'GET' ? url.searchParams.get('previewSessionId') : body.previewSessionId;
        expect(session).toBe(attempt.session);
      }
      if (path.endsWith('/window/close')) {
        expect(body.windowId).toBe(attempt.windowId); attempt.submitted = true; attempt.submissionReason = 'window-closed';
        return respond({ submitted: true, submissionReason: attempt.submissionReason });
      }
      if (path.endsWith('/window') || path.endsWith('/window/heartbeat')) {
        if (setup.rejectBind && path.endsWith('/window')) return route.fulfill({ status: 409, json: { error: 'This exam is already open in another window.' } });
        if (!attempt.windowId) attempt.windowId = String(body.windowId);
        if (!attempt.submitted && body.windowId !== attempt.windowId) return route.fulfill({ status: 409, json: { error: 'This exam is already open in another window.' } });
        if (state.failHeartbeat && path.endsWith('/heartbeat')) return route.fulfill({ status: 503, json: { error: 'Exam connection unavailable.' } });
        if (!attempt.submitted && Date.now() >= Date.parse(attempt.windowExpiresAt!)) { attempt.submitted = true; attempt.submissionReason = 'connection-lost'; }
        if (!attempt.submitted) attempt.windowExpiresAt = new Date(Date.now() + 120000).toISOString();
        if (attempt.submitted) state.terminalWindowReceipt = true;
        return respond({ submitted: attempt.submitted, serverTime: new Date().toISOString(), windowExpiresAt: attempt.windowExpiresAt, submissionReason: attempt.submissionReason });
      }
      if (path.endsWith('/answer')) {
        if (state.holdAnswer) await state.holdAnswer;
        if (state.failNextAnswer) { state.failNextAnswer = false; return route.fulfill({ status: 503, json: { error: 'Please retry saving your answer.' } }); }
        expect(body.answerRevision).toBe(attempt.revision);
        expect(body.windowId).toBe(attempt.windowId);
        if (attempt.submitted) return route.fulfill({ status: 409, json: { error: 'This exam has ended.' } });
        expect(paper.some(q => q.id === body.itemId && q.options.some(o => o.key === body.selectedKey))).toBe(true);
        attempt.selected.set(String(body.itemId), String(body.selectedKey)); attempt.revision++;
        return respond({ answerRevision: attempt.revision });
      }
      if (path.endsWith('/submit')) {
        if (state.holdSubmit) await state.holdSubmit;
        if (state.failNextSubmit) { state.failNextSubmit = false; return route.fulfill({ status: 503, json: { error: 'Please retry submitting your exam.' } }); }
        expect(body.windowId).toBe(attempt.windowId); attempt.submitted = true; attempt.submissionReason = 'submitted'; return respond({ submitted: true });
      }
      if (path.endsWith('/results')) {
        expect(attempt.submitted).toBe(true);
        if (preview && restricted) return respond({ title: 'Finance practice midterm', released: false, message: 'Results will be released after the exam closes.' });
        return respond({ title: 'Finance practice midterm', released: true, ...(preview ? { simulatedRelease: true, message: 'Preview-only answer release. Students wait until the exam closes.' } : {}), score: attempt.selected.size, maxScore: 13,
          questions: paper.map(q => ({ ...q, selectedKey: attempt.selected.get(q.id) ?? null, options: q.options.map(o => ({ ...o, correct: o.key === 'B', explanation: secret })) })) });
      }
      if (setup.failTerminalStateRead && attempt.submitted) return route.fulfill({ status: 503, json: { error: 'Final saved state is temporarily unavailable.' } });
      if (!attempt.submitted && attempt.windowExpiresAt && Date.now() >= Date.parse(attempt.windowExpiresAt)) { attempt.submitted = true; attempt.submissionReason = 'connection-lost'; }
      attemptReads++;
      if (attemptReads > 1 && Date.now() >= Date.parse(deadline)) {
        if (setup.expiredReadFailure && !failedExpiredRead) { failedExpiredRead = true; return route.fulfill({ status: 503, json: { error: 'Please retry confirming your deadline submission.' } }); }
        attempt.submitted = true;
      }
      return respond(snapshot());
    }
    unhandled.push(`${method} ${path}`); return route.fulfill({ status: 404, json: { error: `Missing sitting fixture ${path}` } });
  });
  await page.goto(`/#${base}/assessments`);
  await expect(page.getByRole('heading', { name: 'Assessments', exact: true })).toBeVisible();
  await page.getByRole('button', { name: preview ? 'Start preview' : 'Start exam', exact: true }).click();
  if (setup.rejectBind) await expect(page.getByRole('alert')).toContainText('already open in another window');
  else await expect(page.getByRole('radio', { name: 'Option B', exact: true })).toBeVisible();
  return {
    ...state,
    get calls() { return receipts; },
    failAnswer() { state.failNextAnswer = true; }, failSubmit() { state.failNextSubmit = true; }, failHeartbeats() { state.failHeartbeat = true; },
    terminalReceiptConfirmed() { return state.terminalWindowReceipt; },
    expireWindow() { attempt.windowExpiresAt = new Date(Date.now() - 1000).toISOString(); },
    holdAnswer(promise: Promise<void>) { state.holdAnswer = promise; }, holdSubmit(promise: Promise<void>) { state.holdSubmit = promise; },
    assertClean() {
      expect(errors).toEqual([]); expect(unhandled).toEqual([]);
      const calls = receipts.filter(r => /assessments|assessment-attempts/.test(r.path));
      calls.forEach(r => {
        if (preview) {
          expect(r.path).toContain('/preview/');
          expect(r.method === 'GET' ? r.query.get('previewSessionId') : r.body.previewSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          expect(r.query.get('access')).toBe(restricted ? 'restricted' : null);
        } else {
          expect(r.path).not.toContain('/preview/'); expect(r.body.previewSessionId).toBeUndefined(); expect(r.query.get('previewSessionId')).toBeNull();
        }
      });
    },
  };
}

// These selectors intentionally address the single-question workspace rather
// than the full-page results list, which continues to show the submitted paper.
const navigator = (page: Page): Locator => page.locator('.assessment-index-list');
const question = (page: Page): Locator => page.locator('.assessment-question-scroll fieldset');
const navQuestion = (page: Page, index: number): Locator => navigator(page).getByRole('button', { name: new RegExp(`^Question ${index}(?:\\D|$)`) });
const footer = (page: Page): Locator => page.locator('.assessment-footer');
const scrollBody = (page: Page): Locator => page.locator('.assessment-question-scroll');

async function choose(page: Page, index: number) { await navQuestion(page, index).click(); await expect(question(page)).toContainText(`Question ${index}`); }
async function visibleBox(page: Page, node: Locator) {
  const box = await node.boundingBox(); expect(box).not.toBeNull();
  const view = page.viewportSize()!; expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(view.height + 1);
}

test('the live exam shows one question and a compact numbered navigator', async ({ page }) => {
  const context = await fixture(page, { mode: 'live' });
  await expect(question(page)).toHaveCount(1);
  await expect(page.locator('fieldset')).toHaveCount(1);
  await expect(navigator(page).getByRole('button')).toHaveCount(12);
  await expect(navQuestion(page, 1)).toHaveAttribute('aria-current', 'step');
  await expect(question(page).locator('.katex')).not.toHaveCount(0);
  await expect(page.getByText(/Isolated student preview/)).toHaveCount(0);
  await visibleBox(page, footer(page)); await visibleBox(page, page.getByRole('timer'));
  await page.screenshot({ path: 'audit-results/assessment-workspace-2026-10-13/desktop-live-long-question.png', fullPage: true });
  context.assertClean();
});

test('numbered navigation and Previous/Next move through the complete paper', async ({ page }) => {
  const context = await fixture(page);
  await choose(page, 3);
  await expect(page.getByRole('radio')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(navQuestion(page, 4)).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  await expect(navQuestion(page, 3)).toHaveAttribute('aria-current', 'step');
  await choose(page, 1); await expect(page.getByRole('button', { name: 'Previous question', exact: true })).toBeDisabled();
  await choose(page, 12); await expect(page.getByRole('button', { name: 'Next question', exact: true })).toBeDisabled();
  expect(context.calls.filter(r => r.path.endsWith('/answer'))).toHaveLength(0); context.assertClean();
});

test('confirmed answers survive navigation and saved counts use the server acknowledgements', async ({ page }) => {
  const context = await fixture(page);
  await choose(page, 2); await page.getByRole('radio', { name: 'Option B', exact: true }).check();
  await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await expect(navQuestion(page, 2)).toHaveAttribute('aria-label', 'Question 2, answered');
  await choose(page, 4); await page.getByRole('radio', { name: 'Option C', exact: true }).check();
  await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await expect(page.locator('.assessment-progress-text')).toContainText('2 of 12 answered'); await expect(navigator(page).getByRole('button', { name: /unanswered$/ })).toHaveCount(10);
  await choose(page, 2); await expect(page.getByRole('radio', { name: 'Option B', exact: true })).toBeChecked();
  expect(context.attempt.revision).toBe(2); expect(context.attempt.selected.size).toBe(2);
  expect(context.calls.filter(r => r.path.endsWith('/answer')).map(r => r.body.answerRevision)).toEqual([0, 1]);
  await page.screenshot({ path: 'audit-results/assessment-workspace-2026-10-13/desktop-preview-saved-questions.png', fullPage: true }); context.assertClean();
});

test('refresh ends the attempt with its server-confirmed answers and does not create another attempt', async ({ page }) => {
  const context = await fixture(page, { mode: 'live' });
  await choose(page, 2); await page.getByRole('radio', { name: 'Option A', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await choose(page, 5); await page.getByRole('radio', { name: 'Option D', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  const owner = context.attempt.windowId;
  await page.reload();
  await expect(page.getByRole('heading', { name: '2 / 13 points' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  expect(context.attempt.selected.size).toBe(2);
  expect(context.attempt.submissionReason).toBe('window-closed');
  const closes = context.calls.filter(r => r.path.endsWith('/window/close'));
  expect(closes.length).toBeGreaterThan(0); closes.forEach(receipt => expect(receipt.body.windowId).toBe(owner));
  expect(context.calls.filter(r => r.path.endsWith('/window'))).toHaveLength(1);
  expect(context.calls.filter(r => r.path.endsWith('/start'))).toHaveLength(1); context.assertClean();
});

test('a failed answer restores the confirmed choice and unanswered count before retry', async ({ page }) => {
  const context = await fixture(page); await choose(page, 2); context.failAnswer();
  await page.getByRole('radio', { name: 'Option B', exact: true }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Please retry saving' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Option B', exact: true })).not.toBeChecked();
  await expect(page.locator('.assessment-progress-text')).toContainText('0 of 12 answered'); await expect(navigator(page).getByRole('button', { name: /unanswered$/ })).toHaveCount(12);
  await page.getByRole('radio', { name: 'Option B', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await expect(page.locator('.assessment-progress-text')).toContainText('1 of 12 answered'); context.assertClean();
});

test('a pending answer cannot count as saved or submit the exam', async ({ page }) => {
  const context = await fixture(page); await choose(page, 2); let release!: () => void;
  context.holdAnswer(new Promise<void>(resolve => { release = resolve; }));
  await page.getByRole('radio', { name: 'Option B', exact: true }).check();
  await expect(page.getByText('Saving answer…', { exact: true })).toBeVisible();
  await expect(page.locator('.assessment-progress-text')).toContainText('0 of 12 answered');
  await expect(page.getByRole('button', { name: 'Submit exam', exact: true })).toBeDisabled();
  expect(context.calls.filter(r => r.path.endsWith('/submit'))).toEqual([]);
  release(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await expect(page.locator('.assessment-progress-text')).toContainText('1 of 12 answered'); context.assertClean();
});

test('long stems and options scroll independently while footer and timer stay reachable', async ({ page }) => {
  const context = await fixture(page);
  const dimensions = await scrollBody(page).evaluate(node => ({ scroll: node.scrollHeight, viewport: node.clientHeight }));
  expect(dimensions.scroll).toBeGreaterThan(dimensions.viewport * 2);
  const timerBefore = await page.getByRole('timer').boundingBox(), footerBefore = await footer(page).boundingBox();
  await scrollBody(page).evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(page.getByRole('radio', { name: 'Option D', exact: true })).toBeVisible();
  await visibleBox(page, footer(page)); await visibleBox(page, page.getByRole('timer'));
  expect((await page.getByRole('timer').boundingBox())!.y).toBeCloseTo(timerBefore!.y, 0);
  expect((await footer(page).boundingBox())!.y).toBeCloseTo(footerBefore!.y, 0);
  await page.screenshot({ path: 'audit-results/assessment-workspace-2026-10-13/desktop-long-question-scrolled.png', fullPage: true });
  context.assertClean();
});

test('questions reveal no correct keys or explanations before submission', async ({ page }) => {
  const context = await fixture(page);
  for (const index of [1, 3, 8, 12]) {
    await choose(page, index); await expect(page.locator('.correct')).toHaveCount(0); await expect(page.getByText(secret)).toHaveCount(0);
    await expect(question(page).getByText('Correct', { exact: true })).toHaveCount(0);
  }
  expect(context.calls.filter(r => r.path.endsWith('/results'))).toEqual([]);
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0 / 13 points' })).toBeVisible();
  await expect(page.getByText(secret).first()).toBeVisible(); context.assertClean();
});

test('duplicate submit clicks issue one final request and failed submission remains retryable', async ({ page }) => {
  const context = await fixture(page); await choose(page, 2); context.failSubmit();
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Please retry submitting' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit exam', exact: true })).toBeEnabled();
  let release!: () => void; context.holdSubmit(new Promise<void>(resolve => { release = resolve; }));
  await page.getByRole('button', { name: 'Submit exam', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => context.calls.filter(r => r.path.endsWith('/submit')).length).toBe(2);
  release(); await expect(page.getByRole('heading', { name: '0 / 13 points' })).toBeVisible();
  expect(context.calls.filter(r => r.path.endsWith('/submit'))).toHaveLength(2); context.assertClean();
});

for (const dark of [false, true]) test(`mobile ${dark ? 'dark' : 'light'} exam navigation collapses and keeps accessible fixed controls`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const context = await fixture(page, { dark });
  await expect(navigator(page)).not.toBeVisible();
  const toggle = page.locator('.assessment-index > summary');
  await expect(page.locator('.assessment-index')).toHaveJSProperty('open', false);
  await toggle.click(); await expect(navigator(page)).toBeVisible();
  await navQuestion(page, 4).click(); await expect(question(page)).toContainText('Question 4');
  await expect(navigator(page)).not.toBeVisible();
  await page.getByRole('radio', { name: 'Option B', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await visibleBox(page, footer(page)); await visibleBox(page, page.getByRole('timer'));
  const results = await new AxeBuilder({ page }).include('.eb-sitting').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: `audit-results/assessment-workspace-2026-10-13/mobile-${dark ? 'dark' : 'light'}-single-question.png`, fullPage: true });
  await toggle.click();
  const navResults = await new AxeBuilder({ page }).include('.eb-sitting').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(navResults.violations).toEqual([]);
  await page.screenshot({ path: `audit-results/assessment-workspace-2026-10-13/mobile-${dark ? 'dark' : 'light'}-question-navigator.png`, fullPage: true });
  context.assertClean();
});


test('desktop dark sitting keeps the confirmed progress and answer controls accessible', async ({ page }) => {
  const context = await fixture(page, { mode: 'live', dark: true }); await choose(page, 2);
  await page.getByRole('radio', { name: 'Option C', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.eb-sitting').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
  await visibleBox(page, footer(page)); await visibleBox(page, page.getByRole('timer'));
  await page.screenshot({ path: 'audit-results/assessment-workspace-2026-10-13/desktop-dark-confirmed-answer.png', fullPage: true }); context.assertClean();
});


test('an expired sitting keeps answers locked when deadline confirmation fails and Reload can retry', async ({ page }) => {
  const context = await fixture(page, { seconds: 1, expiredReadFailure: true });
  await expect(page.getByRole('status').filter({ hasText: 'Please retry confirming your deadline submission' })).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole('timer')).toContainText('0:00 remaining');
  await expect(page.getByRole('radio', { name: 'Option B', exact: true })).toBeDisabled();
  await expect(navQuestion(page, 2)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next question', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reload saved answers', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reload saved answers', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0 / 13 points' })).toBeVisible();
  expect(context.calls.filter(r => r.path.endsWith('/answer'))).toEqual([]); context.assertClean();
});


async function expectLockedExamShell(page: Page) {
  await expect(page.locator('.app-shell')).toHaveClass(/assessment-in-progress/);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('.role-switcher')).not.toBeVisible();
  await expect(page.locator('.notif-bell-wrap')).not.toBeVisible();
  await expect(page.locator('.topbar__right')).not.toBeVisible();
  await expect(page.locator('.topbar a[href="/auth/logout"]')).not.toBeVisible();
  await expect(page.getByRole('link', { name: '← Back to assessments', exact: true })).toHaveCount(0);
}

for (const mode of ['live', 'preview'] as const) test(`${mode} sitting removes course and account navigation until a confirmed submission`, async ({ page }) => {
  const context = await fixture(page, { mode }); await expectLockedExamShell(page);
  await page.screenshot({ path: `audit-results/assessment-lock-2026-10-13/desktop-${mode}-active.png`, fullPage: true });
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0 / 13 points' })).toBeVisible();
  await expect(page.locator('.app-shell')).not.toHaveClass(/assessment-in-progress/);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.role-switcher')).toBeVisible();
  await expect(page.locator('.topbar a[href="/auth/logout"]')).toBeVisible();
  await expect(page.getByRole('link', { name: '← Back to assessments', exact: true })).toBeVisible();
  await page.screenshot({ path: `audit-results/assessment-lock-2026-10-13/desktop-${mode}-submitted-restored-shell.png` }); context.assertClean();
});

for (const restricted of [false, true]) test(`${restricted ? 'restricted' : 'unrestricted'} preview blocks direct hash changes and browser Back`, async ({ page }) => {
  const context = await fixture(page, { restricted });
  const activeHash = `#${context.base}/assessment/${attemptId}`;
  await page.evaluate(() => { window.location.hash = '/instructor/courses?workspace=instructor'; });
  await expect.poll(() => new URL(page.url()).hash).toBe(activeHash);
  await expect(page.getByRole('status').filter({ hasText: 'Submit this exam before leaving.' })).toBeVisible();
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe(activeHash);
  // The attempted hash added a duplicate history entry. A second Back reaches
  // the original assessment list and exercises the actual escape guard.
  await page.goBack();
  await expect.poll(() => new URL(page.url()).hash).toBe(activeHash);
  await expectLockedExamShell(page); await expect(question(page)).toBeVisible();
  expect(context.calls.filter(call => call.path.endsWith('/window/close'))).toEqual([]);
  expect(context.attempt.submitted).toBe(false); context.assertClean();
});

test('synthetic clicks on hidden navigation and logout cannot bypass the exam window', async ({ page }) => {
  const context = await fixture(page, { mode: 'live' }); const originalUrl = page.url();
  await page.locator('.sidebar a[href]').first().evaluate((node: HTMLAnchorElement) => node.click());
  await expect(page).toHaveURL(originalUrl);
  await page.locator('.topbar a[href="/auth/logout"]').evaluate((node: HTMLAnchorElement) => node.click());
  await expect(page).toHaveURL(originalUrl);
  const themeBefore = await page.locator('html').getAttribute('data-theme');
  await page.locator('.topbar button[aria-label="Toggle light or dark theme"]').evaluate((node: HTMLButtonElement) => node.click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeBefore!);
  const clicked = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell')!, shortcut = document.createElement('button');
    let fired = false; shortcut.textContent = 'Forged shortcut'; shortcut.addEventListener('click', () => { fired = true; });
    shell.append(shortcut); shortcut.click(); shortcut.remove(); return fired;
  });
  expect(clicked).toBe(false); await expectLockedExamShell(page);
  expect(context.attempt.submitted).toBe(false); context.assertClean();
});

test('answer saving and failed submission retain the shell lock until the server accepts submission', async ({ page }) => {
  const context = await fixture(page); await choose(page, 2); let finishAnswer!: () => void;
  context.holdAnswer(new Promise<void>(resolve => { finishAnswer = resolve; }));
  await page.getByRole('radio', { name: 'Option B', exact: true }).check();
  await expect(page.getByText('Saving answer…', { exact: true })).toBeVisible(); await expectLockedExamShell(page);
  finishAnswer(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  context.failSubmit(); await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Please retry submitting your exam.' })).toBeVisible();
  await expectLockedExamShell(page); expect(context.attempt.submitted).toBe(false);
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 / 13 points' })).toBeVisible();
  await expect(page.locator('.app-shell')).not.toHaveClass(/assessment-in-progress/);
  expect(context.attempt.selected.get(paper[1].id)).toBe('B'); context.assertClean();
});

test('document visibility changes and switching tabs preserve the active exam', async ({ page }) => {
  const context = await fixture(page, { restricted: true }); const owner = context.attempt.windowId;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'visibilityState');
  });
  const other = await page.context().newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.bringToFront(); await other.close();
  await expectLockedExamShell(page); await choose(page, 2);
  await page.getByRole('radio', { name: 'Option C', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  expect(context.attempt.windowId).toBe(owner); expect(context.attempt.submitted).toBe(false);
  expect(context.calls.filter(call => call.path.endsWith('/window/close'))).toEqual([]); context.assertClean();
});

test('a rejected initial window bind never exposes answer controls', async ({ page }) => {
  const context = await fixture(page, { rejectBind: true });
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('already open in another window');
  await expect(page.locator('.app-shell')).toHaveClass(/assessment-in-progress/);
  expect(context.calls.filter(call => call.path.endsWith('/answer'))).toEqual([]);
  expect(context.attempt.selected.size).toBe(0); context.assertClean();
});

test('failed heartbeats after the window lease expires finalize the saved answers', async ({ page }) => {
  await page.clock.install();
  const context = await fixture(page, { mode: 'live' }); await choose(page, 2);
  await page.getByRole('radio', { name: 'Option B', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  context.failHeartbeats(); context.expireWindow();
  await page.clock.fastForward(21000);
  await expect(page.getByRole('heading', { name: '1 / 13 points' })).toBeVisible();
  expect(context.calls.filter(call => call.path.endsWith('/window/heartbeat')).length).toBeGreaterThan(0);
  expect(context.attempt.submissionReason).toBe('connection-lost');
  expect(context.attempt.selected.get(paper[1].id)).toBe('B');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.locator('.app-shell')).not.toHaveClass(/assessment-in-progress/); context.assertClean();
});

for (const setup of [{ mode: 'live' as const, restricted: false }, { mode: 'preview' as const, restricted: false }, { mode: 'preview' as const, restricted: true }]) test(`closing the ${setup.mode}${setup.restricted ? ' restricted' : ''} page sends its own close beacon with the saved answers`, async ({ page }) => {
  const context = await fixture(page, setup); await choose(page, 2);
  await page.getByRole('radio', { name: 'Option B', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  const owner = context.attempt.windowId, closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true }); await closed;
  await expect.poll(() => context.calls.filter(call => call.path.endsWith('/window/close')).length).toBe(1);
  const receipt = context.calls.find(call => call.path.endsWith('/window/close'))!;
  expect(receipt.path).toBe(`${context.apiBase}assessment-attempts/${attemptId}/window/close`);
  expect(receipt.body.windowId).toBe(owner); expect(receipt.method).toBe('POST');
  expect(context.attempt.submissionReason).toBe('window-closed');
  expect(context.attempt.selected.get(paper[1].id)).toBe('B'); expect(context.attempt.selected.size).toBe(1);
  context.assertClean();
});


test('reload retries the departed restricted preview window when its native close beacon is lost', async ({ page }) => {
  const context = await fixture(page, { restricted: true, dropCloseBeacon: true }); await choose(page, 2);
  await page.getByRole('radio', { name: 'Option B', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  const owner = context.attempt.windowId; await page.reload();
  await expect(page.getByText('Results will be released after the exam closes.')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  expect(context.attempt.submissionReason).toBe('window-closed');
  expect(context.attempt.selected.get(paper[1].id)).toBe('B');
  const closes = context.calls.filter(receipt => receipt.path.endsWith('/window/close'));
  expect(closes).toHaveLength(1); expect(closes[0].body.windowId).toBe(owner);
  expect(context.calls.filter(receipt => receipt.path.endsWith('/window'))).toHaveLength(1);
  expect(context.calls.filter(receipt => receipt.path.endsWith('/start'))).toHaveLength(1); context.assertClean();
});


test('mobile exam hides navigation and restores account controls after confirmed submission', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const context = await fixture(page); await expectLockedExamShell(page);
  await page.locator('.assessment-index > summary').click(); await navQuestion(page, 2).click();
  await page.getByRole('radio', { name: 'Option B', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'audit-results/assessment-lock-2026-10-13/mobile-preview-active.png' });
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 / 13 points' })).toBeVisible();
  await expect(page.locator('.app-shell')).not.toHaveClass(/assessment-in-progress/);
  await expect(page.locator('.role-switcher')).toBeVisible();
  await expect(page.locator('.topbar a[href="/auth/logout"]')).toBeVisible();
  await page.screenshot({ path: 'audit-results/assessment-lock-2026-10-13/mobile-preview-submitted-restored-controls.png' }); context.assertClean();
});


test('an authoritative terminal heartbeat releases the shell even if final state reads fail', async ({ page }) => {
  await page.clock.install();
  const context = await fixture(page, { mode: 'live', failTerminalStateRead: true }); await choose(page, 2);
  await page.getByRole('radio', { name: 'Option B', exact: true }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  context.expireWindow(); await page.clock.fastForward(21000);
  await expect.poll(() => context.terminalReceiptConfirmed()).toBe(true);
  await expect(page.locator('.app-shell')).not.toHaveClass(/assessment-in-progress/);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeVisible();
  expect(context.attempt.submitted).toBe(true); expect(context.attempt.selected.get(paper[1].id)).toBe('B'); context.assertClean();
});
