// Instructor Questions workspace (spec 2026-11-09). Every /api call is mocked
// in-page, so this needs only the static client on the dev server:
//   npx playwright test -c playwright.questions-workspace.config.ts
import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type State = 'draft' | 'pending-review' | 'reviewed' | 'approved' | 'paused' | 'archived';
interface MockQuestion {
  id: string; courseId: string; currentVersionId: string; currentVersion: number; state: State;
  themeIds: string[]; loIds: string[]; labels: string[]; internalNotes: Array<{ text: string; at: string; puid: string }>;
  versions: unknown[]; agentDecision?: { decision: 'pass' | 'flag' | 'reject'; reasoning: string; roleAssessment: string; suggestions?: string[] };
  current: Record<string, unknown> & { _id: string; stem: string };
  createdAt: string; updatedAt: string;
}
interface MockFlag {
  id: string; courseId: string; questionId: string; questionVersionId: string; puid: string; source: 'student' | 'ta' | 'instructor-preview-test';
  reason: string; state: string; createdAt: string; resolution?: Record<string, unknown>;
}

const TAB_STATES: Record<string, State[]> = {
  review: ['draft', 'pending-review', 'reviewed'], approved: ['approved'], paused: ['paused'], archived: ['archived'],
};

function makeQuestion(i: number, state: State, themeId = 'forces'): MockQuestion {
  return {
    id: `q${i}`, courseId: 'course', currentVersionId: `v${i}`, currentVersion: 1, state,
    themeIds: [themeId], loIds: [themeId === 'forces' ? 'lo-net' : 'lo-motion'], labels: [], internalNotes: [], versions: [],
    agentDecision: { decision: i % 3 ? 'pass' : 'flag', reasoning: 'Signs and magnitudes are consistent.', roleAssessment: 'Distractors are plausible.', suggestions: ['Name the axis.'] },
    current: {
      _id: `v${i}`, questionId: `q${i}`, version: 1, type: 'mcq', difficulty: 'easy',
      stem: `Question ${i}: Two opposite forces act on one object. What is the net force?`,
      options: [
        { key: 'A', text: 'Zero, always.', role: 'clearly-wrong', explanation: 'Only equal forces cancel.' },
        { key: 'B', text: 'The signed sum of the forces.', role: 'correct', explanation: 'Add the vectors.' },
      ],
      sourceRefs: [{ materialId: 'm1', chunk: 'The resultant is the vector sum.' }],
    },
    createdAt: '2026-11-01T00:00:00Z', updatedAt: `2026-11-0${(i % 8) + 1}T00:00:00Z`,
  };
}

async function setup(page: Page, options: { coursePublished?: boolean; tab?: string; extraHash?: string } = {}) {
  const questions: MockQuestion[] = [
    ...[1, 2, 3, 4].map((i) => makeQuestion(i, 'draft')),
    makeQuestion(5, 'approved'),
    makeQuestion(6, 'approved', 'motion'),
    makeQuestion(7, 'paused'),
    makeQuestion(8, 'archived'),
  ];
  const themes = [
    { themeId: 'forces', name: 'Forces', order: 0, revision: 2, availableFrom: '2026-01-01T00:00:00Z' },
    { themeId: 'motion', name: 'Motion', order: 1, revision: 4, availableFrom: null as string | null },
  ];
  const flags: MockFlag[] = [
    { id: 'f1', courseId: 'course', questionId: 'q5', questionVersionId: 'v5', puid: 'student-a', source: 'student', reason: 'Option B looks wrong to me.', state: 'open', createdAt: '2026-11-05T10:00:00Z' },
    { id: 'f2', courseId: 'course', questionId: 'q5', questionVersionId: 'v5', puid: 'student-b', source: 'student', reason: 'Units missing.', state: 'open', createdAt: '2026-11-06T10:00:00Z' },
  ];
  const coursePublished = options.coursePublished ?? true;
  const failIds = new Set<string>();
  const themeCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
  const resolveCalls: Array<{ id: string; body: Record<string, unknown> }> = [];

  const released = (themeId: string): boolean => {
    const theme = themes.find((t) => t.themeId === themeId);
    return !!theme?.availableFrom && Date.parse(theme.availableFrom) <= Date.now();
  };
  const openFlagCount = (id: string): number => flags.filter((f) => f.questionId === id && (f.state === 'open' || f.state === 'escalated')).length;
  const row = (q: MockQuestion) => {
    const visible = q.state === 'approved' && coursePublished && q.themeIds.every(released);
    const hiddenReason = q.state !== 'approved' ? 'not-approved' : !coursePublished ? 'course-unpublished' : !q.themeIds.every(released) ? 'topic-unreleased' : undefined;
    return { ...q, contentReady: true, openFlagCount: openFlagCount(q.id), studentVisible: visible, ...(hiddenReason ? { hiddenReason } : {}), ...(q.agentDecision ? { agentVerdict: q.agentDecision.decision } : {}) };
  };
  const workspace = (tab: string) => {
    const rows = questions.map(row);
    const approved = rows.filter((r) => r.state === 'approved');
    const visible = approved.filter((r) => r.studentVisible).length;
    const inTab = (r: ReturnType<typeof row>) => tab === 'flags' ? r.openFlagCount > 0 : TAB_STATES[tab].includes(r.state);
    return {
      tab,
      counts: {
        review: rows.filter((r) => TAB_STATES.review.includes(r.state)).length, approved: approved.length,
        approvedVisible: visible, approvedWaiting: approved.length - visible,
        flags: rows.filter((r) => r.openFlagCount > 0).length,
        paused: rows.filter((r) => r.state === 'paused').length, archived: rows.filter((r) => r.state === 'archived').length,
      },
      release: {
        coursePublished,
        themes: themes.map((t) => ({ ...t, released: released(t.themeId), approvedCount: approved.filter((r) => r.themeIds.includes(t.themeId)).length })),
        hiddenApprovedCount: approved.length - visible,
      },
      items: rows.filter(inTab),
    };
  };

  await page.route('**/questions-fixture', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Questions</title><link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/questions-workspace.css"><link rel="stylesheet" href="/vendor/katex.min.css"><script src="/vendor/katex.min.js"></script><script src="/vendor/katex-auto-render.min.js"></script><script src="/vendor/marked.min.js"></script><script src="/vendor/purify.min.js"></script></head><body><main></main></body></html>' }));
  await page.route('**/api/**', async (r: Route) => {
    const url = new URL(r.request().url());
    const path = url.pathname;
    const method = r.request().method();
    if (path === '/api/courses/course/question-workspace') return r.fulfill({ json: workspace(url.searchParams.get('tab') ?? 'review') });
    if (path === '/api/courses/course') return r.fulfill({ json: { _id: 'course', lifecycle: coursePublished ? 'published' : 'draft', themes: [
      { _id: 'forces', name: 'Forces', order: 0, los: [{ _id: 'lo-net', name: 'Combine forces to find net force' }] },
      { _id: 'motion', name: 'Motion', order: 1, los: [{ _id: 'lo-motion', name: 'Describe motion' }] },
    ] } });
    if (path === '/api/courses/course/flags') {
      const questionId = url.searchParams.get('questionId');
      return r.fulfill({ json: flags.filter((f) => !questionId || f.questionId === questionId).map((f) => ({ ...f, question: { ...questions.find((q) => q.id === f.questionId) }, currentVersion: null })) });
    }
    const resolve = path.match(/^\/api\/flags\/(f\d+)\/resolve$/);
    if (resolve) {
      const body = r.request().postDataJSON();
      resolveCalls.push({ id: resolve[1], body });
      const flag = flags.find((f) => f.id === resolve[1])!;
      flag.state = `resolved-${body.action === 'clear' ? 'cleared' : body.action}`;
      flag.resolution = { action: body.action, puid: 'me', at: new Date().toISOString(), comment: body.comment };
      return r.fulfill({ json: flag });
    }
    const theme = path.match(/^\/api\/themes\/(\w+)$/);
    if (theme && method === 'PATCH') {
      const body = r.request().postDataJSON();
      themeCalls.push({ id: theme[1], body });
      const target = themes.find((t) => t.themeId === theme[1])!;
      if (body.expectedRevision !== target.revision) return r.fulfill({ status: 409, json: { error: 'edit-conflict' } });
      target.availableFrom = body.availableFrom; target.revision++;
      return r.fulfill({ json: { _id: target.themeId, name: target.name, order: target.order, revision: target.revision, availableFrom: target.availableFrom ?? undefined } });
    }
    const match = path.match(/^\/api\/questions\/(q\d+)(\/transition)?$/);
    if (match) {
      const question = questions.find((q) => q.id === match[1])!;
      if (match[2]) {
        const body = r.request().postDataJSON();
        if (failIds.has(question.id)) return r.fulfill({ status: 409, json: { error: 'question-conflict' } });
        question.state = body.to;
        return r.fulfill({ json: question });
      }
      return r.fulfill({ json: question });
    }
    return r.fulfill({ json: {} });
  });
  const hash = `#/instructor/course/course/questions${options.tab ? `?tab=${options.tab}` : ''}${options.extraHash ?? ''}`;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`/questions-fixture${hash}`);
  await page.evaluate(async () => {
    const { renderQuestions } = await import('/js/views/instructor/questions.js');
    renderQuestions(document.querySelector('main')!, { id: 'course' });
  });
  await expect(page.locator('.questions-tabs')).toBeVisible();
  return { questions, themes, flags, failIds, themeCalls, resolveCalls };
}

// Any uncaught page error fails the test that produced it.
let pageErrors: string[] = [];
test.beforeEach(() => { pageErrors = []; });
test.afterEach(() => { expect(pageErrors).toEqual([]); });

const tabCount = (page: Page, label: string) => page.locator('.questions-tab', { hasText: label }).locator('.questions-tab__count');

test('old routes redirect to the matching tab and keep the selection', async ({ page }) => {
  await page.route('**/redirect-fixture', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>R</title></head><body><main></main></body></html>' }));
  for (const [from, to] of [
    ['/instructor/course/course/bank?q=q5', '/instructor/course/course/questions?tab=approved&q=q5'],
    ['/instructor/course/course/queue?runId=r1', '/instructor/course/course/questions?tab=review&runId=r1'],
    ['/instructor/course/course/flags?question=q5', '/instructor/course/course/questions?tab=flags&q=q5'],
  ]) {
    await page.goto(`/redirect-fixture#${from}`);
    await page.evaluate(async () => {
      const { renderLegacyQuestionsRedirect } = await import('/js/views/instructor/questions.js');
      renderLegacyQuestionsRedirect(document.querySelector('main')!, { id: 'course' });
    });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${to}`);
  }
});

test('defaults to To review, approves and rejects, and moves counts', async ({ page }) => {
  const mock = await setup(page);
  await expect(page.locator('.questions-tab.is-active')).toContainText('To review');
  await expect(tabCount(page, 'To review')).toHaveText('4');
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 1:');
  await expect(page.locator('.questions-reader__context')).toContainText('Name the axis.');

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.locator('.questions-notice')).toContainText('Question approved.');
  await expect(tabCount(page, 'To review')).toHaveText('3');
  await expect(tabCount(page, 'Approved')).toHaveText('3');
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 2:');
  expect(mock.questions[0].state).toBe('approved');

  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByLabel('Reason for rejecting (optional)').fill('Ambiguous wording');
  await page.getByRole('button', { name: 'Reject question' }).click();
  await expect(tabCount(page, 'Archived')).toHaveText('2');
  expect(mock.questions[1].state).toBe('archived');
});

test('a stale version says the question changed and reloads it', async ({ page }) => {
  const mock = await setup(page);
  mock.failIds.add('q1');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.locator('.questions-reader__notice')).toContainText('This question changed since you opened it');
  expect(mock.questions[0].state).toBe('draft');
});

test('bulk partial failure lists the failures and keeps them selected', async ({ page }) => {
  const mock = await setup(page);
  mock.failIds.add('q3');
  await page.getByLabel('Select all shown questions').check();
  await page.getByRole('button', { name: 'Approve selected' }).click();
  await expect(page.locator('.questions-bulk__message')).toContainText('Approved 3 of 4 questions. 1 still selected');
  await expect(page.locator('.questions-bulk__error')).toContainText('Question 3:');
  await expect(page.locator('.questions-row.is-selected')).toHaveCount(1);
  await expect(page.locator('.questions-row.is-selected')).toContainText('Question 3:');
  await expect(tabCount(page, 'To review')).toHaveText('1');
});

test('releasing a Topic clears the hidden-questions warning', async ({ page }) => {
  const mock = await setup(page, { tab: 'approved' });
  await expect(page.locator('.questions-release-bar')).toContainText('1 approved question is not visible to students yet.');
  await expect(page.locator('.questions-reader__visibility').first()).toBeVisible();
  await page.getByRole('button', { name: 'Manage releases' }).first().click();
  const row = page.locator('.questions-release__row', { hasText: 'Motion' });
  await expect(row).toContainText('1 approved · Hidden');
  await row.getByLabel('Release now').check();
  await page.getByRole('button', { name: 'Save releases' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Release settings saved for 1 topic.');
  await expect(page.locator('.questions-release-bar')).toContainText('All 2 approved questions are visible to students.');
  expect(mock.themeCalls).toEqual([{ id: 'motion', body: expect.objectContaining({ expectedRevision: 4 }) }]);
});

test('an unpublished course says so first and links to the Dashboard', async ({ page }) => {
  await setup(page, { coursePublished: false, tab: 'approved' });
  const bar = page.locator('.questions-release-bar');
  await expect(bar).toContainText('The course is not published — students see no questions.');
  await expect(bar.getByRole('link', { name: 'Publish from the Dashboard →' })).toHaveAttribute('href', '#/instructor/course/course');
  await expect(page.locator('.questions-reader__visibility')).toContainText('the course is not published');
});

test('the flag card shows reports and clears the flag', async ({ page }) => {
  const mock = await setup(page, { tab: 'flags', extraHash: '&flag=f2' });
  await expect(tabCount(page, 'Student flags')).toHaveText('1');
  const card = page.locator('.questions-flag-card');
  await expect(card).toContainText('2 open reports');
  await expect(card).toContainText('2 students');
  await expect(card).toContainText('Option B looks wrong to me.');
  await expect(card.locator('li.is-highlighted')).toContainText('Units missing.');
  await expect(card.getByRole('link', { name: 'Correct the question' })).toHaveAttribute('href', /bank\/q5\?from=flags&flagVersionId=v5&intent=edit/);
  await expect(card.getByRole('link', { name: 'Archive the question' })).toHaveAttribute('href', /intent=archive/);
  await card.getByRole('button', { name: 'Clear the flag' }).click();
  await page.getByLabel('Reply to the flagging student(s) (optional)').fill('The question is correct.');
  await page.getByRole('button', { name: 'Clear the flag' }).last().click();
  await expect(tabCount(page, 'Student flags')).toHaveText('0');
  expect(mock.resolveCalls.map((c) => [c.id, c.body.action])).toEqual([['f1', 'clear'], ['f2', 'clear']]);
});

test('paused questions resume and archived questions restore to review', async ({ page }) => {
  const mock = await setup(page, { tab: 'paused' });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(tabCount(page, 'Paused')).toHaveText('0');
  expect(mock.questions[6].state).toBe('approved');
  await page.locator('.questions-tab', { hasText: 'Archived' }).click();
  await page.getByRole('button', { name: 'Restore to review' }).click();
  await page.getByRole('button', { name: 'Restore to review' }).last().click();
  await expect(tabCount(page, 'Archived')).toHaveText('0');
  expect(mock.questions[7].state).toBe('draft');
});

test('390px dark layout stacks list and reader without horizontal scroll, and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { tab: 'approved' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(page.locator('.questions-reader')).toBeHidden();
  await page.locator('.questions-row__open').first().click();
  await expect(page.locator('.questions-reader')).toBeVisible();
  await expect(page.locator('.questions-list')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '← Back to list' }).click();
  await expect(page.locator('.questions-list')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.questions-workspace').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
