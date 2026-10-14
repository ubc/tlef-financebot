import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TUTORIAL_DEFINITIONS } from '../../client/src/tutorial-definitions';
const courseId = '507f1f77bcf86cd799439011', examId = '507f1f77bcf86cd799439022', loId = '507f1f77bcf86cd799439033', questionId = '507f1f77bcf86cd799439044', versionId = '507f1f77bcf86cd799439055';
const itemId = '5eae1bc4-b4ab-4414-a0cf-10085511515a';
const options = [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Incorrect.' }, { key: 'B', text: 'False', role: 'correct', explanation: 'Market risk remains after diversification.' }];
const question = { id: questionId, loIds: [loId], themeIds: [loId], state: 'approved', contentReady: true, labels: [], current: { _id: versionId, type: 'true-false', difficulty: 'easy', stem: 'Diversification removes all market risk.', options } };
const item = { id: itemId, source: 'bank', questionId, versionId, familyId: questionId, loIds: [loId], type: 'true-false', difficulty: 'easy', stem: question.current.stem, options, points: 1, minutes: 1, validated: true, practiceExposure: true, approval: { by: 'teacher', at: new Date().toISOString() } };
async function fixture(page: Page, role: 'instructor' | 'student' = 'instructor', dark = false) {
  const settings = { title: 'Fall midterm', kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: '2026-10-01T16:00:00.000Z', closesAt: '2026-10-01T18:00:00.000Z', timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] };
  const exam = { _id: examId, courseId, revision: 0, settings, items: [] as typeof item[], publishedRevision: undefined as number | undefined, publicationId: undefined as string | undefined, displayTitle: undefined as string | undefined };
  const candidates: Array<{ _id: string; item: typeof item }> = [];
  const runs: Array<{ _id: string; status: string; interpretation: string; conflicts: string[]; cells: Array<{ id: string; loId: string; type: string; difficulty: string }>; completed: string[]; failures: unknown[] }> = [];
  const calls: string[] = [], unhandled: string[] = [], errors: string[] = [];
  const creations: Array<{ title: string; purpose: 'formal' | 'practice' }> = [];
  let submitted = false, answer: string | null = null, answerRevision = 0, deleted = false, windowId = '';
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let streams = 0;
    Object.defineProperty(window, 'examTestStreams', { get: () => streams });
    class ExamEventSource extends EventTarget {
      private ended = false;
      private disconnected = () => this.dispatchEvent(new Event('error'));
      private listener = (event: Event) => this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify((event as CustomEvent).detail) }));
      constructor(public url: string) { super(); streams++; window.addEventListener('exam-test-snapshot', this.listener); window.addEventListener('exam-test-disconnect', this.disconnected); }
      close() { if (this.ended) return; this.ended = true; streams--; window.removeEventListener('exam-test-snapshot', this.listener); window.removeEventListener('exam-test-disconnect', this.disconnected); }
    }
    Object.defineProperty(window, 'EventSource', { value: ExamEventSource });
  });
  await page.addInitScript(({ dark }) => { localStorage.setItem('tlef-theme', dark ? 'dark' : 'light'); }, { dark });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method(); calls.push(`${method} ${path}`);
    const body = method === 'GET' ? {} : route.request().postDataJSON() ?? {};
    if (path === '/api/auth/me') return route.fulfill({ json: { authenticated: true, user: { puid: role, uid: role, displayName: role, isAdmin: false, platformInstructor: role === 'instructor', affiliations: [role === 'student' ? 'student' : 'faculty'], courseRoles: [{ courseId, role }] } } });
    if (path === '/api/tutorials') return route.fulfill({ json: TUTORIAL_DEFINITIONS.map(d => ({ id: d.id, role: d.role, version: d.version, status: 'dismissed' })) });
    if (path === '/api/notifications') return route.fulfill({ json: [] });
    const course = { _id: courseId, name: 'Corporate Finance', courseCode: 'FIN 301', term: '2026W1', published: true, lifecycle: 'published', themes: [{ _id: loId, name: 'Risk', order: 0, los: [{ _id: loId, name: 'Explain diversification', order: 0 }] }] };
    if (path === '/api/courses') return route.fulfill({ json: [course] });
    if (path === '/api/enrollments') return route.fulfill({ json: [{ ...course, courseId, active: true }] });
    if (path === `/api/courses/${courseId}`) return route.fulfill({ json: course });
    if (path.endsWith('/outline')) return route.fulfill({ json: { course, themes: course.themes } });
    if (path.endsWith('/questions')) return route.fulfill({ json: { questions: [question], total: 1 } });
    if (path.endsWith('/exams')) return route.fulfill({ json: [] });
    if (path.endsWith('/capabilities/me')) return route.fulfill({ json: { 'question.review': true } });
    const catalog = `/api/courses/${courseId}/exam-builder`;
    const base = `${catalog}/${examId}`;
    if (path === `${catalog}/bank`) return route.fulfill({ json: { questions: [question], total: 1 } });
    if (path === `${base}/sample-bank`) {
      expect(body.topics).toEqual([{ topicId: loId, count: 1 }]);
      if ((body.mode === 'per-topic' ? body.topics.reduce((n: number, t: { count: number }) => n + t.count, 0) : body.count) > 1) return route.fulfill({ status: 400, json: { error: 'Not enough distinct eligible questions for this topic mix.' } });
      return route.fulfill({ json: { revision: exam.revision, questions: [{ questionId, versionId, topicId: loId, stem: question.current.stem, type: item.type, difficulty: item.difficulty, supportsNumbers: false }] } });
    }
    if (path === catalog && method === 'POST') {
      creations.push(body);
      settings.title = body.title; settings.purpose = body.purpose;
      settings.feedback = body.purpose === 'practice' ? 'immediate' : 'after-close';
      return route.fulfill({ json: exam });
    }
    if (path === catalog) return route.fulfill({ json: deleted ? [] : [exam] });
    if (path === `${base}/title`) { exam.displayTitle = body.title; exam.revision++; if (exam.publishedRevision === exam.revision - 1) exam.publishedRevision = exam.revision; return route.fulfill({ json: exam }); }
    if (path === base && method === 'DELETE') { deleted = true; return route.fulfill({ json: { deleted: true } }); }
    if (path === base) return route.fulfill({ json: { exam, candidates, runs } });
    if (path === `${base}/bank-items`) { expect(body.questions).toEqual([{ questionId, versionId }]); exam.items.push(structuredClone(item)); exam.revision++; return route.fulfill({ json: exam }); }
    if (path === `${base}/items`) { exam.items = body.items.map((row: { id: string; points: number; minutes: number }) => ({ ...exam.items.find(i => i.id === row.id), ...row })); exam.revision++; return route.fulfill({ json: exam }); }
    if (path === `${base}/settings`) { Object.assign(settings, body.settings); exam.revision++; return route.fulfill({ json: exam }); }
    if (path === `${base}/plans`) { const run = { _id: '507f1f77bcf86cd799439077', status: 'planned', interpretation: 'Use the selected objective and type.', conflicts: [], cells: [{ id: 'fe7beff0-6514-473b-ae01-1898b679b96f', loId, type: 'true-false', difficulty: 'easy' }], completed: [] as string[], failures: [] }; runs.push(run); return route.fulfill({ json: run }); }
    if (path.endsWith('/confirm')) { runs[0].status = 'completed'; runs[0].completed = [runs[0].cells[0].id]; candidates.push({ _id: '507f1f77bcf86cd799439088', item: { ...item, id: runs[0].cells[0].id, stem: 'Systematic market risk remains in a diversified portfolio.', options: [...options].reverse(), approval: undefined! } }); exam.revision++; return route.fulfill({ json: runs[0] }); }
    if (path.endsWith('/candidate-items')) { exam.items.push(candidates[0].item); exam.revision++; return route.fulfill({ json: exam }); }
    if (path.endsWith('/approve')) { exam.items.find(i => i.id === body.itemId)!.approval = item.approval; exam.revision++; return route.fulfill({ json: exam }); }
    if (path.endsWith('/publish')) { exam.revision++; exam.publishedRevision = exam.revision; exam.publicationId = '507f1f77bcf86cd799439099'; return route.fulfill({ json: exam }); }
    if (path.includes('/assessment-attempts/')) {
      if (path.endsWith('/window/close')) { submitted = true; return route.fulfill({ json: { submitted: true } }); }
      if (path.endsWith('/window') || path.endsWith('/window/heartbeat')) { windowId = body.windowId; return route.fulfill({ json: { submitted, serverTime: new Date().toISOString(), windowExpiresAt: new Date(Date.now() + 120000).toISOString() } }); }
      if (path.endsWith('/answer')) { answer = body.selectedKey; answerRevision++; return route.fulfill({ json: { answerRevision } }); }
      if (path.endsWith('/submit')) { submitted = true; return route.fulfill({ json: { submitted: true } }); }
      if (path.endsWith('/results')) return route.fulfill({ json: { title: settings.title, released: false, message: 'Your Instructor will release the results.' } });
      return route.fulfill({ json: { id: examId, title: settings.title, submitted, deadline: new Date(Date.now() + 3600000).toISOString(), serverTime: new Date().toISOString(), answerRevision, questions: [{ id: itemId, stem: item.stem, type: item.type, points: 1, selectedKey: answer, options: options.map(({ key, text }) => ({ key, text })) }] } });
    }
    unhandled.push(path); return route.fulfill({ status: 404, json: { error: `Missing fixture ${path}` } });
  });
  await page.goto(role === 'instructor' ? `/#/instructor/course/${courseId}/exam-builder/${examId}` : `/#/course/${courseId}/assessment/${examId}`);
  await expect(page.getByRole('heading', { name: 'Fall midterm', exact: true }).first()).toBeVisible();
  return { calls, exam, candidates, runs, creations, get windowId() { return windowId; }, assertClean: () => { expect(unhandled).toEqual([]); expect(errors).toEqual([]); } };
}

for (const purpose of ['formal', 'practice'] as const) {
  test(`Instructor chooses ${purpose} assessment purpose when creating a draft`, async ({ page }) => {
    const state = await fixture(page);
    await page.getByRole('link', { name: 'All exams' }).click();
    await expect(page.getByLabel('Assessment purpose')).toHaveValue('formal');
    await expect(page.getByLabel('Assessment purpose').getByRole('option', { name: 'Practice quiz', exact: true })).toHaveCount(1);
    await expect(page.getByLabel('Assessment purpose').getByRole('option', { name: 'Formal exam', exact: true })).toHaveCount(1);
    const title = purpose === 'practice' ? 'Risk practice quiz' : 'Formal risk midterm';
    await page.getByLabel('Exam title', { exact: true }).fill(title);
    await page.getByLabel('Assessment purpose').selectOption(purpose);
    await page.setViewportSize({ width: 390, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.exam-builder').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Create exam', exact: true }).click();
    await expect(page.locator('.eb-title')).toHaveText(title);
    expect(state.creations).toEqual([{ title, purpose }]);
    await page.getByRole('button', { name: '3 Publish', exact: true }).click();
    await expect(page.getByLabel('Assessment purpose')).toHaveValue(purpose);
    await expect(page.getByLabel('Score and answer release')).toHaveValue(purpose === 'practice' ? 'immediate' : 'after-close');
    await expect(page.locator('[data-feedback-note]')).toContainText(purpose === 'practice' ? 'immediately after submitting' : 'after the exam closes');
    state.assertClean();
  });
}

test('Instructor samples existing bank questions by topic, previews and publishes without generation', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByRole('button', { name: 'Generate new', exact: true })).toHaveCount(0);
  await expect(page.locator('.eb-topic-head h3')).toHaveText('Risk');
  await page.getByRole('button', { name: 'Sample by topic', exact: true }).click();
  await page.getByLabel('Risk', { exact: false }).check();
  await page.locator('#eb-mix-count').fill('1'); await page.locator('#eb-mix-count').press('Tab');
  await page.getByRole('button', { name: 'Preview random selection' }).click();
  await expect(page.getByRole('dialog')).toContainText(question.current.stem);
  await expect(page.locator('.eb-paper-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resample', exact: true }).click();
  await page.getByRole('button', { name: 'Add selection to paper' }).click();
  await expect(page.locator('.eb-paper-item')).toHaveCount(1);
  await expect(page.locator('.eb-paper')).toContainText('Topic coverage');
  await page.getByRole('button', { name: '2 Review paper' }).click();
  await expect(page.getByRole('button', { name: 'Approve question', exact: true })).toHaveCount(0);
  // Full isolated student sittings are covered by the assessment-preview suite.
  await expect(page.getByRole('button', { name: 'Student preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '3 Publish' }).click();
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await page.getByRole('button', { name: 'Publish exam', exact: true }).click();
  await expect(page.getByText('Published revision', { exact: true })).toBeVisible();
  expect(state.calls.some(call => /\/plans|\/confirm|\/generation/.test(call))).toBe(false);
  state.assertClean();
});
test('manual topic and optional LO selection preserve pinned versions', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Filter by topic').selectOption(loId);
  await page.locator('#eb-lo-filter').selectOption(loId);
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `Select question ${questionId}` })).toBeDisabled();
  await expect(page.locator('.eb-paper-item')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Added', exact: false })).toBeDisabled();
  state.assertClean();
});
test('topic quotas, shortage and failed adds preserve the paper for retry', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Sample by topic' }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Preview random selection' }).click();
  await expect(page.getByRole('alert')).toContainText('Not enough');
  await expect(page.locator('.eb-paper-item')).toHaveCount(0);
  await page.locator('#eb-mix-mode').selectOption('per-topic');
  await expect(page.getByLabel('Question count for Risk')).toHaveValue('1');
  await page.locator('#eb-mix-count').evaluate((node: HTMLInputElement) => node.value = '1');
  await page.getByRole('button', { name: 'Preview random selection' }).click();
  // Simulate a bank version changing after the preview.
  await page.route(`**/exam-builder/${examId}/bank-items`, route => route.fulfill({ status: 409, json: { error: 'Select the current approved version from Question Bank.' } }), { times: 1 });
  await page.getByRole('button', { name: 'Add selection to paper' }).click();
  await expect(page.getByRole('dialog')).toContainText('current approved version');
  await expect(page.locator('.eb-paper-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add selection to paper' }).click();
  await expect(page.locator('.eb-paper-item')).toHaveCount(1);
  state.assertClean();
});
test('Student saves, reloads saved answers and submits without receiving correctness before release', async ({ page }) => {
  const state = await fixture(page, 'student');
  await page.getByRole('radio', { name: 'Option B' }).check();
  await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reload saved answers', exact: true }).click(); await expect(page.getByRole('radio', { name: 'Option B' })).toBeChecked();
  expect(state.windowId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator('.correct')).toHaveCount(0);
  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
  await expect(page.getByText('Your Instructor will release the results.')).toBeVisible();
  await expect(page.getByText('Market risk remains after diversification.')).toHaveCount(0);
  state.assertClean();
});
test('Builder is usable on narrow screens and passes scoped light/dark accessibility', async ({ page }) => {
  const state = await fixture(page);
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => document.documentElement.dataset.theme = mode, mode);
    await page.setViewportSize({ width: mode === 'dark' ? 390 : 1280, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const scan = await new AxeBuilder({ page }).include('.exam-builder').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({ path: `audit-results/exam-builder/${mode}.png`, fullPage: true });
  }
  state.assertClean();
});


test('historical active generation updates without resetting topic controls', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Sample by topic', exact: true }).click();
  const prompt = page.locator('#eb-mix-count'); await prompt.fill('7'); await prompt.focus();
  const emit = async (status: string, saved: boolean) => page.evaluate(({ exam, status, saved, item, loId }) => {
    window.dispatchEvent(new CustomEvent('exam-test-snapshot', { detail: {
      exam, candidates: saved ? [{ _id: 'candidate-live', item }] : [],
      runs: [{ _id: 'run-live', status, interpretation: '', cells: [{ id: item.id, loId, type: 'true-false', difficulty: 'easy' }], completed: saved ? [item.id] : [], failures: [],
        progress: { item: 1, stage: 'generating', preview: { stem: 'Live streamed question', options: [{ key: 'A', text: 'Live option' }] } } }],
    } }));
  }, { exam: state.exam, status, saved, item, loId });
  await emit('running', false);
  await expect(page.getByText('Live streamed question', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 1 of 1 · Writing question')).toBeVisible();
  await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('7');
  await page.evaluate(() => window.dispatchEvent(new Event('exam-test-disconnect')));
  await expect(page.getByText('Reconnecting to live updates… Saved work is preserved.')).toBeVisible();
  await emit('completed', true);
  await page.getByRole('button', { name: 'Saved candidates', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ Add to paper' })).toBeVisible();
  await expect(page.locator('.eb-live-preview')).toHaveCount(0);
  expect(state.calls.filter(call => call.endsWith(`/exam-builder/${examId}`))).toHaveLength(1);
  await expect(page.getByText('Live updates connected')).toBeVisible();
  await page.locator('.exam-builder').evaluate(root => root.remove());
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'examTestStreams'))).toBe(0);
  state.assertClean();
});


test('catalog renames an exam and requires the exact title before permanent deletion', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('link', { name: 'All exams' }).click();
  await expect(page.locator('.eb-catalog').getByRole('heading', { name: 'Fall midterm', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rename Fall midterm' }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.getByRole('dialog').getByRole('textbox', { name: 'New exam title' }).fill('New midterm title');
  await page.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
  await expect(page.locator('.eb-catalog').getByRole('heading', { name: 'New midterm title' })).toBeVisible();
  await page.getByRole('link', { name: 'Open exam' }).click();
  await expect(page.locator('.eb-title')).toHaveText('New midterm title');
  await page.getByRole('link', { name: 'All exams' }).click();
  await page.getByRole('button', { name: 'Delete New midterm title' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Type the exam title to confirm' }).fill('wrong');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete exam' }).click();
  await expect(page.getByRole('dialog')).toContainText('Enter the exact exam title');
  expect(state.calls.filter(call => call.startsWith('DELETE '))).toHaveLength(0);
  await page.getByRole('dialog').getByRole('textbox', { name: 'Type the exam title to confirm' }).fill('New midterm title');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete exam' }).click();
  await expect(page.getByText('No exams yet. Create a draft')).toBeVisible();
  expect(state.calls).toContain(`PUT /api/courses/${courseId}/exam-builder/${examId}/title`);
  expect(state.calls).toContain(`DELETE /api/courses/${courseId}/exam-builder/${examId}`);
  state.assertClean();
});

test('large topic bank paginates, preserves selection and shows verification blocks before adding', async ({ page }) => {
  const state = await fixture(page);
  const rows = Array.from({ length: 32 }, (_, i) => ({ ...question, id: i.toString(16).padStart(24, '0'), current: { ...question.current, stem: `Bank question ${i + 1}: ${question.current.stem}` } }));
  rows[0] = { ...rows[0], contentReady: false, blockedReason: 'Approved content still needs a current numerical proof.' } as typeof rows[number];
  await page.route(`**/exam-builder/bank`, route => route.fulfill({ json: { total: rows.length, questions: rows } }));
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.locator('.eb-bank-row')).toHaveCount(15);
  await expect(page.getByText('Needs verification', { exact: true })).toBeVisible();
  await expect(page.locator('.eb-bank-row').first().getByRole('button', { name: '+ Add', exact: true })).toBeDisabled();
  await expect(page.locator('.eb-bank-row').first().getByRole('link', { name: 'Open question details' })).toHaveAttribute('href', `#/instructor/course/${courseId}/bank/${rows[0].id}`);
  await page.getByRole('checkbox', { name: `Select question ${rows[1].id}` }).check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: `Select question ${rows[16].id}` }).check();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `Select question ${rows[1].id}` })).toBeChecked();
  await page.getByLabel('Search questions').fill('Bank question 32:');
  await expect(page.locator('.eb-bank-row')).toHaveCount(1);
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
  state.assertClean();
});

test('number changes use the pinned bank endpoint and never request AI generation', async ({ page }) => {
  const state = await fixture(page);
  const numeric = { ...question, current: { ...question.current, paramSlots: [{ name: 'X', min: 1, max: 10, step: 1 }] } };
  await page.route('**/exam-builder/bank', route => route.fulfill({ json: { total: 1, questions: [numeric] } }));
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.route(`**/exam-builder/${examId}/bank-items`, async route => {
    expect(route.request().postDataJSON().questions).toEqual([{ questionId, versionId, mode: 'parameters' }]);
    state.exam.items.push(structuredClone(item)); state.exam.revision++;
    await route.fulfill({ json: state.exam });
  });
  await page.getByRole('button', { name: 'Change numbers', exact: true }).click();
  await expect(page.locator('.eb-paper-item')).toHaveCount(1);
  expect(state.calls.some(call => /\/plans|\/confirm|\/generation/.test(call))).toBe(false);
  state.assertClean();
});

test('sampling form supports several topics and per-topic quotas on desktop and mobile', async ({ page }) => {
  const state = await fixture(page);
  const topics = ['1. Time value of money', '2. Risk and return', '3. Capital budgeting'].map((name, i) => ({ _id: (100 + i).toString(16).padStart(24, '0'), name, order: i, los: [{ _id: (200 + i).toString(16).padStart(24, '0'), name: 'Apply the topic concepts', order: 0 }] }));
  await page.route('**/outline', route => route.fulfill({ json: { course: { _id: courseId }, themes: topics } }));
  await page.route('**/exam-builder/bank', route => route.fulfill({ json: { questions: topics.flatMap(t => Array.from({ length: 6 }, (_, i) => ({ ...question, id: `${t._id}${i}`, themeIds: [t._id], loIds: [t.los[0]._id] }))), total: 18 } }));
  await page.reload();
  await page.getByRole('button', { name: 'Sample by topic' }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.getByText('10 questions requested from 3 topics.', { exact: false })).toBeVisible();
  for (const [mode, width] of [['light', 1440], ['dark', 390]] as const) {
    await page.evaluate(mode => document.documentElement.dataset.theme = mode, mode);
    await page.setViewportSize({ width, height: 950 });
    if (mode === 'dark') await page.locator('#eb-mix-mode').selectOption('per-topic');
    const scan = await new AxeBuilder({ page }).include('.exam-builder').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(scan.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.eb-source .eb-addbar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `audit-results/exam-builder/sampling-${mode}.png`, fullPage: true });
  }
  state.assertClean();
});

test('instructor selects specific questions in bulk, samples the remainder and publishes without another approval', async ({ page }) => {
  const state = await fixture(page);
  const rows = Array.from({ length: 3 }, (_, i) => ({ ...question, id: (400 + i).toString(16).padStart(24, '0'), current: { ...question.current, _id: (500 + i).toString(16).padStart(24, '0'), stem: `Selected bank question ${i + 1}` } }));
  await page.route('**/exam-builder/bank', route => route.fulfill({ json: { questions: rows, total: rows.length } }));
  await page.route(`**/exam-builder/${examId}/bank-items`, async route => {
    const refs = route.request().postDataJSON().questions as Array<{ questionId: string; versionId: string }>;
    for (const ref of refs) {
      const q = rows.find(q => q.id === ref.questionId)!;
      expect(ref.versionId).toBe(q.current._id);
      expect(state.exam.items.some(i => i.questionId === ref.questionId)).toBe(false);
      state.exam.items.push({ ...item, id: `${String(rows.indexOf(q) + 1).padStart(8, '0')}-0000-4000-8000-000000000000`, questionId: ref.questionId, versionId: ref.versionId, familyId: ref.questionId, stem: q.current.stem });
    }
    state.exam.revision++; await route.fulfill({ json: state.exam });
  });
  await page.route(`**/exam-builder/${examId}/sample-bank`, async route => {
    const body = route.request().postDataJSON(); expect(body.count).toBe(1); expect(body.revision).toBe(state.exam.revision);
    const remaining = rows.filter(q => !state.exam.items.some(i => i.questionId === q.id));
    expect(remaining).toHaveLength(1);
    const q = remaining[0];
    await route.fulfill({ json: { revision: state.exam.revision, questions: [{ questionId: q.id, versionId: q.current._id, topicId: loId, stem: q.current.stem, type: q.current.type, difficulty: q.current.difficulty, supportsNumbers: false }] } });
  });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.getByRole('checkbox', { name: `Select question ${rows[0].id}` }).check();
  await page.getByRole('checkbox', { name: `Select question ${rows[1].id}` }).check();
  await page.getByRole('button', { name: 'Add selected', exact: true }).click();
  await expect(page.locator('.eb-paper-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Sample by topic', exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.locator('#eb-mix-count').fill('1'); await page.locator('#eb-mix-count').press('Tab');
  await page.getByRole('button', { name: 'Preview random selection' }).click();
  await expect(page.getByRole('dialog')).toContainText(rows[2].current.stem);
  await page.getByRole('button', { name: 'Add selection to paper' }).click();
  await expect(page.locator('.eb-paper-item')).toHaveCount(3);
  await page.getByRole('button', { name: '2 Review paper' }).click();
  await expect(page.getByRole('button', { name: 'Approved ✓', exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Approve question', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'audit-results/exam-builder/bank-no-reapproval.png', fullPage: true });
  await page.getByRole('button', { name: '3 Publish' }).click();
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await page.getByRole('button', { name: 'Publish exam', exact: true }).click();
  await expect(page.getByText('Published revision', { exact: true })).toBeVisible();
  expect(state.calls.some(call => /\/approve$|\/plans|\/confirm/.test(call))).toBe(false);
  state.assertClean();
});

test('a historical unapproved candidate still requires approval before publication', async ({ page }) => {
  const state = await fixture(page);
  state.candidates.push({ _id: '507f1f77bcf86cd799439088', item: { ...item, source: 'generated', approval: undefined! } });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.getByRole('button', { name: 'Saved candidates', exact: true }).click();
  await page.getByRole('button', { name: '+ Add to paper' }).click();
  await page.getByRole('button', { name: '3 Publish' }).click();
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeDisabled();
  await page.getByRole('button', { name: '2 Review paper' }).click();
  await page.getByRole('button', { name: 'Approve question', exact: true }).click();
  await page.getByRole('button', { name: '3 Publish' }).click();
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeEnabled();
  expect(state.calls.filter(call => call.endsWith('/approve'))).toHaveLength(1);
  state.assertClean();
});
