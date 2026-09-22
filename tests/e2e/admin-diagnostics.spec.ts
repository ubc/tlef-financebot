import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ObjectId } from 'mongodb';
import { connectMongo, closeMongo } from '../../server/src/components/mongodb';
import { coursesCol, questionsCol, questionVersionsCol, attemptsCol, contentRunsCol, flagsCol } from '../../server/src/components/mongodb/collections';

const courseId = new ObjectId(), questionId = new ObjectId(), oldId = new ObjectId(), currentId = new ObjectId(), attemptId = new ObjectId(), runId = new ObjectId();
const creator = `AUDIT-QA-${courseId}`;
async function login(page: Page, user: string) {
  await page.route('**/api/tutorials**', route => route.fulfill({ json: [] }));
  await page.goto('/auth/ubcshib');
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(user);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL('http://localhost:6118/**');
}
test.beforeAll(async () => {
  await connectMongo();
  const now = new Date();
  await coursesCol().insertOne({ _id: courseId, name: 'Audit QA course', courseCode: 'AUDIT-QA', term: '2026W1', ownerPuid: creator,
    registrationCode: `AUDIT-${courseId}`, published: false, feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: now });
  await questionsCol().insertOne({ _id: questionId, courseId, state: 'draft', currentVersionId: currentId, currentVersion: 2, loIds: [], themeIds: [], labels: [], internalNotes: [], createdAt: now, updatedAt: now });
  const common = { questionId, type: 'mcq' as const, difficulty: 'easy' as const, sourceRefs: [], options: [
    { key: 'A', text: '{{x}} units', role: 'correct' as const, explanation: 'Use the recorded value.' },
    { key: 'B', text: 'None', role: 'clearly-wrong' as const, explanation: 'A value is given.' }], paramSlots: [{ name: 'x', values: [10, 20, 30] }], createdAt: now };
  await questionVersionsCol().insertMany([
    { _id: oldId, ...common, version: 1, stem: 'Original audit value {{x}}', createdBy: creator, provenance: { kind: 'generated', runId, item: 1 } },
    { _id: currentId, ...common, version: 2, stem: 'Edited audit value {{x}}', createdBy: 'another-editor', provenance: { kind: 'edited', parentVersionId: oldId } },
  ]);
  await attemptsCol().insertOne({ _id: attemptId, courseId, questionId, questionVersionId: oldId, puid: creator, loId: new ObjectId(), themeId: new ObjectId(),
    mode: 'topic-practice', strategy: 'a', selectedKey: 'B', correct: false, selectedRole: 'clearly-wrong', difficulty: 'easy', paramValues: { x: 777 }, isRetry: false, createdAt: now });
  await contentRunsCol().insertOne({ _id: runId, courseId, requestedBy: creator, kind: 'question-generation', status: 'partial', stage: 'reviewing', revision: 1,
    completedUnits: 1, totalUnits: 2, warnings: [], events: [{ revision: 1, at: now, type: 'stage', stage: 'reviewing', status: 'partial', completedUnits: 1, message: 'Second item failed review' }],
    input: { loId: new ObjectId(), count: 2, type: 'mcq', models: { generator: 'test', validator: 'test', reviewer: 'test', embedding: 'test' } },
    result: { createdQuestionIds: [questionId], failures: [{ item: 2, stage: 'reviewing', code: 'test-failure', message: 'provider token=NEVER-EXPOSE' }] }, createdAt: now, updatedAt: now });
});
test.afterAll(async () => {
  await Promise.all([
    attemptsCol().deleteMany({ courseId }), questionVersionsCol().deleteMany({ questionId }), questionsCol().deleteMany({ courseId }),
    contentRunsCol().deleteMany({ courseId }), flagsCol().deleteMany({ courseId }), coursesCol().deleteOne({ _id: courseId }),
  ]);
  await closeMongo();
});

test('real user failure is recorded and only Admin can inspect it', async ({ browser, page }) => {
  const teacher = await browser.newContext();
  const teacherPage = await teacher.newPage();
  await login(teacherPage, 'faculty');
  const teacherIdentity = await (await teacher.request.get('/api/auth/me')).json();
  await teacherPage.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'AUDIT-QA browser runtime failure' })));
  const denied = await teacher.request.get('/api/admin/all-questions');
  expect(denied.status()).toBe(403);
  const id = denied.headers()['x-request-id'];
  expect(id).toBeTruthy();
  await login(page, 'admin');
  await expect.poll(async () => (await page.request.get(`/api/admin/operations/${id}`)).status()).toBe(200);
  await expect.poll(async () => {
    const reports = await (await page.request.get(`/api/admin/operations?actor=${teacherIdentity.user.puid}&q=AUDIT-QA%20browser%20runtime`)).json();
    return reports.items.some((item: { method: string }) => item.method === 'CLIENT');
  }).toBe(true);
  const evidence = await (await page.request.get(`/api/admin/operations/${id}`)).json();
  expect(evidence.operation).toMatchObject({ statusCode: 403, outcome: 'failed', actor: { puid: teacherIdentity.user.puid, uid: teacherIdentity.user.uid } });
  await page.goto(`/#/admin/operations/requests/${id}`);
  await expect(page.getByRole('heading', { name: 'Operation details' })).toBeVisible();
  await expect(page.getByText('Admin access required.', { exact: true })).toBeVisible();
  await expect(page.getByText(`Request ID: ${id}`, { exact: true })).toBeVisible();
  await teacher.close();
});

test('Admin finds original creators, sees failed tasks, and replays pinned evidence without writes', async ({ page }) => {
  await login(page, 'admin');
  await page.goto(`/#/admin/questions?actor=${creator}`);
  const questionRow = page.getByRole('button', { name: `Inspect question ${questionId}`, exact: true });
  await expect(questionRow).toBeVisible();
  await expect(questionRow).toHaveText('Edited audit value {{x}}');
  await expect(page.getByRole('row').filter({ has: questionRow })).toContainText(creator);
  await expect(page.getByText('AUDIT-QA · Audit QA course', { exact: true })).toBeVisible();
  const wrongCreator = await (await page.request.get('/api/admin/all-questions?actor=another-editor&courseId=' + courseId)).json();
  expect(wrongCreator.total).toBe(0);
  await questionRow.click();
  await expect(page.getByRole('heading', { name: 'Version 2 · Seed 1', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Flags & attempts', exact: true }).click();
  await page.getByRole('button', { name: 'Replay this attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recorded attempt replay' })).toBeVisible();
  await expect(page.getByText('Original audit value 777', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`actor=${creator}.*attemptId=${attemptId}`));
  await expect(page.getByRole('combobox', { name: 'Question version', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByText('Original audit value 777', { exact: true })).toBeVisible();
  expect(await attemptsCol().countDocuments({ courseId })).toBe(1);
  expect(await questionVersionsCol().countDocuments({ questionId })).toBe(2);
  const run = await (await page.request.get(`/api/admin/diagnostic-runs/${runId}`)).json();
  expect(JSON.stringify(run)).not.toContain('NEVER-EXPOSE');
  await page.goto(`/#/admin/operations?tab=runs&actor=${creator}`);
  const taskRow = page.locator(`.ac-operation-table tr[data-record="${runId}"]`);
  await expect(taskRow).toContainText('partial');
  await taskRow.getByRole('button', { name: 'Inspect question generation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Background task details' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Evidence sections' }).getByRole('button', { name: 'Results', exact: true }).click();
  await page.getByRole('link', { name: `Inspect ${questionId}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Question diagnostics' })).toBeVisible();
});

test('diagnostic pages support narrow layouts, light/dark themes and keyboard labels', async ({ page }) => {
  await login(page, 'admin');
  for (const mode of [{ width: 1280, height: 900, theme: 'light' }, { width: 390, height: 844, theme: 'dark' }]) {
    await page.setViewportSize(mode);
    if (await page.locator('html').getAttribute('data-theme') !== mode.theme) await page.getByRole('button', { name: 'Toggle light or dark theme' }).click();
    for (const path of ['/admin/operations', `/admin/questions?actor=${creator}`, `/admin/questions/${questionId}`, `/admin/operations/runs/${runId}`]) {
      await page.goto('/#' + path);
      await expect(page.locator('.diagnostic-view')).toBeVisible();
      await expect(page.locator('.diagnostic-view .spinner')).toHaveCount(0);
      await expect(page.locator('.diagnostic-view .state--error')).toHaveCount(0);
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
      expect((await new AxeBuilder({ page }).include('.diagnostic-view').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.screenshot({ path: `audit-results/admin-diagnostics-${mode.theme}.png`, fullPage: true });
  }
});
