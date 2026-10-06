import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TUTORIAL_DEFINITIONS } from '../../client/src/tutorial-definitions';
const courseId = '507f1f77bcf86cd799439011', examId = '507f1f77bcf86cd799439022', loId = '507f1f77bcf86cd799439033', questionId = '507f1f77bcf86cd799439044', versionId = '507f1f77bcf86cd799439055';
const itemId = '5eae1bc4-b4ab-4414-a0cf-10085511515a';
const options = [{ key: 'A', text: 'True', role: 'common-misconception', explanation: 'Incorrect.' }, { key: 'B', text: 'False', role: 'correct', explanation: 'Market risk remains after diversification.' }];
const question = { id: questionId, loIds: [loId], themeIds: [loId], state: 'approved', labels: [], current: { _id: versionId, type: 'true-false', difficulty: 'easy', stem: 'Diversification removes all market risk.', options } };
const item = { id: itemId, source: 'bank', questionId, versionId, familyId: questionId, loIds: [loId], type: 'true-false', difficulty: 'easy', stem: question.current.stem, options, points: 1, minutes: 1, validated: true, practiceExposure: true, approval: { by: 'teacher', at: new Date().toISOString() } };
async function fixture(page: Page, role: 'instructor' | 'student' = 'instructor', dark = false) {
  const settings = { title: 'Fall midterm', kind: 'midterm', purpose: 'formal', durationMinutes: 60, opensAt: '2026-10-01T16:00:00.000Z', closesAt: '2026-10-01T18:00:00.000Z', timeZone: 'America/Vancouver', feedback: 'instructor', shuffle: false, accommodations: [] };
  const exam = { _id: examId, courseId, revision: 0, settings, items: [] as typeof item[], publishedRevision: undefined as number | undefined, publicationId: undefined as string | undefined, displayTitle: undefined as string | undefined };
  const candidates: Array<{ _id: string; item: typeof item }> = [];
  const runs: Array<{ _id: string; status: string; interpretation: string; conflicts: string[]; cells: Array<{ id: string; loId: string; type: string; difficulty: string }>; completed: string[]; failures: unknown[] }> = [];
  const calls: string[] = [], unhandled: string[] = [], errors: string[] = [];
  let submitted = false, answer: string | null = null, answerRevision = 0, deleted = false;
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
      if (path.endsWith('/answer')) { answer = body.selectedKey; answerRevision++; return route.fulfill({ json: { answerRevision } }); }
      if (path.endsWith('/submit')) { submitted = true; return route.fulfill({ json: { submitted: true } }); }
      if (path.endsWith('/results')) return route.fulfill({ json: { title: settings.title, released: false, message: 'Your Instructor will release the results.' } });
      return route.fulfill({ json: { id: examId, title: settings.title, submitted, deadline: new Date(Date.now() + 3600000).toISOString(), serverTime: new Date().toISOString(), answerRevision, questions: [{ id: itemId, stem: item.stem, type: item.type, points: 1, selectedKey: answer, options: options.map(({ key, text }) => ({ key, text })) }] } });
    }
    unhandled.push(path); return route.fulfill({ status: 404, json: { error: `Missing fixture ${path}` } });
  });
  await page.goto(role === 'instructor' ? `/#/instructor/course/${courseId}/exam-builder/${examId}` : `/#/course/${courseId}/assessment/${examId}`);
  await expect(page.getByRole('heading', { name: 'Fall midterm', exact: true }).first()).toBeVisible();
  return { calls, exam, candidates, runs, assertClean: () => { expect(unhandled).toEqual([]); expect(errors).toEqual([]); } };
}
test('Instructor selects pinned bank questions, generates private candidates, reviews and publishes', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await expect(page.locator('.eb-paper-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Generate new', exact: true }).click();
  await page.getByLabel('Explain diversification').check();
  await page.getByRole('button', { name: 'Preview generation plan' }).click();
  await expect(page.getByRole('dialog')).toContainText('Use the selected objective');
  await page.getByRole('button', { name: 'Generate candidates', exact: true }).click();
  await page.getByRole('button', { name: '+ Add to paper' }).click();
  await page.getByRole('button', { name: '3 Publish' }).click();
  await expect(page.getByRole('button', { name: 'Review & publish' })).toBeDisabled();
  await page.getByRole('button', { name: '2 Review paper' }).click();
  await page.getByRole('button', { name: 'Approve question', exact: true }).click();
  await page.getByRole('button', { name: 'Student preview', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.correct')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '3 Publish' }).click();
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await page.getByRole('button', { name: 'Publish exam', exact: true }).click();
  await expect(page.getByText('Published revision', { exact: true })).toBeVisible();
  expect(state.calls.some(call => /\/generation-plan|\/questions\/.*\/transition/.test(call))).toBe(false);
  state.assertClean();
});
test('Student saves, reloads and submits without receiving correctness before release', async ({ page }) => {
  const state = await fixture(page, 'student');
  await page.getByRole('radio', { name: 'Option B' }).check();
  await expect(page.getByText('Answer saved.', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('radio', { name: 'Option B' })).toBeChecked();
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


test('live progress and candidates update while editing the prompt without resetting it', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Generate new', exact: true }).click();
  const prompt = page.locator('#eb-prompt'); await prompt.fill('Keep these instructions'); await prompt.focus();
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
  await expect(prompt).toBeFocused(); await expect(prompt).toHaveValue('Keep these instructions');
  await page.evaluate(() => window.dispatchEvent(new Event('exam-test-disconnect')));
  await expect(page.getByText('Reconnecting to live updates… Saved work is preserved.')).toBeVisible();
  await emit('completed', true);
  await expect(page.getByRole('button', { name: '+ Add to paper' })).toBeVisible();
  await expect(page.locator('.eb-live-preview')).toHaveCount(0);
  await expect(prompt).toHaveValue('Keep these instructions');
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
