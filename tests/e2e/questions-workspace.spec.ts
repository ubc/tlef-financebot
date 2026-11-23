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
  suggestions?: Array<{ id: string; puid: string; patch: Record<string, unknown>; status: string; at: string }>;
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

async function setup(page: Page, options: { coursePublished?: boolean; tab?: string; extraHash?: string; withUsage?: boolean; parameterized?: boolean; suggestions?: boolean; testFlag?: boolean; distributionFailures?: number; verificationError?: string } = {}) {
  const questions: MockQuestion[] = [
    ...[1, 2, 3, 4].map((i) => makeQuestion(i, 'draft')),
    makeQuestion(5, 'approved'),
    makeQuestion(6, 'approved', 'motion'),
    makeQuestion(7, 'paused'),
    makeQuestion(8, 'archived'),
  ];
  if (options.withUsage) {
    for (const [item, question] of questions.slice(0, 2).entries()) {
      question.current.provenance = { kind: 'generated', runId: 'r0', item };
    }
  }
  if (options.parameterized) {
    // q1 (draft) and q5 (approved) become calculations: a drawn input and a derived answer.
    for (const index of [0, 4]) Object.assign(questions[index].current, {
      stem: 'A force of {{F}} N acts on 2 kg. What is the acceleration?',
      paramSlots: [{ name: 'F', min: 2, max: 10, step: 2 }],
      derivedValues: [{ name: 'A', formula: 'F/2' }, { name: 'A_WRONG', formula: 'F*2', errorModel: 'multiplied instead of divided' }],
      options: [
        { key: 'A', text: '{{A_WRONG}} m/s²', role: 'clearly-wrong', explanation: 'Multiplied by the mass.' },
        { key: 'B', text: '{{A}} m/s²', role: 'correct', explanation: 'a = F/m.' },
      ],
    });
  }
  if (options.suggestions) {
    questions[0].suggestions = [
      { id: 's1', puid: 'ta-one', status: 'pending', at: '2026-11-10T10:00:00Z', patch: { stem: 'Question 1: Two opposite forces act on one cart. What is the net force?' } },
      { id: 's2', puid: 'ta-two', status: 'pending', at: '2026-11-11T10:00:00Z', patch: { difficulty: 'hard' } },
    ];
  }
  const themes = [
    { themeId: 'forces', name: 'Forces', order: 0, revision: 2, availableFrom: '2026-01-01T00:00:00Z' },
    { themeId: 'motion', name: 'Motion', order: 1, revision: 4, availableFrom: null as string | null },
  ];
  const flags: MockFlag[] = [
    { id: 'f1', courseId: 'course', questionId: 'q5', questionVersionId: 'v5', puid: 'student-a', source: 'student', reason: 'Option B looks wrong to me.', state: 'open', createdAt: '2026-11-05T10:00:00Z' },
    { id: 'f2', courseId: 'course', questionId: 'q5', questionVersionId: 'v5', puid: 'student-b', source: 'student', reason: 'Units missing.', state: 'open', createdAt: '2026-11-06T10:00:00Z' },
  ];
  if (options.testFlag) {
    flags.push({ id: 'f3', courseId: 'course', questionId: 'q6', questionVersionId: 'v6', puid: 'instructor', source: 'instructor-preview-test', reason: 'Testing the flag loop.', state: 'open', createdAt: '2026-11-07T10:00:00Z' });
  }
  let coursePublished = options.coursePublished ?? true;
  let courseRevision = 2;
  const publishCalls: Array<Record<string, unknown>> = [];
  const failIds = new Set<string>();
  const themeCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
  const resolveCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
  const patchCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
  const transitionCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
  const noteCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
  const suggestionCalls: Array<[string, string]> = [];
  let sampleCalls = 0;
  const previewCalls: Array<Record<string, unknown>> = [];
  const notifyCalls: string[] = [];
  let distributionFailures = options.distributionFailures ?? 0;
  const regenerateCalls: Array<Record<string, unknown>> = [];

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
    if (options.withUsage && /^\/api\/questions\/q[12]\/generation-usage$/.test(path)) {
      const first = path.includes('/q1/');
      const summary = (inputTokens: number, outputTokens: number, partial: boolean, estimatedUsd: number) => ({
        inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, reportedCalls: 1, status: partial ? 'partial' : 'complete',
        cost: { estimatedUsd, unpricedCalls: Number(partial), models: [{ provider: 'openai', model: 'gpt-6-luna', tokens: inputTokens + outputTokens, estimatedUsd, unpricedCalls: Number(partial) }] },
      });
      return r.fulfill({ json: { original: { runId: 'r0', wholeTask: false, partial: !first,
        summary: first ? summary(150, 30, false, 0.000030) : summary(600, 400, true, 0.000260) },
      alternatives: first ? null : summary(90, 10, false, 0.000014), alternativesPartial: false } });
    }
    if (path === '/api/courses/course/question-workspace') return r.fulfill({ json: workspace(url.searchParams.get('tab') ?? 'review') });
    if (path === '/api/courses/course/instructor-workflow') {
      const allReleased = themes.every((t) => released(t.themeId));
      const objectives = 'Combine forces to find net force, Describe motion with and without acceleration.';
      const checklist = [
        { item: 'Term dates set', ok: true },
        { item: 'At least one Theme', ok: true },
        { item: 'At least one Learning Objective', ok: true },
        { item: `Every LO has ≥3 Approved questions (thin: ${objectives})`, ok: false },
        { item: allReleased ? 'Every Topic released' : 'Every Topic released (not yet: Motion)', ok: allReleased },
      ];
      return r.fulfill({ json: {
        course: { id: 'course', name: 'Physics', lifecycle: coursePublished ? 'published' : 'draft', revision: courseRevision },
        readiness: { checklist, total: checklist.length, completed: checklist.filter((item) => item.ok).length },
        counts: { approvedQuestions: workspace('approved').counts.approved, thinLos: 2 },
        setup: { previewTested: false },
      } });
    }
    if (path === '/api/courses/course' && method === 'PATCH') {
      const body = r.request().postDataJSON();
      publishCalls.push(body);
      coursePublished = body.published;
      return r.fulfill({ json: { lifecycle: coursePublished ? 'published' : 'draft', revision: ++courseRevision } });
    }
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
      // Mirrors flags.service resolveFlag: archive archives the question once; correct un-pauses.
      const flagged = questions.find((q) => q.id === flag.questionId)!;
      if (body.action === 'archive' && flagged.state !== 'archived') flagged.state = 'archived';
      if (body.action === 'correct' && flagged.state === 'paused') flagged.state = 'approved';
      flag.state = `resolved-${body.action === 'clear' ? 'cleared' : body.action}`;
      flag.resolution = { action: body.action, puid: 'me', at: new Date().toISOString(), comment: body.comment };
      return r.fulfill({ json: flag });
    }
    const notify = path.match(/^\/api\/flags\/(f\d+)\/remediation\/notify$/);
    if (notify) {
      notifyCalls.push(notify[1]);
      for (const f of flags) if (f.resolution) f.resolution.notifiedCount = 2;
      return r.fulfill({ json: { notified: 2 } });
    }
    if (/^\/api\/flags\/f\d+\/remediation$/.test(path)) {
      return r.fulfill({ json: { affectedAttempts: 3, affectedStudents: [{ puid: 'student-a' }, { puid: 'student-b' }], examAttempts: 0, reviewBookEntries: 1 } });
    }
    const regenerate = path.match(/^\/api\/courses\/course\/questions\/(q\d+)\/regenerate$/);
    if (regenerate) {
      regenerateCalls.push(r.request().postDataJSON());
      return r.fulfill({ json: { variant: {
        stem: 'A sled is pushed with 4 N one way and 3 N the other. What is the net force?', difficulty: 'medium', sourceRefs: [],
        options: [
          { key: 'A', text: '7 N', role: 'clearly-wrong', explanation: 'Added the magnitudes.' },
          { key: 'B', text: '1 N', role: 'correct', explanation: 'Opposite forces subtract.' },
        ],
        agentDecision: { decision: 'pass', reasoning: 'The alternative is correct and distinct.', roleAssessment: 'Fine.', suggestions: ['Name the direction.'] },
      } } });
    }
    const distribution = path.match(/^\/api\/courses\/course\/analytics\/questions\/(q\d+)\/distribution$/);
    if (distribution) {
      if (url.searchParams.get('versionId') !== 'v0') return r.fulfill({ status: 404, json: { error: 'question-version-not-found' } });
      if (distributionFailures > 0) { distributionFailures--; return r.fulfill({ status: 503, json: { error: 'Historical service interrupted' } }); }
      return r.fulfill({ json: { questionId: distribution[1], versionId: 'v0', version: 1, stem: 'An older wording of the question.', isCurrent: false, attempts: 12, insufficient: false, misconceptionHighlight: false,
        options: [{ key: 'A', text: 'Old option', role: 'correct', count: 12, pct: 1 }] } });
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
    const sample = path.match(/^\/api\/questions\/(q\d+)\/sample$/);
    if (sample) {
      const question = questions.find((q) => q.id === sample[1])!;
      sampleCalls++;
      const parameterized = !!question.current.paramSlots;
      const fill = (text: string) => text.replace('{{F}}', String(2 * sampleCalls)).replace('{{A_WRONG}}', String(4 * sampleCalls)).replace('{{A}}', String(sampleCalls));
      const current = question.current as unknown as { stem: string; options: Array<{ key: string; text: string; explanation: string }> };
      return r.fulfill({ json: { versionId: question.currentVersionId, stem: fill(current.stem), options: current.options.map((o) => ({ key: o.key, text: fill(o.text), explanation: o.explanation })), parameterized } });
    }
    if (/^\/api\/questions\/q\d+\/params\/preview$/.test(path)) {
      const body = r.request().postDataJSON();
      previewCalls.push(body);
      const slot = (body.paramSlots as Array<{ name: string; min: number }>)[0];
      return r.fulfill({ json: { warnings: [], draws: [1, 2, 3, 4, 5].map((i) => ({ seed: i, values: { F: slot.min * i }, stem: `A force of ${slot.min * i} N acts on 2 kg. What is the acceleration?` })) } });
    }
    const notes = path.match(/^\/api\/questions\/(q\d+)\/internal-notes$/);
    if (notes && method === 'POST') {
      const body = r.request().postDataJSON();
      noteCalls.push({ id: notes[1], body });
      return r.fulfill({ json: { puid: 'me', text: body.text, at: '2026-11-18T12:00:00Z' } });
    }
    const suggestion = path.match(/^\/api\/questions\/(q\d+)\/suggestions\/(s\d+)\/(accept|discard)$/);
    if (suggestion) {
      const question = questions.find((q) => q.id === suggestion[1])!;
      const target = question.suggestions!.find((item) => item.id === suggestion[2])!;
      suggestionCalls.push([target.id, suggestion[3]]);
      target.status = suggestion[3] === 'accept' ? 'accepted' : 'discarded';
      if (suggestion[3] === 'accept') Object.assign(question.current, target.patch);
      return r.fulfill({ status: 204, body: '' });
    }
    const match = path.match(/^\/api\/questions\/(q\d+)(\/transition)?$/);
    if (match) {
      const question = questions.find((q) => q.id === match[1])!;
      if (match[2]) {
        const body = r.request().postDataJSON();
        transitionCalls.push({ id: question.id, body });
        if (failIds.has(question.id) || (body.expectedVersionId && body.expectedVersionId !== question.currentVersionId)) return r.fulfill({ status: 409, json: { error: 'question-conflict' } });
        question.state = body.to;
        return r.fulfill({ json: question });
      }
      if (method === 'PATCH') {
        // Mirrors questions.service editQuestion: content keys make a new
        // version, tags only move the head, and only submitForReview changes state.
        const body = r.request().postDataJSON();
        patchCalls.push({ id: question.id, body });
        if (failIds.has(question.id) || body.expectedVersionId !== question.currentVersionId
          || (body.expectedTags && (JSON.stringify(body.expectedTags.loIds) !== JSON.stringify(question.loIds) || JSON.stringify(body.expectedTags.themeIds) !== JSON.stringify(question.themeIds)))) {
          return r.fulfill({ status: 409, json: { error: 'question-conflict' } });
        }
        if (body.submitForReview && !['approved', 'paused'].includes(question.state)) return r.fulfill({ status: 409, json: { error: 'question-conflict' } });
        const content = ['stem', 'options', 'difficulty', 'paramSlots', 'derivedValues'].filter((key) => body[key] !== undefined);
        if (content.length) {
          question.currentVersion += 1;
          question.currentVersionId = `${question.currentVersionId}-${question.currentVersion}`;
          question.current = { ...question.current, ...Object.fromEntries(content.map((key) => [key, body[key]])), _id: question.currentVersionId, version: question.currentVersion };
          delete question.agentDecision;
        }
        if (body.loIds) question.loIds = body.loIds;
        if (body.themeIds) question.themeIds = body.themeIds;
        if (body.submitForReview) question.state = 'pending-review';
        const unverified = body.derivedValues !== undefined && options.verificationError;
        return r.fulfill({ json: { ...question.current, ...(unverified ? { verificationError: options.verificationError } : {}) } });
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
    const { startRouter } = await import('/js/router.js');
    const { renderCoursePublication } = await import('/js/views/instructor/course-publication.js');
    startRouter({
      routes: [
        { path: '/instructor/course/:id/questions', render: renderQuestions },
        { path: '/instructor/course/:id/publish', render: renderCoursePublication },
      ],
      outlet: document.querySelector('main')!,
      fallback: '/instructor/course/course/questions',
    });
  });
  await expect(page.locator('.questions-tabs')).toBeVisible();
  return { questions, themes, flags, failIds, themeCalls, publishCalls, resolveCalls, patchCalls, noteCalls, suggestionCalls, sampleCalls: () => sampleCalls, notifyCalls, regenerateCalls, previewCalls, transitionCalls };
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
    ['/instructor/course/course/bank/q5/params', '/instructor/course/course/questions?q=q5&mode=params'],
    ['/instructor/course/course/bank/q5?from=flags&flagVersionId=v5&intent=edit', '/instructor/course/course/questions?tab=flags&q=q5&mode=edit&flagVersionId=v5'],
    ['/instructor/course/course/bank/q1?from=questions&intent=regenerate', '/instructor/course/course/questions?q=q1&mode=compare'],
  ]) {
    await page.goto(`/redirect-fixture#${from}`);
    await page.evaluate(async () => {
      const { renderLegacyQuestionsRedirect } = await import('/js/views/instructor/questions.js');
      renderLegacyQuestionsRedirect(document.querySelector('main')!, { id: 'course' });
    });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${to}`);
  }
});

test('the mouse wheel scrolls the reader pane, not a nested contained scroller', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 1:');
  // A contained, non-scrollable .gw-body inside the reader swallowed wheel input.
  const body = page.locator('.questions-reader__body');
  expect(await body.evaluate((node) => getComputedStyle(node).overflowY)).toBe('visible');
  const scroller = page.locator('.questions-reader__scroll');
  await scroller.evaluate((node) => { (node.querySelector('.questions-reader__body') as HTMLElement).style.paddingBottom = '2000px'; });
  await scroller.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
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

test('editing an approved question sends it back to To review', async ({ page }) => {
  const mock = await setup(page, { tab: 'approved' });
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 5:');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.questions-reader__warning')).toContainText('Saving returns this question to To review');
  await page.getByLabel('Question stem').fill('Question 5: Two opposite forces act on a cart. What is the net force?');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.questions-notice')).toContainText('The question is back in To review.');
  expect(mock.patchCalls).toEqual([{ id: 'q5', body: expect.objectContaining({ expectedVersionId: 'v5', submitForReview: true }) }]);
  expect(mock.questions[4].state).toBe('pending-review');
  await expect(tabCount(page, 'Approved')).toHaveText('1');
  await expect(tabCount(page, 'To review')).toHaveText('5');
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

test('releasing a Topic updates the selected question’s visibility', async ({ page }) => {
  const mock = await setup(page, { tab: 'approved', extraHash: '&q=q6' });
  await expect(page.locator('.questions-header + .questions-tabs')).toBeVisible();
  const visibility = page.locator('.questions-reader__visibility');
  await expect(visibility).toContainText('Motion is not released.');
  await visibility.getByRole('button', { name: 'Manage releases' }).click();
  await expect(page.getByRole('heading', { name: 'Release & Publish' })).toBeVisible();
  await expect(page.getByText('3 of 5 launch checks complete')).toBeVisible();
  const row = page.locator('.questions-release__row', { hasText: 'Motion' });
  await expect(row).toContainText('1 approved');
  await expect(row.locator('.questions-release__state')).toHaveText('Hidden');
  await expect(row.locator('input[type="datetime-local"]')).toBeHidden();
  await row.getByLabel('Release now').check();
  await page.getByRole('button', { name: 'Save releases' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Release settings saved for 1 topic.' })).toBeVisible();
  await expect(page.getByText('4 of 5 launch checks complete')).toBeVisible();
  await page.goBack();
  await expect(visibility).toContainText('Visible to students.');
  expect(mock.themeCalls).toEqual([{ id: 'motion', body: expect.objectContaining({ expectedRevision: 4 }) }]);
});

test('publishing keeps launch details compact and updates course visibility', async ({ page }) => {
  const mock = await setup(page, { coursePublished: false, tab: 'approved' });
  const visibility = page.locator('.questions-reader__visibility');
  await expect(visibility).toContainText('the course is not published');
  await visibility.getByRole('link', { name: 'Open publishing checklist →' }).click();
  const details = page.getByText('Combine forces to find net force, Describe motion with and without acceleration.', { exact: true });
  await expect(details).toBeHidden();
  await page.getByText('2 learning objectives have fewer than 3 approved questions').click();
  await expect(details).toBeVisible();
  await page.getByRole('button', { name: 'Publish course', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return to draft' })).toBeVisible();
  expect(mock.publishCalls).toEqual([{ published: true, expectedRevision: 2 }]);
  expect(mock.themeCalls).toEqual([]);
  await page.getByRole('button', { name: 'Return to draft' }).click();
  await expect(page.getByRole('button', { name: 'Publish course', exact: true })).toBeVisible();
  expect(mock.publishCalls.at(-1)).toEqual({ published: false, expectedRevision: 3 });
});

test('the flag card shows reports and clears the flag', async ({ page }) => {
  const mock = await setup(page, { tab: 'flags', extraHash: '&flag=f2' });
  await expect(tabCount(page, 'Student flags')).toHaveText('1');
  const card = page.locator('.questions-flag-card');
  await expect(card).toContainText('2 open reports');
  await expect(card).toContainText('2 students');
  await expect(card).toContainText('Option B looks wrong to me.');
  await expect(card.locator('li.is-highlighted')).toContainText('Units missing.');
  await expect(card.getByRole('button', { name: 'Correct the question' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Archive the question' })).toBeVisible();
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

test('compact filters keep active choices visible and let users clear them independently of search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { tab: 'approved' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const toolbar = page.locator('.questions-toolbar');
  const toggle = toolbar.getByRole('button', { name: 'Filters', exact: true });
  const panel = toolbar.getByRole('group', { name: 'Question filters' });
  const rows = page.locator('.questions-list__rows > li');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await toggle.press('Enter');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('combobox')).toHaveCount(6);
  await panel.getByRole('combobox', { name: 'Topic', exact: true }).selectOption('motion');
  const objectives = panel.getByRole('combobox', { name: 'Learning objective' });
  await expect(objectives.locator('option')).toHaveText(['All objectives', 'Describe motion']);
  await objectives.selectOption('lo-motion');
  await expect(objectives).toBeFocused();
  await expect(rows).toHaveCount(1);
  await expect(toggle).toHaveAccessibleDescription('2 active filters');
  await toggle.press('Space');
  await expect(panel).toBeHidden();
  await toolbar.getByRole('button', { name: /Remove learning objective filter/ }).click();
  await expect(toggle).toHaveAccessibleDescription('1 active filter');
  await expect(toggle).toBeFocused();

  const search = toolbar.getByRole('searchbox', { name: 'Search questions' });
  await search.fill('Question 6:');
  await toolbar.getByRole('button', { name: 'Clear filters' }).click();
  await expect(search).toHaveValue('Question 6:');
  await expect(rows).toHaveCount(1);
  await toggle.click();
  await panel.getByRole('combobox', { name: 'Student visibility' }).selectOption('visible');
  await expect(page.getByRole('heading', { name: 'No matching questions' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const results = await new AxeBuilder({ page }).include('.questions-toolbar').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
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
  for (const tab of ['Settings', 'Team', 'Review']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const tabResults = await new AxeBuilder({ page }).include('.questions-reader').analyze();
    expect(tabResults.violations.map((v) => `${tab} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
  await page.getByRole('button', { name: '← Back to list' }).click();
  await expect(page.locator('.questions-list')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.questions-workspace').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test('generation tokens belong to the selected question, including partial receipts', async ({ page }) => {
  await setup(page, { withUsage: true });
  const usage = page.getByRole('region', { name: 'Generation tokens' });
  await expect(usage.locator('.mu-totals dd')).toHaveText(['150', '30', '180']);
  await expect(usage).toContainText('$0.00003');
  await expect(usage.getByRole('link', { name: 'View generation task' }))
    .toHaveAttribute('href', '#/instructor/course/course/preseeding?runId=r0');
  await page.locator('[data-question-id="q2"] .questions-row__open').click();
  await expect(usage.locator('.mu-totals dd')).toHaveText(['600', '400', '1,000', '90', '10', '100']);
  await expect(usage).toContainText('Partial usage');
  await expect(usage).toContainText('Alternative generation');
  await expect(usage).toContainText('$0.000014');
});

const modeButton = (page: Page, name: string) => page.getByRole('group', { name: 'Reader mode' }).getByRole('button', { name, exact: true });

test('Preview lets the instructor answer using the student options and reveals feedback on submit', async ({ page }) => {
  const attempts: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/attempts')) attempts.push(request.method()); });
  const mock = await setup(page);
  await modeButton(page, 'Preview').click();
  const preview = page.getByRole('region', { name: 'Student preview' });
  const options = preview.locator('.learning-option');
  const submit = preview.getByRole('button', { name: 'Submit', exact: true });
  await expect(submit).toBeDisabled();
  await expect(preview).not.toContainText('Add the vectors.');
  await expect(preview.locator('.learning-option.is-correct')).toHaveCount(0);
  await options.first().click();
  await expect(options.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).not.toContainText('Only equal forces cancel.');
  await submit.click();
  await expect(preview.getByRole('status')).toContainText('Incorrect.');
  await expect(preview.locator('.learning-option.is-correct')).toContainText('Add the vectors.');
  await preview.getByRole('button', { name: 'Try again' }).click();
  await expect(submit).toBeDisabled();
  await expect(preview).not.toContainText('Add the vectors.');
  await options.last().click();
  await submit.click();
  await expect(preview.getByRole('status')).toHaveText('Correct.');
  expect(mock.sampleCalls()).toBe(1);
  expect(mock.patchCalls).toEqual([]);
  expect(attempts).toEqual([]);
});

test('reader modes: leaving Edit asks first, Preview is kept in the URL, another question opens in Read', async ({ page }) => {
  const mock = await setup(page, { tab: 'review', extraHash: '&q=q2&mode=preview' });
  await expect(modeButton(page, 'Preview')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.questions-preview')).toContainText('Question 2:');
  await expect(page.locator('.questions-preview__draw')).toHaveCount(0);

  await modeButton(page, 'Edit').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('mode=edit');
  await page.getByLabel('Question stem').fill('Question 2: changed');
  await modeButton(page, 'Read').click();
  await expect(page.getByRole('dialog')).toContainText('Discard unsaved edits?');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(modeButton(page, 'Edit')).toHaveAttribute('aria-pressed', 'true');
  await modeButton(page, 'Read').click();
  await page.getByRole('button', { name: 'Discard edits' }).click();
  await expect(modeButton(page, 'Read')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.questions-reader__stem')).toContainText('Two opposite forces');
  expect(mock.patchCalls).toEqual([]);

  await modeButton(page, 'Preview').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('mode=preview');
  await page.locator('[data-question-id="q3"] .questions-row__open').click();
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 3:');
  await expect(modeButton(page, 'Read')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('mode=');
});

test('a parameterized question is edited as [NAME], saved as {{NAME}}, and previewed with fresh draws', async ({ page }) => {
  const mock = await setup(page, { parameterized: true });
  await expect(page.locator('.questions-reader__sample-note')).toContainText('Template');
  await modeButton(page, 'Edit').click();
  await expect(page.getByLabel('Question stem')).toHaveValue('A force of [F] N acts on 2 kg. What is the acceleration?');
  await expect(page.getByLabel('Option B', { exact: true })).toHaveValue('[A] m/s²');
  await page.getByLabel('Question stem').fill('A force of [F] N acts on a 2 kg cart. What is the acceleration?');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Changes saved.');
  expect(mock.patchCalls[0].body).toEqual(expect.objectContaining({ stem: 'A force of {{F}} N acts on a 2 kg cart. What is the acceleration?' }));
  // Options were not touched, so they are not sent.
  expect(mock.patchCalls[0].body.options).toBeUndefined();
  expect(mock.patchCalls[0].body.submitForReview).toBeUndefined();

  await modeButton(page, 'Preview').click();
  const preview = page.locator('.questions-preview');
  await expect(preview).toContainText('A force of 2 N acts on a 2 kg cart.');
  await expect(preview).toContainText('Students may receive different values.');
  await preview.getByRole('button', { name: 'Draw another sample' }).click();
  await expect(preview).toContainText('A force of 4 N acts on a 2 kg cart.');
  expect(mock.sampleCalls()).toBe(2);
});

test('Settings changes difficulty and LOs, reports a stale tag set, and waits while editing', async ({ page }) => {
  const mock = await setup(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const settings = page.getByRole('tabpanel');
  await settings.getByLabel('Difficulty').selectOption('hard');
  await settings.getByRole('button', { name: 'Save difficulty' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Difficulty set to hard.');
  expect(mock.patchCalls[0]).toEqual({ id: 'q1', body: { difficulty: 'hard', expectedVersionId: 'v1' } });
  await expect(page.locator('.questions-reader__meta')).toContainText('hard');
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');

  await settings.getByLabel('Add a learning objective').selectOption({ label: 'Topic 2 › LO 1: Describe motion' });
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.questions-notice')).toContainText('Learning objectives updated.');
  expect(mock.patchCalls[1].body).toEqual({
    expectedVersionId: 'v1-2', expectedTags: { loIds: ['lo-net'], themeIds: ['forces'] },
    loIds: ['lo-net', 'lo-motion'], themeIds: ['forces', 'motion'],
  });
  await expect(settings).toContainText('Forces, Motion');

  await settings.getByRole('button', { name: 'Remove Topic 1 › LO 1: Combine forces to find net force' }).click();
  await expect.poll(() => mock.patchCalls.length).toBe(3);
  expect(mock.patchCalls[2].body).toEqual(expect.objectContaining({ loIds: ['lo-motion'] }));
  expect(mock.patchCalls[2].body.themeIds).toBeUndefined();
  const removeMotion = page.getByRole('tabpanel').getByRole('button', { name: 'Remove Topic 2 › LO 1: Describe motion' });
  await expect(page.locator('.questions-settings__chip')).toHaveText(['Topic 2 › LO 1: Describe motion×']);
  await expect(removeMotion).toBeEnabled();

  // Someone else retags the question: the next save is refused and the question reloads.
  mock.questions[0].loIds = ['lo-net'];
  await removeMotion.click();
  await expect(page.locator('.questions-reader__notice')).toContainText('This question changed since you opened it');
  await expect(page.locator('.questions-settings__chip')).toHaveText(['Topic 1 › LO 1: Combine forces to find net force×']);

  await modeButton(page, 'Edit').click();
  await expect(page.getByRole('tabpanel')).toContainText('Finish or cancel editing first.');
  await expect(page.getByRole('tabpanel').getByLabel('Difficulty')).toBeDisabled();
});

test('Team shows TA suggestions and internal comments', async ({ page }) => {
  const mock = await setup(page, { suggestions: true });
  const team = page.getByRole('tab', { name: /Team/ });
  await expect(team.locator('.questions-inspector__count')).toContainText('2');
  await team.click();
  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('ta-one');
  await expect(panel).toContainText('Difficulty: hard (set it in Settings)');

  await panel.locator('.questions-team__card', { hasText: 'ta-one' }).getByRole('button', { name: 'Load into editor' }).click();
  await expect(modeButton(page, 'Edit')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Question stem')).toHaveValue('Question 1: Two opposite forces act on one cart. What is the net force?');
  // A difficulty-only suggestion has nothing for the text editor.
  await expect(panel.locator('.questions-team__card', { hasText: 'ta-two' }).getByRole('button', { name: 'Load into editor' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel editing' }).click();
  await page.getByRole('button', { name: 'Discard edits' }).click();

  await panel.locator('.questions-team__card', { hasText: 'ta-one' }).getByRole('button', { name: 'Accept exactly' }).click();
  await expect(page.locator('.questions-notice')).toContainText('TA suggestion accepted.');
  await page.getByRole('tabpanel').locator('.questions-team__card', { hasText: 'ta-two' }).getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('No pending TA suggestions.');
  expect(mock.suggestionCalls).toEqual([['s1', 'accept'], ['s2', 'discard']]);
  await expect(page.getByRole('tab', { name: /Team/ }).locator('.questions-inspector__count')).toHaveCount(0);

  await page.getByRole('tabpanel').getByLabel('Add a comment').fill('Check the units with the TA.');
  await page.getByRole('tabpanel').getByRole('button', { name: 'Add comment' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Check the units with the TA.');
  expect(mock.noteCalls).toEqual([{ id: 'q1', body: { text: 'Check the units with the TA.' } }]);
});

test('inspector tabs move with the arrow keys and stay chosen across questions', async ({ page }) => {
  await setup(page);
  await page.getByRole('tab', { name: 'Review' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Team/ })).toHaveAttribute('aria-selected', 'true');
  await page.locator('[data-question-id="q2"] .questions-row__open').click();
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 2:');
  await expect(page.getByRole('tab', { name: /Team/ })).toHaveAttribute('aria-selected', 'true');
});

test('correcting a flagged question resolves the reports and notifies the students', async ({ page }) => {
  const mock = await setup(page, { tab: 'flags' });
  const card = page.locator('.questions-flag-card');
  await card.getByRole('button', { name: 'Correct the question' }).click();
  await expect(modeButton(page, 'Edit')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('mode=edit&flagVersionId=v5');
  const fix = page.getByRole('region', { name: 'Fixing flagged reports' });
  await expect(fix).toContainText('Fixing 2 reports');
  await expect(page.locator('.questions-reader__warning')).toContainText('Students get the corrected question as soon as you save.');

  await page.getByRole('button', { name: 'Save and resolve' }).click();
  await expect(page.locator('.questions-reader__notice')).toContainText('Edit the question before resolving the reports.');
  expect(mock.patchCalls).toEqual([]);

  await page.getByLabel('Option B', { exact: true }).fill('The vector sum of the forces.');
  await fix.getByLabel('Reply to flagging students').fill('Thanks — the wording is fixed.');
  await page.getByRole('button', { name: 'Save and resolve' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Question corrected. 2 reports resolved; 2 students notified.');
  // P2-1: the correction stays live.
  expect(mock.patchCalls[0].body.submitForReview).toBeUndefined();
  expect(mock.questions[4].state).toBe('approved');
  expect(mock.resolveCalls.map((c) => [c.id, c.body.action, c.body.correctnessAffecting, c.body.comment])).toEqual([
    ['f1', 'correct', true, 'Thanks — the wording is fixed.'],
    ['f2', 'correct', true, 'Thanks — the wording is fixed.'],
  ]);
  expect(mock.notifyCalls).toEqual(['f1']);
  await expect(tabCount(page, 'Student flags')).toHaveText('0');
});

test('a test flag is resolved without notifying anyone, and a flag fix opens from its URL', async ({ page }) => {
  const mock = await setup(page, { tab: 'flags', testFlag: true, extraHash: '&q=q6&mode=edit&flagVersionId=v6' });
  const fix = page.getByRole('region', { name: 'Fixing flagged reports' });
  await expect(fix).toContainText('Fixing 1 report');
  await expect(fix).toContainText('TEST · Instructor preview');
  await expect(fix).toContainText('This is a test flag, so no student gets a message.');
  await page.getByLabel('Question stem').fill('Question 6: Two opposite forces act on one object. What is the net force on it?');
  await page.getByRole('button', { name: 'Save and resolve' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Question corrected. 1 report resolved.');
  expect(mock.resolveCalls.map((c) => [c.id, c.body.action])).toEqual([['f3', 'correct']]);
  expect(mock.notifyCalls).toEqual([]);
});

test('archiving from the flag card resolves the reports and archives the question', async ({ page }) => {
  const mock = await setup(page, { tab: 'flags' });
  await page.locator('.questions-flag-card').getByRole('button', { name: 'Archive the question' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reply to the flagging student(s) (optional)').fill('We removed this question.');
  await dialog.getByRole('button', { name: 'Archive the question' }).click();
  await expect(tabCount(page, 'Archived')).toHaveText('2');
  expect(mock.resolveCalls.map((c) => [c.id, c.body.action, c.body.comment])).toEqual([
    ['f1', 'archive', 'We removed this question.'], ['f2', 'archive', 'We removed this question.'],
  ]);
  expect(mock.questions[4].state).toBe('archived');
});

test('Compare generates an alternative beside the current version and replaces it', async ({ page }) => {
  const mock = await setup(page);
  await expect(page.locator('.questions-reader__context')).toBeVisible();
  await modeButton(page, 'Compare').click();
  await expect(page.locator('.questions-reader__context')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('mode=compare');
  await page.getByRole('button', { name: 'Generate alternative' }).click();
  const alternative = page.getByRole('article', { name: 'Generated alternative' });
  await expect(alternative).toContainText('A sled is pushed');
  await expect(page.getByRole('article', { name: 'Current · version 1' })).toContainText('Question 1:');
  await expect(page.getByRole('region', { name: 'Check of the generated alternative' })).toContainText('Name the direction.');
  expect(mock.regenerateCalls).toEqual([{ prompt: expect.stringContaining('distinct alternative') }]);

  await expect(page.locator('.questions-reader__actions button')).toHaveText(['Cancel', 'Replace with variant']);
  await expect(modeButton(page, 'Read')).toBeDisabled();
  await expect(modeButton(page, 'Compare')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Replace with variant' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Variant saved as version 2.');
  expect(mock.patchCalls[0].body).toEqual(expect.objectContaining({ expectedVersionId: 'v1', difficulty: 'medium', stem: expect.stringContaining('A sled is pushed') }));
  await expect(modeButton(page, 'Read')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.questions-reader__context')).toBeVisible();
});

test('Compare resumes its stream after switching questions and keeps the decision until Cancel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  const mock = await setup(page);
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!String(input).endsWith('/regenerate')) return realFetch(input, init);
      if (new Headers(init?.headers).get('Accept') !== 'text/event-stream') throw new Error('SSE was not requested');
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const push = (event: Event): void => {
            const chunk = (event as CustomEvent<string>).detail;
            if (chunk) controller.enqueue(encoder.encode(chunk));
            else {
              window.removeEventListener('test-regeneration-chunk', push);
              controller.close();
            }
          };
          window.addEventListener('test-regeneration-chunk', push);
          controller.enqueue(encoder.encode('event: progress\r\ndata: {"stage":"generating"}\r\n\r\n'));
        },
      });
      return Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    };
  });
  const send = (chunk: string) => page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent('test-regeneration-chunk', { detail }));
  }, chunk);

  await modeButton(page, 'Compare').click();
  await page.getByRole('button', { name: 'Generate alternative', exact: true }).click();
  const alternative = page.getByRole('article', { name: 'Generated alternative' });
  const status = alternative.getByRole('status');
  await expect(status).toHaveText('Writing the alternative…');
  await expect(status).toBeInViewport();
  const current = page.getByRole('article', { name: 'Current · version 1' });
  expect((await alternative.boundingBox())!.x).toBeGreaterThan((await current.boundingBox())!.x);
  await send(': heartbeat\r\n\r\nevent: preview\r\ndata: {"stem":"A draft');
  await expect(alternative).not.toContainText('A draft');
  await send(' on friction","options":[{"key":"A","text":"First choice","explanation":""}]}\r\n\r\n');
  await expect(alternative.getByText('A draft on friction')).toBeInViewport();
  await expect(alternative).toContainText('First choice');
  await expect(page.getByRole('button', { name: 'Replace with variant' })).toHaveCount(0);
  await expect(modeButton(page, 'Read')).toBeDisabled();

  const open = (id: string) => page.locator(`[data-question-id="${id}"] .questions-row__open`).click();
  await open('q2');
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 2:');
  await expect(modeButton(page, 'Read')).toBeEnabled();
  await send('event: preview\ndata: {"stem":"The stream continued in the background"}\n\n');
  await open('q1');
  await expect(modeButton(page, 'Compare')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('mode=compare');
  await expect(alternative.getByText('The stream continued in the background')).toBeInViewport();

  await send('');
  await expect(alternative.getByRole('alert')).toContainText('Live generation was interrupted.');
  await expect(alternative).not.toContainText('The stream continued in the background');
  await alternative.getByRole('button', { name: 'Try again' }).click();
  await expect(status).toHaveText('Writing the alternative…');
  await send('event: preview\ndata: {"stem":"Second draft"}\n\n');
  await expect(alternative).toContainText('Second draft');
  await send('event: progress\ndata: {"stage":"reviewing"}\n\n');
  await expect(status).toHaveText('Checking the alternative…');
  await expect(alternative).toContainText('Second draft');
  await open('q2');
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 2:');
  const variant = { stem: 'Checked variant', difficulty: 'easy', options: [], sourceRefs: [], agentDecision: { decision: 'pass', reasoning: 'Checked', roleAssessment: 'OK' } };
  await send(`event: result\ndata: ${JSON.stringify({ variant })}\n\n`);
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 2:');
  await open('q1');
  await expect(alternative).toContainText('Checked variant');
  const footer = page.locator('.questions-reader__actions');
  await expect(footer.getByRole('button')).toHaveText(['Cancel', 'Replace with variant']);
  await expect(status).toBeHidden();
  await footer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modeButton(page, 'Read')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 1:');
  await expect(footer.getByRole('button')).toHaveText(['Reload', 'Reject', 'Approve']);
  expect(mock.patchCalls).toEqual([]);
  expect(mock.transitionCalls).toEqual([]);
});

test('Compare is offered only for questions in To review', async ({ page }) => {
  await setup(page, { tab: 'approved' });
  await expect(modeButton(page, 'Preview')).toBeVisible();
  await expect(modeButton(page, 'Compare')).toHaveCount(0);
});

test('a resumed comparison cannot replace a version saved while viewing another question', async ({ page }) => {
  const mock = await setup(page);
  await modeButton(page, 'Compare').click();
  await page.getByRole('button', { name: 'Generate alternative' }).click();
  const replace = page.getByRole('button', { name: 'Replace with variant' });
  await expect(replace).toBeEnabled();
  await page.locator('[data-question-id="q2"] .questions-row__open').click();
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 2:');

  const question = mock.questions[0];
  question.currentVersionId = 'v1-colleague';
  question.currentVersion = 2;
  question.current = { ...question.current, _id: 'v1-colleague', version: 2, stem: 'A colleague’s new version' };
  await page.locator('[data-question-id="q1"] .questions-row__open').click();
  await expect(modeButton(page, 'Compare')).toHaveAttribute('aria-pressed', 'true');
  await expect(replace).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('The saved version changed.');
  await page.locator('.questions-reader__actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.questions-reader__stem')).toContainText('A colleague’s new version');
  expect(mock.patchCalls).toEqual([]);
});

test('a question opened from Student Analytics shows its recorded version until dismissed', async ({ page }) => {
  await setup(page, { tab: 'approved', extraHash: '&q=q5&analyticsVersionId=v0' });
  const notice = page.getByRole('region', { name: 'Recorded analytics version' });
  await expect(notice).toContainText('Recorded analytics version 1');
  await expect(notice).toContainText('Historical content');
  await notice.getByText('What students saw in version 1').click();
  await expect(notice).toContainText('An older wording of the question.');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('analyticsVersionId=v0');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('analyticsVersionId');
});

test('390px dark Compare stacks the versions and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.locator('.questions-row__open').first().click();
  await modeButton(page, 'Compare').click();
  await page.getByRole('button', { name: 'Generate alternative' }).click();
  await expect(page.getByRole('article', { name: 'Generated alternative' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const results = await new AxeBuilder({ page }).include('.questions-reader').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('the recorded-version notice retries a transient error without touching an open edit, and says when a version is unknown', async ({ page }) => {
  await setup(page, { tab: 'approved', extraHash: '&q=q5&analyticsVersionId=v0', distributionFailures: 1 });
  const notice = page.getByRole('region', { name: 'Recorded analytics version' });
  await expect(notice).toContainText('Historical service interrupted');
  await modeButton(page, 'Edit').click();
  await page.getByLabel('Question stem').fill('Unsaved local edit');
  await notice.getByRole('button', { name: 'Try again' }).click();
  await expect(notice).toContainText('Recorded analytics version 1');
  await expect(page.getByLabel('Question stem')).toHaveValue('Unsaved local edit');
});

test('an unknown recorded version is reported without a retry', async ({ page }) => {
  await setup(page, { tab: 'approved', extraHash: '&q=q5&analyticsVersionId=nope' });
  const notice = page.getByRole('region', { name: 'Recorded analytics version' });
  await expect(notice).toContainText('The requested recorded version was not found.');
  await expect(notice.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('Parameters edits the tables, draws samples of the drafts, and an approved question returns to review on save', async ({ page }) => {
  const mock = await setup(page, { parameterized: true, tab: 'approved', extraHash: '&q=q5&mode=params' });
  await expect(modeButton(page, 'Parameters')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.questions-reader__context')).toHaveCount(0);
  const params = page.getByRole('region', { name: 'Parameters' });
  await expect(params.locator('.questions-params__chip')).toHaveText(['[F]']);
  await expect(params.getByLabel('Variable 1 name')).toHaveValue('F');
  await expect(params.locator('.questions-params__status').first()).toHaveText('in stem');

  await params.getByLabel('Variable 1 minimum').fill('4');
  await params.getByLabel('Computed value 2 formula').fill('F*3');
  await params.getByRole('button', { name: 'Draw five samples' }).click();
  await expect(params.locator('.questions-params__draw-list li')).toHaveCount(5);
  await expect(params.locator('.questions-params__draw-list li').first()).toHaveText('A force of 4 N acts on 2 kg. What is the acceleration?');
  expect(mock.previewCalls[0]).toEqual(expect.objectContaining({ paramSlots: [{ name: 'F', min: 4, max: 10, step: 2 }] }));

  // Leaving with unsaved parameters asks first.
  await modeButton(page, 'Read').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(modeButton(page, 'Parameters')).toHaveAttribute('aria-pressed', 'true');

  await expect(params).toContainText('Saving returns this question to To review');
  await params.getByRole('button', { name: 'Save parameters' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Parameters saved and verified. The question is back in To review.');
  expect(mock.patchCalls[0].body).toEqual({
    expectedVersionId: 'v5', submitForReview: true,
    paramSlots: [{ name: 'F', min: 4, max: 10, step: 2 }],
    derivedValues: [{ name: 'A', formula: 'F/2' }, { name: 'A_WRONG', formula: 'F*3', errorModel: 'multiplied instead of divided' }],
  });
  expect(mock.questions[4].state).toBe('pending-review');
});

test('a parameter save that fails verification says the question will not be served', async ({ page }) => {
  await setup(page, { parameterized: true, verificationError: 'Options B and A show the same value.' });
  await modeButton(page, 'Parameters').click();
  const params = page.getByRole('region', { name: 'Parameters' });
  await params.getByLabel('Computed value 1 formula').fill('F/4');
  await params.getByRole('button', { name: 'Save parameters' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Parameters saved, but they could not be verified');
  await expect(params.locator('.questions-params__verification')).toContainText('Not verified — this question will not be served to students. Options B and A show the same value.');
});

test('Parameters is offered only for a parameterized question', async ({ page }) => {
  await setup(page, { tab: 'review', extraHash: '&q=q1&mode=params' });
  await expect(page.locator('.questions-reader__stem')).toContainText('Question 1:');
  await expect(modeButton(page, 'Read')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeButton(page, 'Parameters')).toHaveCount(0);
});

test('the Review tab shows where the question came from', async ({ page }) => {
  await setup(page, { withUsage: true });
  await page.getByRole('tabpanel').getByText('Origin & family').click();
  await expect(page.getByRole('tabpanel')).toContainText('Generated · run r0 · item 1');
});

test('390px dark Parameters keeps its tables inside the pane and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { parameterized: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.locator('.questions-row__open').first().click();
  await modeButton(page, 'Parameters').click();
  await expect(page.getByRole('region', { name: 'Parameters' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const results = await new AxeBuilder({ page }).include('.questions-reader').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

// Moved from question-edit-concurrency.spec.ts (the Question details and
// Parameterization pages it drove are gone).
test('an edit that loses to a colleague keeps the draft, and the next decision pins the saved version', async ({ page }) => {
  const mock = await setup(page, { parameterized: true });
  await modeButton(page, 'Edit').click();
  const stem = page.getByLabel('Question stem');
  await stem.fill('My unsaved explanation of [F]');
  mock.failIds.add('q1');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.questions-reader__notice')).toContainText('Your edits were not saved');
  await expect(stem).toHaveValue('My unsaved explanation of [F]');
  expect(mock.patchCalls[0].body).toMatchObject({ expectedVersionId: 'v1', stem: 'My unsaved explanation of {{F}}' });

  mock.failIds.delete('q1');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Changes saved.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.locator('.questions-notice')).toContainText('Question approved.');
  expect(mock.transitionCalls).toEqual([{ id: 'q1', body: expect.objectContaining({ to: 'approved', expectedVersionId: 'v1-2' }) }]);
});

test('a parameter save that loses to a colleague keeps the values, and the next save pins the newer version', async ({ page }) => {
  const mock = await setup(page, { parameterized: true, tab: 'review', extraHash: '&q=q1&mode=params' });
  const params = page.getByRole('region', { name: 'Parameters' });
  await params.getByLabel('Variable 1 minimum').fill('3');
  mock.failIds.add('q1');
  await params.getByRole('button', { name: 'Save parameters' }).click();
  await expect(page.locator('.questions-reader__notice')).toContainText('Your parameter changes were not saved');
  await expect(params.getByLabel('Variable 1 minimum')).toHaveValue('3');
  expect(mock.patchCalls[0].body).toMatchObject({ expectedVersionId: 'v1', paramSlots: [{ name: 'F', min: 3, max: 10, step: 2 }] });

  mock.failIds.delete('q1');
  await params.getByRole('button', { name: 'Save parameters' }).click();
  await expect(page.locator('.questions-notice')).toContainText('Parameters saved and verified.');
  await page.getByRole('region', { name: 'Parameters' }).getByLabel('Variable 1 minimum').fill('4');
  await page.getByRole('region', { name: 'Parameters' }).getByRole('button', { name: 'Save parameters' }).click();
  await expect.poll(() => mock.patchCalls.length).toBe(3);
  expect(mock.patchCalls[2].body.expectedVersionId).toBe('v1-2');
});
