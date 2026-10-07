import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const course = '660000000000000000000001';
const theme = '660000000000000000000002';
const lo = '660000000000000000000003';
const secondLo = '660000000000000000000008';
const ids = ['660000000000000000000004', '660000000000000000000005'];
const retryId = '660000000000000000000006';
const options = [{ key: 'A', text: 'Gravity and the normal force.' }, { key: 'B', text: 'Gravity only.' }];
const question = (id: string, stem: string) => ({ questionId: id, questionVersionId: id, type: 'mcq', stem, difficulty: 'easy', degraded: 'none', watermark: '', options, paramValues: { m: 2 } });
const questions = [question(ids[0], 'Which forces act on a resting book?'), question(ids[1], 'Which forces act on a crate?')];

async function setup(page: Page, settings: { strategyA?: boolean; secondLo?: boolean; preview?: boolean } = {}) {
  const requests: Array<{ path: string; query: string; input: Record<string, unknown> }> = [];
  let failSubmit = false, failNext = false, failAdvance = false;
  let holdSubmit: Promise<void> | undefined;
  await page.route('**/topic-fixture', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>FinanceBot practice</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/student-learning.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main id="fixture" style="padding:20px"></main></body></html>' }));
  const library = questions.map(q => ({ ...q, versionId: q.questionVersionId, loId: lo, loName: 'Identify forces', themeId: theme, themeName: 'Forces and Vectors', saved: false, mistake: false, answered: false, confusing: false, tags: [] }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const input = route.request().method() === 'GET' ? {} : route.request().postDataJSON();
    requests.push({ path, query: url.search, input });
    const respond = (json: unknown) => route.fulfill({ json });
    if (path.endsWith('/learning/library')) return respond({ settings: { mode: 'topic-practice', order: 'instructor' }, questions: library });
    if (path.endsWith('/home')) return respond([{ theme: { _id: theme, name: 'Forces and Vectors', order: 0 }, available: true, los: [
      { lo: { _id: lo, name: 'Identify forces', themeId: theme, order: 0 }, status: 'not-attempted', approvedCount: 2 },
      ...(settings.secondLo ? [{ lo: { _id: secondLo, name: 'Combine forces', themeId: theme, order: 1 }, status: 'not-attempted', approvedCount: 1 }] : []),
    ] }]);
    if (path === '/api/enrollments') return respond([{ courseId: course, name: 'Introduction to Physics', courseCode: 'PHYS 100', term: 'Winter Term 1' }]);
    if (path.endsWith('/session-summary')) return respond({ welcome: true });
    if (path.endsWith('/exams')) return respond([]);
    if (path.endsWith('/practice/next')) {
      if (failNext || (failAdvance && input.loId === secondLo)) { failNext = failAdvance = false; return route.fulfill({ status: 503, json: { error: 'Please retry loading' } }); }
      if (input.loId === secondLo) return respond(question('660000000000000000000009', 'How do forces combine?'));
      return respond(questions.find(q => !input.sessionServedIds.includes(q.questionId)) ?? questions[0]);
    }
    if (path === '/api/attempts' || path.endsWith('/preview/attempts')) {
      if (holdSubmit) await holdSubmit;
      if (failSubmit) { failSubmit = false; return route.fulfill({ status: 503, json: { error: 'Please retry submitting' } }); }
      const correct = input.selectedKey === 'A';
      const retry = settings.strategyA && !correct && !input.isRetry;
      return respond({ correct, feedback: { strategy: settings.strategyA ? 'a' : 'b', revealed: options.filter(o => !retry || o.key === input.selectedKey).map(o => ({ ...o, role: o.key === 'A' ? 'correct' : 'clearly-wrong', correct: o.key === 'A', explanation: o.key === 'A' ? 'These two forces balance.' : 'The table also exerts a normal force.' })),
        ...(retry ? { retry: { ...question(retryId, 'Which forces act on a shelf-supported object?'), paramValues: { m: 3 } } } : {}) },
        mastery: { loStatus: settings.secondLo && correct ? 'covered' : 'in-progress', ...(settings.secondLo && correct ? { recommendation: 'advance-lo' } : {}) }, reviewBook: { added: !correct },
      });
    }
    if (path.endsWith('/metadata')) { Object.assign(library.find(q => path.includes(q.questionId))!, input); return respond({}); }
    if (path.endsWith('/flag')) return respond({ flagged: true, duplicate: true });
    return route.fulfill({ status: 404, json: { error: `Unconfigured test API: ${path}` } });
  });
  await page.goto('/topic-fixture');
  return {
    requests,
    failSubmit: () => { failSubmit = true; }, failNext: () => { failNext = true; }, failAdvance: () => { failAdvance = true; },
    hold: () => { let release!: () => void; holdSubmit = new Promise<void>(resolve => { release = resolve; }); return () => { release(); holdSubmit = undefined; }; },
  };
}

async function mount(page: Page, preview = false, fromHome = false) {
  await page.evaluate(async ({ course, theme, preview, fromHome }) => {
    const { renderPracticeWithExperience } = await import('/js/views/student/practice.js');
    const { LIVE_STUDENT_EXPERIENCE, createPreviewStudentExperience } = await import('/js/views/student/experience.js');
    const { getAnonymousPreviewSession } = await import('/js/preview-session.js');
    const experience = preview ? createPreviewStudentExperience(getAnonymousPreviewSession(course), { restricted: true, sendToInstructorQueue: false }) : LIVE_STUDENT_EXPERIENCE;
    const outlet = document.getElementById('fixture')!;
    if (fromHome) {
      const { startRouter } = await import('/js/router.js');
      const { renderCourseHomeWithExperience } = await import('/js/views/student/course-home.js');
      history.replaceState(null, '', experience.routes.course(course));
      startRouter({ outlet, fallback: `/course/${course}`, routes: [
        { path: '/course/:id', render: (root, params) => renderCourseHomeWithExperience(root, params, experience) },
        { path: '/course/:id/practice-theme/:themeId', render: (root, params) => renderPracticeWithExperience(root, params, experience) },
      ] });
    } else {
      history.replaceState(null, '', experience.routes.practiceTheme(course, theme));
      await renderPracticeWithExperience(outlet, { id: course, themeId: theme }, experience);
    }
  }, { course, theme, preview, fromHome });
}
const submit = async (page: Page, key = 'A') => {
  await page.locator('.learning-option').filter({ hasText: key === 'A' ? 'Gravity and the normal force.' : 'Gravity only.' }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
};
const next = (page: Page) => page.getByRole('button', { name: 'Next question →', exact: true }).click();
const previous = (page: Page) => page.getByRole('button', { name: '← Previous question', exact: true }).click();
const stem = (page: Page) => page.locator('.learning-stem');

test('Course Home Topic Start opens new layout in the default mode; skipped drafts remain editable', async ({ page }) => {
  const fixture = await setup(page); await mount(page, false, true);
  await page.getByRole('button', { name: 'Start →', exact: true }).click();
  await expect(page.locator('.learning-workspace')).toBeVisible();
  await expect(page.locator('.learning-footer button')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Personal tags' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ask the class' })).toHaveCount(0);
  await page.locator('.learning-option').filter({ hasText: 'Gravity only.' }).click();
  await next(page); await previous(page);
  await expect(page.getByText('You skipped this question. You can answer it now.')).toBeVisible();
  await expect(page.locator('.learning-option.is-selected')).toContainText('Gravity only.');
  await page.getByRole('button', { name: 'Save to Review Book' }).click();
  await expect(page.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe the problem' }).fill('The wording is unclear.');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('A report for this question is already pending.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await next(page); await next(page);
  await expect(page.getByRole('heading', { name: 'Practice summary', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/topic-practice-bank-exhausted.png', fullPage: true });
  await page.getByRole('button', { name: 'Return to unanswered questions' }).click();
  await expect(stem(page)).toHaveText(questions[1].stem);
  await page.getByRole('button', { name: '▦ Question board · 2' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /1 · Needs review/ }).click();
  await expect(stem(page)).toHaveText(questions[0].stem);
  expect(fixture.requests.filter(r => r.path.includes('/learning/sessions'))).toHaveLength(0);
});

test('Strategy A retains withheld feedback and serves the server-provided retry with its pinned values', async ({ page }) => {
  const fixture = await setup(page, { strategyA: true }); await mount(page);
  await submit(page, 'B');
  await expect(page.getByText('These two forces balance.')).toHaveCount(0);
  await expect(page.getByText('The table also exerts a normal force.')).toBeVisible();
  await page.screenshot({ path: 'test-results/topic-practice-incorrect-retry.png', fullPage: true });
  await next(page); await expect(stem(page)).toHaveText('Which forces act on a shelf-supported object?');
  await page.screenshot({ path: 'test-results/topic-practice-followup.png', fullPage: true });
  await submit(page);
  const attempts = fixture.requests.filter(r => r.path === '/api/attempts');
  expect(attempts).toHaveLength(2); expect(attempts[1].input).toMatchObject({ questionVersionId: retryId, loId: lo, mode: 'topic-practice', isRetry: true, paramValues: { m: 3 } });
  expect(fixture.requests.filter(r => r.path.endsWith('/practice/next'))).toHaveLength(1);
  await previous(page); await expect(page.getByText('These two forces balance.')).toHaveCount(0);
});

test('a skipped question answered later inserts its retry without losing the already visited question', async ({ page }) => {
  await setup(page, { strategyA: true }); await mount(page); await next(page); await previous(page);
  await submit(page, 'B'); await next(page);
  await expect(stem(page)).toHaveText('Which forces act on a shelf-supported object?');
  await submit(page); await next(page);
  await expect(stem(page)).toHaveText(questions[1].stem);
});

test('failed load preserves drafts; failed/slow submissions stay retryable and prevent duplicate attempts', async ({ page }) => {
  const fixture = await setup(page); await mount(page);
  await page.locator('.learning-option').first().click(); fixture.failNext(); await next(page);
  await expect(page.getByText('Please retry loading')).toBeVisible();
  await expect(stem(page)).toHaveText(questions[0].stem);
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  fixture.failSubmit(); const release = fixture.hold();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Submit', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  expect(fixture.requests.filter(r => r.path === '/api/attempts')).toHaveLength(1);
  release(); await expect(page.getByText('Please retry submitting')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Correct! Continue when you are ready.')).toBeVisible();
});

test('mastery progression recovers from a failed next-LO load; repeated rounds remain explicit', async ({ page }) => {
  const fixture = await setup(page, { secondLo: true }); await mount(page); await submit(page);
  fixture.failAdvance(); await page.getByRole('button', { name: 'Advance to next LO' }).click();
  await expect(page.getByText('Please retry loading')).toBeVisible();
  await page.getByRole('button', { name: 'Advance to next LO' }).click();
  await expect(stem(page)).toHaveText('How do forces combine?');
  await next(page); await expect(page.getByRole('heading', { name: 'Practice summary', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with repeats' }).click();
  await expect(stem(page)).toHaveText('How do forces combine?');
  expect(fixture.requests.filter(r => r.path.endsWith('/practice/next')).slice(-1)[0].input).toMatchObject({ loId: secondLo, sessionServedIds: [] });
});

test('restricted Student Preview uses the same default-mode layout and isolated APIs', async ({ page }) => {
  const fixture = await setup(page, { preview: true }); await mount(page, true);
  await expect(page.locator('.learning-workspace')).toBeVisible(); await submit(page);
  await page.getByRole('button', { name: 'Save to Review Book' }).click();
  const calls = fixture.requests.filter(r => r.path.startsWith('/api/'));
  expect(calls.every(r => r.path.includes('/preview/'))).toBe(true);
  expect(calls.every(r => (r.query.includes('previewSessionId=') || r.input.previewSessionId) && r.query.includes('access=restricted'))).toBe(true);
  expect(new Set(calls.map(r => new URLSearchParams(r.query).get('previewSessionId') ?? r.input.previewSessionId)).size).toBe(1);
});

test('new default-mode layout keeps its footer visible and passes desktop/mobile light/dark accessibility', async ({ page }) => {
  await setup(page); await mount(page);
  await next(page); await next(page);
  await expect(page.getByRole('heading',{name:'Practice summary'})).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'Submit',exact:true})).toHaveCount(0);
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    await expect(page.locator('.learning-footer')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const scan = await new AxeBuilder({ page }).include('#fixture').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({ path: `test-results/topic-practice-${width}.png`, fullPage: true });
  }
});
