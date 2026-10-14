import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TUTORIAL_DEFINITIONS } from '../../client/src/tutorial-definitions';

const courseId = '507f1f77bcf86cd799439011';
const secondCourseId = '507f1f77bcf86cd799439012';
const examId = '507f1f77bcf86cd799439021';
const draftId = '507f1f77bcf86cd799439022';
const itemId = '5eae1bc4-b4ab-4414-a0cf-10085511515a';
const stem = 'Diversification removes all market risk.';
const explanation = 'Market risk remains after diversification.';
const options = [{ key: 'A', text: 'True' }, { key: 'B', text: 'False' }];
interface Receipt { path: string; method: string; query: URLSearchParams; body: Record<string, unknown> }
interface FixtureAttempt { id: string; sourceId: string; selectedKey: string | null; answerRevision: number; submitted: boolean; deadline: number; windowId?: string; windowExpiresAt?: string; submissionReason?: string }

async function fixture(page: Page, setup: { restricted?: boolean; dark?: boolean; role?: 'instructor' | 'ta' | 'student'; source?: 'published' | 'draft'; active?: boolean; empty?: boolean; seconds?: number; serverOffset?: number; startAtHome?: boolean; purpose?: 'practice' | 'formal'; feedback?: 'immediate' | 'after-close' | 'instructor' } = {}) {
  const receipts: Receipt[] = [], unhandled: string[] = [], errors: string[] = [];
  const attempts = new Map<string, FixtureAttempt>();
  const sessions = new Map<string, string>();
  const role = setup.role ?? 'instructor';
  const restricted = Boolean(setup.restricted);
  const purpose = setup.purpose ?? 'formal', feedback = setup.feedback ?? 'after-close';
  const base = `/preview/${restricted ? 'restricted/' : ''}course/${courseId}`;
  const serverTime = () => Date.now() + (setup.serverOffset ?? 0);
  let failAnswer = false, failSubmit = false, failList = false;
  const active = setup.active ?? false;
  const opensAt = new Date(Date.now() + (active ? -60000 : 3600000)).toISOString();
  const closesAt = new Date(Date.now() + 7200000).toISOString();
  const title = setup.source === 'draft' ? 'Draft midterm' : 'Published midterm';
  const sourceId = setup.source === 'draft' ? draftId : examId;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(({ dark }) => localStorage.setItem('tlef-theme', dark ? 'dark' : 'light'), { dark: Boolean(setup.dark) });
  const state = (attempt: FixtureAttempt) => ({ id: attempt.id, title, submitted: attempt.submitted, deadline: new Date(attempt.deadline).toISOString(), serverTime: new Date(serverTime()).toISOString(), answerRevision: attempt.answerRevision,
    windowExpiresAt: attempt.windowExpiresAt, submissionReason: attempt.submissionReason,
    questions: [{ id: itemId, stem, type: 'true-false', points: 1, selectedKey: attempt.selectedKey, options }], ...(role !== 'student' ? { preview: true, previewMode: restricted ? 'restricted' : 'unrestricted' } : {}) });
  const sessionKey = (receipt: Receipt): string => role === 'student' ? 'live-student' : `${receipt.query.get('access') ?? 'unrestricted'}:${receipt.method === 'GET' ? receipt.query.get('previewSessionId') : receipt.body.previewSessionId}`;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    const body = method === 'GET' ? {} : route.request().postDataJSON() ?? {};
    const receipt = { path, method, query: url.searchParams, body }; receipts.push(receipt);
    const respond = (json: unknown) => route.fulfill({ json });
    if (path === '/api/auth/me') return respond({ authenticated: true, user: { puid: `PREVIEW-${role}`, uid: role, displayName: `${role} User`, isAdmin: false, platformInstructor: role === 'instructor', affiliations: [role === 'instructor' ? 'faculty' : 'student'], courseRoles: [{ courseId, role }, { courseId: secondCourseId, role }] } });
    if (path === '/api/tutorials') return respond(TUTORIAL_DEFINITIONS.map(d => ({ id: d.id, role: d.role, version: d.version, status: 'dismissed' })));
    if (path === '/api/notifications') return respond([]);
    const course = { _id: courseId, name: 'Corporate Finance', courseCode: 'FIN 301', term: '2026W1', published: true, lifecycle: 'published', themes: [] };
    if (path === '/api/courses') return respond([course, { ...course, _id: secondCourseId, name: 'Finance II' }]);
    if (path === '/api/enrollments') return respond([{ ...course, courseId, active: true }]);
    if (path === `/api/courses/${courseId}` || path === `/api/courses/${secondCourseId}`) return respond(course);
    if (path.endsWith('/preview/identity')) return respond({ name: path.includes(secondCourseId) ? 'Finance II' : course.name, courseCode: course.courseCode, term: course.term });
    if (path.endsWith('/preview/learning/library') || path.endsWith('/learning/library')) return respond({ settings: { mode: 'linear', order: 'instructor' }, questions: [] });
    if (path.endsWith('/preview/home') || path.endsWith('/home')) return respond([]);
    if (path.endsWith('/preview/session-summary') || path.endsWith('/session-summary')) return respond({ welcome: false });
    if (path.endsWith('/exams')) return respond([]);
    if (path.endsWith('/capabilities/me')) return respond({ 'question.review': true });
    const previewCourse = path.includes(`/api/courses/${secondCourseId}/`) ? secondCourseId : courseId;
    const apiBase = `/api/courses/${previewCourse}/${role === 'student' ? '' : 'preview/'}`;
    if (path === `${apiBase}assessments`) {
      if (failList) { failList = false; return route.fulfill({ status: 503, json: { error: 'Assessment preview is temporarily unavailable.' } }); }
      if (setup.empty) return respond([]);
      const attemptId = sessions.get(`${previewCourse}:${sessionKey(receipt)}`);
      const attempt = attemptId ? attempts.get(attemptId) : undefined;
      return respond([{ id: sourceId, title, source: setup.source ?? 'published', kind: 'midterm', purpose, questionCount: 1, durationMinutes: 60, opensAt, closesAt, timeZone: 'America/Vancouver', feedback, canStart: !restricted || active, ...(attempt ? { attemptId, submitted: attempt.submitted } : {}) }]);
    }
    if (path === `${apiBase}assessments/${sourceId}/start`) {
      const id = `507f1f77bcf86cd7994390${31 + attempts.size}`;
      const attempt = { id, sourceId, selectedKey: null, answerRevision: 0, submitted: false, deadline: serverTime() + (setup.seconds ?? 3600) * 1000, windowId: String(body.windowId), windowExpiresAt: new Date(serverTime() + 120000).toISOString() };
      attempts.set(id, attempt); sessions.set(`${previewCourse}:${sessionKey(receipt)}`, id);
      return respond(state(attempt));
    }
    if (path.startsWith(`${apiBase}assessment-attempts/`)) {
      const id = path.slice(`${apiBase}assessment-attempts/`.length).split('/')[0], attempt = attempts.get(id);
      if (!attempt || sessions.get(`${previewCourse}:${sessionKey(receipt)}`) !== id) return route.fulfill({ status: 404, json: { error: 'This preview attempt belongs to another session.' } });
      if (path.endsWith('/window/close')) { expect(body.windowId).toBe(attempt.windowId); attempt.submitted = true; attempt.submissionReason = 'window-closed'; return respond({ submitted: true }); }
      if (path.endsWith('/window') || path.endsWith('/window/heartbeat')) {
        if (!attempt.submitted) expect(body.windowId).toBe(attempt.windowId);
        attempt.windowExpiresAt = new Date(serverTime() + 120000).toISOString();
        return respond({ submitted: attempt.submitted, serverTime: new Date(serverTime()).toISOString(), windowExpiresAt: attempt.windowExpiresAt, submissionReason: attempt.submissionReason });
      }
      if (path.endsWith('/answer')) {
        if (failAnswer) { failAnswer = false; return route.fulfill({ status: 503, json: { error: 'Please retry saving your answer.' } }); }
        expect(body.answerRevision).toBe(attempt.answerRevision);
        expect(body.windowId).toBe(attempt.windowId);
        attempt.selectedKey = body.selectedKey as string; attempt.answerRevision++;
        return respond({ answerRevision: attempt.answerRevision });
      }
      if (path.endsWith('/submit')) {
        if (failSubmit) { failSubmit = false; return route.fulfill({ status: 503, json: { error: 'Please retry submitting your exam.' } }); }
        attempt.submitted = true; return respond({ submitted: true });
      }
      if (path.endsWith('/results')) {
        if (!attempt.submitted) return route.fulfill({ status: 409, json: { error: 'Submit first.' } });
        const simulated = role !== 'student' && !restricted;
        const released = simulated || (purpose === 'practice' && feedback === 'immediate') || (feedback === 'after-close' && serverTime() >= Date.parse(closesAt));
        return respond(!released ? { title, released: false, message: feedback === 'after-close' ? 'Results will be released after the exam closes.' : 'Your Instructor will release the results.' } : { title, released: true, ...(simulated ? { simulatedRelease: true, message: 'Preview-only answer release. Students wait until the exam closes.' } : {}), score: attempt.selectedKey === 'B' ? 1 : 0, maxScore: 1, questions: [{ id: itemId, stem, points: 1, selectedKey: attempt.selectedKey, options: options.map(o => ({ ...o, correct: o.key === 'B', explanation: o.key === 'B' ? explanation : 'Incorrect.' })) }] });
      }
      if (serverTime() >= attempt.deadline) attempt.submitted = true;
      return respond(state(attempt));
    }
    unhandled.push(`${method} ${path}`); return route.fulfill({ status: 404, json: { error: `Missing preview fixture: ${path}` } });
  });
  await page.goto(role === 'student' ? `/#/course/${courseId}/assessments` : `/#${base}${setup.startAtHome ? '' : `/assessments?examId=${sourceId}`}`);
  await expect(page.locator('.app-shell--unified')).toBeVisible();
  if (!setup.startAtHome) await expect(page.getByRole('heading', { name: 'Assessments', exact: true })).toBeVisible();
  return {
    receipts, attempts, base,
    failAnswer: () => { failAnswer = true; }, failSubmit: () => { failSubmit = true; }, failList: () => { failList = true; },
    assertClean() {
      expect(unhandled, 'All requests must stay in the isolated fixture').toEqual([]); expect(errors).toEqual([]);
      const assessmentCalls = receipts.filter(r => /assessments|assessment-attempts/.test(r.path));
      if (role !== 'student') {
        expect(assessmentCalls.length).toBeGreaterThan(0);
        assessmentCalls.forEach(r => {
          expect(r.path).toContain('/preview/');
          const session = r.method === 'GET' ? r.query.get('previewSessionId') : r.body.previewSessionId;
          expect(session).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          expect(r.query.get('access')).toBe(restricted ? 'restricted' : null);
        });
      } else assessmentCalls.forEach(r => { expect(r.path).not.toContain('/preview/'); expect(r.query.get('previewSessionId')).toBeNull(); expect(r.body.previewSessionId).toBeUndefined(); });
    },
  };
}

async function start(page: Page) {
  await page.getByRole('button', { name: 'Start preview', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Option B' })).toBeVisible();
}

test('unrestricted Student Preview starts a ready draft, locks navigation, saves and submits isolated results', async ({ page }) => {
  const context = await fixture(page, { source: 'draft' });
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Assessments', exact: true })).toHaveAttribute('href', `#${context.base}/assessments`);
  await expect(page.getByText('Draft rehearsal', { exact: true })).toBeVisible();
  await start(page);
  const initialSession = context.receipts.find(r => r.path.endsWith('/start'))!.body.previewSessionId;
  await expect(page.locator('.correct')).toHaveCount(0); await expect(page.getByText(explanation)).toHaveCount(0);
  await page.getByRole('radio', { name: 'Option B' }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reload saved answers', exact: true }).click(); await expect(page.getByRole('radio', { name: 'Option B' })).toBeChecked();
  await expect(page.locator('.correct')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '← Back to assessments', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 / 1 points' })).toBeVisible(); await expect(page.getByText(explanation)).toBeVisible();
  await expect(page.getByText('Preview-only answer release. Students wait until the exam closes.')).toBeVisible();
  await expect(page.getByRole('link', { name: '← Back to assessments', exact: true })).toHaveAttribute('href', `#${context.base}/assessments`);
  const calls = context.receipts.filter(r => /assessment-attempts/.test(r.path));
  expect(calls.every(r => (r.method === 'GET' ? r.query.get('previewSessionId') : r.body.previewSessionId) === initialSession)).toBe(true);
  expect(context.attempts.size).toBe(1);
  context.assertClean();
});

test('restricted preview respects exam availability and configured answer release', async ({ page }) => {
  const context = await fixture(page, { restricted: true });
  await expect(page.getByRole('button', { name: 'Not open', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: '← Back to Course Home', exact: true })).toHaveAttribute('href', `#${context.base}`);
  expect(context.receipts.some(r => r.path.endsWith('/start'))).toBe(false);
  context.assertClean();
});

test('restricted preview can finish an open exam while answers remain withheld until close', async ({ page }) => {
  const context = await fixture(page, { restricted: true, active: true }); await start(page);
  await page.getByRole('radio', { name: 'Option B' }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByText('Results will be released after the exam closes.')).toBeVisible();
  await expect(page.locator('.correct')).toHaveCount(0); await expect(page.getByText(explanation)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '1 / 1 points' })).toHaveCount(0);
  context.assertClean();
});

test('TA preview uses the same isolated assessment namespace without instructor edit links', async ({ page }) => {
  const context = await fixture(page, { role: 'ta', startAtHome: true });
  await page.locator('.sidebar').getByRole('link', { name: 'Assessments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assessments', exact: true })).toBeVisible(); await start(page);
  await expect(page.locator('.eb-sitting a[href*="instructor"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '← Back to assessments', exact: true })).toHaveCount(0);
  context.assertClean();
});

test('failed saves restore the confirmed selection and failed submission remains resumable', async ({ page }) => {
  const context = await fixture(page); await start(page); context.failAnswer();
  await page.getByRole('radio', { name: 'Option B' }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Please retry saving' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Option B' })).not.toBeChecked();
  await page.getByRole('radio', { name: 'Option B' }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  context.failSubmit(); await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByText('Please retry submitting your exam.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit exam', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reload saved answers', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Option B' })).toBeChecked();
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click(); await expect(page.getByRole('heading', { name: '1 / 1 points' })).toBeVisible();
  context.assertClean();
});

test('server-confirmed deadline handles clock offset and cleans its timer on navigation', async ({ page }) => {
  const context = await fixture(page, { seconds: 2, serverOffset: 90000000 }); await start(page);
  await expect(page.getByRole('timer')).toContainText(/0:0[12] remaining/);
  await expect(page.getByText('Your isolated preview attempt has been submitted.')).toBeVisible({ timeout: 7000 });
  const before = context.receipts.filter(r => /assessment-attempts/.test(r.path)).length;
  await page.getByRole('link', { name: '← Back to assessments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assessments', exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  expect(context.receipts.filter(r => /assessment-attempts/.test(r.path))).toHaveLength(before);
  context.assertClean();
});

test('a submitted preview survives a failed results read without allowing more answers', async ({ page }) => {
  const context = await fixture(page); await start(page);
  await page.getByRole('radio', { name: 'Option B' }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.route('**/preview/assessment-attempts/*/results?*', route => route.fulfill({ status: 503, json: { error: 'Please retry loading results.' } }), { times: 1 });
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByText('Please retry loading results.')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 / 1 points' })).toBeVisible();
  expect(context.receipts.filter(r => r.path.endsWith('/submit'))).toHaveLength(1);
  context.assertClean();
});

test('course changes create a new anonymous session and do not resume another course attempt', async ({ page }) => {
  const context = await fixture(page); await start(page);
  const firstSession = context.receipts.find(r => r.path.endsWith('/start'))!.body.previewSessionId;
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByText('Your isolated preview attempt has been submitted.')).toBeVisible();
  await page.goto(`/#/preview/course/${secondCourseId}/assessments`);
  await expect(page.getByRole('button', { name: 'Start preview', exact: true })).toBeVisible(); await start(page);
  const sessions = context.receipts.filter(r => r.path.endsWith('/start')).map(r => r.body.previewSessionId);
  expect(sessions).toHaveLength(2); expect(sessions[1]).not.toBe(firstSession);
  context.assertClean();
});

test('live Student assessments continue to use live APIs without preview session fields', async ({ page }) => {
  const context = await fixture(page, { role: 'student', active: true });
  await page.getByRole('button', { name: 'Start exam', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Option B' })).toBeVisible();
  await expect(page.getByText(/Isolated student preview/)).toHaveCount(0);
  await page.getByRole('radio', { name: 'Option B' }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  context.assertClean();
});

for (const role of ['student', 'instructor'] as const) test(`${role === 'student' ? 'live Student' : 'restricted Student Preview'} practice releases the full paper immediately after confirmed submission`, async ({ page }) => {
  const context = await fixture(page, { role, restricted: role === 'instructor', active: true, purpose: 'practice', feedback: 'immediate' });
  await page.getByRole('button', { name: role === 'student' ? 'Start exam' : 'Start preview', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Option A' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveClass(/assessment-in-progress/);
  await page.getByRole('radio', { name: 'Option A' }).check();
  await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reload saved answers', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Option A' })).toBeChecked();
  await expect(page.locator('.correct')).toHaveCount(0);
  await expect(page.getByText(explanation)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /points$/ })).toHaveCount(0);
  expect(context.receipts.filter(receipt => receipt.path.endsWith('/results'))).toHaveLength(0);

  context.failSubmit();
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByText('Please retry submitting your exam.')).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveClass(/assessment-in-progress/);
  await expect(page.getByText(explanation)).toHaveCount(0);
  expect(context.receipts.filter(receipt => receipt.path.endsWith('/results'))).toHaveLength(0);

  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0 / 1 points' })).toBeVisible();
  await expect(page.locator('article.eb-review')).toHaveCount(1);
  await expect(page.getByText('A · Your answer', { exact: true })).toBeVisible();
  await expect(page.locator('.eb-option.correct')).toHaveCount(1);
  await expect(page.getByText('B · Correct', { exact: true })).toBeVisible();
  await expect(page.getByText(explanation)).toBeVisible();
  await expect(page.locator('.assessment-release-note')).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.locator('.app-shell')).not.toHaveClass(/assessment-in-progress/);
  const submission = [...context.attempts.values()][0];
  expect(submission.submitted).toBe(true);
  expect(submission.selectedKey).toBe('A');
  expect(context.receipts.filter(receipt => receipt.path.endsWith('/submit'))).toHaveLength(2);

  await page.getByRole('link', { name: '← Back to assessments', exact: true }).click();
  await page.getByRole('button', { name: 'View submission', exact: true }).click();
  await expect(page.getByRole('heading', { name: '0 / 1 points' })).toBeVisible();
  await expect(page.getByText(explanation)).toBeVisible();
  expect(context.receipts.filter(receipt => receipt.path.endsWith('/start'))).toHaveLength(1);
  expect(context.attempts.size).toBe(1);
  context.assertClean();
});

test('empty preview has a truthful message and unavailable linked paper hint', async ({ page }) => {
  const context = await fixture(page, { empty: true });
  await expect(page.getByText('No published exams or ready draft papers are available to preview.')).toBeVisible();
  await expect(page.getByText(/That paper is not available in this preview/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start preview', exact: true })).toHaveCount(0);
  context.assertClean();
});

for (const dark of [false, true]) test(`${dark ? 'mobile dark' : 'desktop light'} preview list, sitting and results retain accessibility and layout`, async ({ page }) => {
  await page.setViewportSize({ width: dark ? 390 : 1440, height: 900 });
  const context = await fixture(page, { dark });
  const scan = async (stage: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).include('.eb-sitting').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({ path: `audit-results/assessment-preview-2026-10-13/${dark ? 'mobile-dark' : 'desktop-light'}-${stage}.png`, fullPage: true });
  };
  await scan('list'); await start(page); await scan('sitting');
  await page.getByRole('radio', { name: 'Option B' }).check(); await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 / 1 points' })).toBeVisible(); await scan('results');
  context.assertClean();
});
