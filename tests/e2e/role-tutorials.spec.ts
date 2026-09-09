import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

declare global { interface Window { tours: typeof import('../../client/src/tutorials.js') } }

async function fixture(page: Page, role = 'student') {
  const writes: Array<{ role: string; status: string }> = [];
  await page.route('**/tutorial-fixture', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Tutorial fixture</title><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script><link rel="stylesheet" href="/styles/main.css"></head><body><main id="app"><h1>Course</h1><button id="before">Before</button><section data-tutorial="student-dashboard-intro">Dashboard</section><section data-tutorial="registration-code">Join a course</section><section data-tutorial="analytics-overview">Analytics</section><section data-tutorial="analytics-outcomes">Outcomes</section><section data-tutorial="analytics-question-patterns">Patterns</section><section data-tutorial="analytics-follow-up">Follow up</section></main></body></html>' }));
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'first-account', uid: 'user', courseRoles: [], isAdmin: role === 'admin', platformInstructor: role === 'instructor' } } }));
  await page.route('**/api/tutorials**', async (route) => {
    if (route.request().method() === 'PUT') { writes.push(route.request().postDataJSON()); return route.fulfill({ json: {} }); }
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { count: 1 } });
    return route.fulfill({ json: [{ id: role === 'instructor' ? 'instructor-analytics' : 'student-welcome', role, version: 1, status: 'not-viewed' }] });
  });
  await page.goto('/tutorial-fixture');
  await page.evaluate(async (selectedRole) => {
    const auth = await import('/js/auth.js'); await auth.loadSession();
    window.location.hash = selectedRole === 'instructor' ? '/instructor/course/test/analytics' : '/';
    window.tours = await import('/js/tutorials.js');
  }, role);
  return writes;
}
const start = (page: Page, id = 'student-welcome') => page.evaluate((tutorial) => window.tours.maybeStartTutorial(tutorial), id);

test('completion, inert background, replay, skip and role-only reset', async ({ page }) => {
  const writes = await fixture(page);
  await start(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ role: 'student', status: 'completed' });
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await page.evaluate(() => window.tours.replayTutorialAt('student-welcome', '#/'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].status).toBe('dismissed');
  const deletion = page.waitForRequest((request) => request.method() === 'DELETE');
  await page.evaluate(() => window.tours.resetTutorials('student'));
  expect((await deletion).url()).toContain('role=student');
});

test('delayed trigger cannot survive navigation or account change', async ({ page }) => {
  const writes = await fixture(page);
  await start(page);
  await page.evaluate(() => { window.location.hash = '/another'; });
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = '/'; });
  await start(page);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'second-account', courseRoles: [] } } }));
  await page.evaluate(async () => (await import('/js/auth.js')).loadSession());
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('preview, TA view and timed sittings cannot show or persist a tour', async ({ page }) => {
  const writes = await fixture(page, 'instructor');
  for (const href of ['/preview/course/test', '/ta/course/test/review', '/course/test/exam-attempt/attempt']) {
    await page.evaluate((hash) => { window.location.hash = hash; }, href);
    await start(page, 'instructor-analytics');
    await page.waitForTimeout(450);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  expect(writes).toHaveLength(0);
});

test('missing/replaced targets never complete an unseen step', async ({ page }) => {
  const writes = await fixture(page);
  await page.locator('[data-tutorial="registration-code"]').evaluate((element) => element.remove());
  await start(page);
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`accessible instructor dialog ${width}px ${theme}`, async ({ page }) => {
    await fixture(page, 'instructor');
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await start(page, 'instructor-analytics');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.tutorial-layer').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Skip tutorial' })).toBeFocused();
  });
}

test('retries transient state failure and keeps replay until every target exists', async ({ page }) => {
  await fixture(page);
  let calls = 0;
  await page.route('**/api/tutorials?role=student', (route) => {
    calls += 1;
    return calls === 1 ? route.fulfill({ status: 503, json: { error: 'Temporary outage' } })
      : route.fulfill({ json: [{ id: 'student-welcome', role: 'student', status: 'not-viewed' }] });
  });
  await start(page);
  await expect.poll(() => calls).toBe(1);
  await page.waitForTimeout(100);
  await start(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-tutorial="registration-code"]').evaluate((element) => element.remove());
  await page.evaluate(() => window.tours.replayTutorialAt('student-welcome', '#/'));
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('financebot:tutorial-replay:first-account:student'))).toBe('student-welcome');
  await page.locator('#app').evaluate((element) => { const target = document.createElement('section'); target.dataset.tutorial = 'registration-code'; target.textContent = 'Enrollment'; element.append(target); });
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('financebot:tutorial-replay:first-account:student'))).toBeNull();
});

test('late API response and active identity replacement cannot persist obsolete work', async ({ page }) => {
  const writes = await fixture(page);
  await page.route('**/api/tutorials?role=student', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: [{ id: 'student-welcome', role: 'student', status: 'not-viewed' }] });
  });
  await start(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = '/other'; });
  await page.waitForTimeout(600);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '/'; });
  await start(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'new-account', courseRoles: [] } } }));
  await page.evaluate(async () => (await import('/js/auth.js')).loadSession());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toEqual([]);
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
});

test('detached target cancels without completion and storage denial still permits replay', async ({ page }) => {
  const writes = await fixture(page);
  await start(page);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('[data-tutorial="student-dashboard-intro"]').evaluate((element) => element.replaceWith(element.cloneNode(true)));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.evaluate(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage unavailable'); } });
    window.tours.replayTutorialAt('student-welcome', '#/');
  });
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('mixed-role accounts use real TA progress only on their assigned TA course', async ({ page }) => {
  const writes = await fixture(page, 'instructor');
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'mixed', isAdmin: true, platformInstructor: true, courseRoles: [{ courseId: 'ta-course', role: 'ta' }, { courseId: 'instructor-course', role: 'instructor' }] } } }));
  await page.evaluate(async () => { await (await import('/js/auth.js')).loadSession(); location.hash = '/ta/course/ta-course/review'; });
  expect(await page.evaluate(() => window.tours.tutorialRole())).toBe('ta');
  await page.evaluate(() => { location.hash = '/ta/course/instructor-course/review'; });
  expect(await page.evaluate(() => window.tours.tutorialRole())).toBeUndefined();
  await start(page, 'ta-review');
  await page.waitForTimeout(450);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('real rendered TA detail hides unavailable suggestion control and retains notes', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: true, roles: [], user: { puid: 'ta-user', courseRoles: [{ courseId: 'test', role: 'ta' }] } } }));
  await page.route('**/api/courses/test/outline', (route) => route.fulfill({ json: { course: { name: 'Accounting', courseCode: 'ACCT', term: '2026' }, themes: [] } }));
  await page.route('**/api/courses/test/capabilities/me', (route) => route.fulfill({ json: { 'question.review': true, 'question.suggest-edit': false, 'question.mark-reviewed': false, 'flag.triage': false } }));
  await page.route('**/api/questions/q', (route) => route.fulfill({ json: { id: 'q', courseId: 'test', state: 'draft', loIds: [], themeIds: [], internalNotes: [], suggestions: [], current: { stem: 'What is interest?', type: 'mcq', difficulty: 'easy', options: [{ key: 'A', text: 'Borrowing cost', role: 'correct', explanation: 'The cost of borrowing.' }] } } }));
  await page.evaluate(async () => {
    await (await import('/js/auth.js')).loadSession();
    location.hash = '/ta/course/test/question/q';
    const root = document.querySelector('#app') as HTMLElement; root.replaceChildren();
    (await import('/js/views/ta/question-detail.js')).renderTaQuestionDetail(root, { id: 'test', questionId: 'q' });
  });
  await expect(page.getByText('Suggested edits are unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit suggestion' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add note', exact: true })).toBeVisible();
  await expect(page.locator('[data-tutorial="ta-question-content"]')).toBeVisible();
  await expect(page.locator('[data-tutorial="ta-question-actions"]')).toBeVisible();
});

test('obsolete Exam Prep response cannot cancel the replacement real Student dashboard tutorial', async ({ page }) => {
  const writes = await fixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/courses/obsolete/exams', async (route) => { await held; await route.fulfill({ json: [] }); });
  await page.route('**/api/enrollments', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/tutorials?role=student', (route) => route.fulfill({ json: [
    { id: 'student-welcome', role: 'student', status: 'not-viewed' },
    { id: 'student-exam-prep', role: 'student', status: 'not-viewed' },
  ] }));
  const request = page.waitForRequest('**/api/courses/obsolete/exams');
  await page.evaluate(async () => {
    location.hash = '/course/obsolete/exams';
    const outlet = document.querySelector('#app') as HTMLElement; outlet.replaceChildren();
    void (await import('/js/views/student/exam-select.js')).renderExamSelect(outlet, { id: 'obsolete' });
  });
  await request;
  await page.evaluate(() => { location.hash = '/'; });
  await page.evaluate(async () => {
    const outlet = document.querySelector('#app') as HTMLElement; outlet.replaceChildren();
    (await import('/js/views/home.js')).renderStudentCourses(outlet);
  });
  release();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Getting started');
  expect(writes).toEqual([]);
});

test('Help can retry its initial course-list failure', async ({ page }) => {
  await fixture(page);
  let loads = 0;
  await page.route('**/api/enrollments', (route) => {
    loads += 1;
    return loads === 1 ? route.fulfill({ status: 503, json: { error: 'Temporary course-list failure' } }) : route.fulfill({ json: [] });
  });
  await page.evaluate(async () => {
    location.hash = '/help';
    const outlet = document.querySelector('#app') as HTMLElement; outlet.replaceChildren();
    await (await import('/js/views/tutorial-help.js')).renderTutorialHelp(outlet);
  });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Help & Tutorials', exact: true })).toBeVisible();
  expect(loads).toBe(2);
});
