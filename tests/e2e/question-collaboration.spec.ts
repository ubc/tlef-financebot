import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ObjectId } from 'mongodb';
import { connectMongo, closeMongo } from '../../server/src/components/mongodb';
import { coursesCol, courseInstructorSharesCol, questionDraftsCol, questionPresenceCol, questionsCol, questionVersionsCol, usersCol, themesCol, losCol, attemptsCol } from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
let questionId: ObjectId;
const contexts: BrowserContext[] = [];

async function login(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: 'http://localhost:6118', reducedMotion: 'reduce' });
  contexts.push(context);
  const page = await context.newPage();
  // Tutorials are unrelated to collaboration; no persisted completion changes.
  await page.route('**/api/tutorials/**', route => route.fulfill({ json: { entries: [], states: [], tutorials: [] } }));
  await page.goto('/auth/ubcshib');
  await page.locator('input[name="username"]').fill(name);
  await page.locator('input[name="password"]').fill(name);
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('http://localhost:6118/**');
  expect((await (await page.request.get('/api/auth/me')).json()).authenticated).toBe(true);
  return page;
}

test.afterAll(async () => {
  await Promise.all(contexts.map(context => context.close()));
  await connectMongo();
  await Promise.all([
    questionDraftsCol().deleteMany({ courseId }), questionPresenceCol().deleteMany({ courseId }),
    courseInstructorSharesCol().deleteMany({ courseId }), questionsCol().deleteMany({ courseId }),
    ...(questionId ? [questionVersionsCol().deleteMany({ questionId })] : []),
    coursesCol().deleteOne({ _id: courseId }), themesCol().deleteMany({ courseId }), losCol().deleteMany({ courseId }),
    usersCol().updateMany({ 'courseRoles.courseId': courseId }, { $pull: { courseRoles: { courseId } } }),
  ]);
  await closeMongo();
});

test('real co-instructors merge concurrent/offline edits, save a reviewed version, recover a conflict and lose revoked access', async ({ browser }) => {
  const owner = await login(browser, 'faculty');
  const colleague = await login(browser, 'ta');
  const errors: string[] = [];
  owner.on('pageerror', error => errors.push(error.message));
  colleague.on('pageerror', error => errors.push(error.message));
  const ownerSession = await (await owner.request.get('/api/auth/me')).json();
  const colleagueSession = await (await colleague.request.get('/api/auth/me')).json();
  await connectMongo();
  await coursesCol().insertOne({ _id: courseId, name: 'Co-authoring verification', courseCode: 'SHARE-TEST', term: '2026W1',
    ownerPuid: ownerSession.user.puid, registrationCode: `SH${courseId.toHexString()}`, published: false, lifecycle: 'draft',
    feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date() });
  await usersCol().updateOne({ puid: ownerSession.user.puid }, { $addToSet: { courseRoles: { courseId, role: 'instructor' } } });
  // A lower role is intentionally present: invitation must give the effective
  // Instructor capability regardless of stored role array order.
  await usersCol().updateOne({ puid: colleagueSession.user.puid }, { $addToSet: { courseRoles: { courseId, role: 'student' } } });
  await themesCol().insertOne({ _id: themeId, courseId, name: 'Risk', order: 1 });
  await losCol().insertOne({ _id: loId, courseId, themeId, name: 'Explain diversification', order: 1 });
  const created = await createQuestion({ courseId, themeIds: [themeId], loIds: [loId], type: 'true-false', difficulty: 'easy',
    stem: 'Diversification reduces firm-specific risk.', createdBy: ownerSession.user.puid,
    options: [{ key: 'T', text: 'True', role: 'correct', explanation: 'Firm-specific shocks can offset.' },
      { key: 'F', text: 'False', role: 'common-misconception', explanation: 'Market risk remains.' }] });
  questionId = created.questionId;
  await questionsCol().updateOne({ _id: questionId }, { $set: { state: 'approved' } });
  const api = `/api/courses/${courseId}`;
  expect((await colleague.request.get(`${api}/instructors`)).status()).toBe(403);
  const invited = await owner.request.post(`${api}/instructor-invitations`, { data: { identifier: 'ta' } });
  expect(invited.status(), await invited.text()).toBe(200);
  expect((await invited.json()).members.some((member: { puid: string }) => member.puid === colleagueSession.user.puid)).toBe(true);
  expect((await colleague.request.get(`${api}/instructors`)).status()).toBe(200);
  expect((await colleague.request.post(`${api}/instructor-invitations`, { data: { identifier: 'staff' } })).status()).toBe(403);
  const shared = `/#/instructor/course/${courseId}/bank/${questionId}/collaborate`;
  await Promise.all([owner.goto(shared), colleague.goto(shared)]);
  const first = owner.getByLabel('Question stem', { exact: true });
  const second = colleague.getByLabel('Question stem', { exact: true });
  await expect(first).toHaveValue('Diversification reduces firm-specific risk.');
  await expect(second).toHaveValue('Diversification reduces firm-specific risk.');
  // The product walkthrough intentionally traps focus; dismiss it because this
  // test exercises collaboration rather than tutorial progression.
  for (const page of [owner, colleague]) {
    const tutorial = page.locator('.tutorial-layer');
    await tutorial.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined);
    if (await tutorial.isVisible()) await page.keyboard.press('Escape');
  }
  await expect(owner.getByRole('status').filter({ hasText: 'All changes saved to shared draft' })).toBeVisible();
  await Promise.all([owner.context().setOffline(true), colleague.context().setOffline(true)]);
  await first.fill('Diversification reduces firm-specific risk. Alpha');
  await second.fill('Diversification reduces firm-specific risk. Beta');
  await expect(owner.locator('.collaborative-editor__notice')).toContainText('unsynced text remains');
  await expect(colleague.locator('.collaborative-editor__notice')).toContainText('unsynced text remains');
  await Promise.all([owner.context().setOffline(false), colleague.context().setOffline(false)]);
  await expect.poll(async () => first.inputValue()).toContain('Alpha');
  await expect.poll(async () => first.inputValue(), { timeout: 20000 }).toContain('Beta');
  await expect.poll(async () => second.inputValue()).toBe(await first.inputValue());
  expect((await first.inputValue()).match(/Alpha/g)).toHaveLength(1);
  expect((await first.inputValue()).match(/Beta/g)).toHaveLength(1);
  const ownerExplanation = owner.getByLabel('Option T explanation', { exact: true });
  const colleagueExplanation = colleague.getByLabel('Option F explanation', { exact: true });
  await ownerExplanation.fill('Co-authored correct explanation.');
  await expect(ownerExplanation).toHaveValue('Co-authored correct explanation.');
  await colleagueExplanation.fill('Co-authored misconception explanation.');
  await expect(colleagueExplanation).toHaveValue('Co-authored misconception explanation.');
  await expect(owner.getByLabel('Option F explanation', { exact: true })).toHaveValue('Co-authored misconception explanation.');
  await expect(colleague.getByLabel('Option T explanation', { exact: true })).toHaveValue('Co-authored correct explanation.');
  await expect(owner.getByRole('status').filter({ hasText: 'All changes saved to shared draft' })).toBeVisible();
  const commitIds: string[] = [];
  let loseCommitResponse = true;
  await owner.route(`**/api/courses/${courseId}/questions/${questionId}/draft/commit`, async route => {
    commitIds.push(route.request().postDataJSON().requestId);
    if (loseCommitResponse) { loseCommitResponse = false; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await owner.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Retry save', exact: true })).toBeEnabled();
  await owner.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(owner.getByRole('status').filter({ hasText: 'Version saved to Review Queue' })).toBeVisible();
  expect(commitIds).toHaveLength(2);
  expect(commitIds[0]).toBe(commitIds[1]);
  await expect.poll(async () => (await questionsCol().findOne({ _id: questionId }))?.currentVersion).toBe(2);
  expect((await questionsCol().findOne({ _id: questionId }))?.state).toBe('pending-review');
  await colleague.reload();
  await expect(second).toHaveValue(await first.inputValue());

  // An advanced-editor save deliberately diverges from the shared baseline.
  const head = await questionsCol().findOne({ _id: questionId });
  const external = await owner.request.patch(`/api/questions/${questionId}`, { data: { expectedVersionId: head!.currentVersionId.toHexString(), stem: 'A newer separately saved question.' } });
  expect(external.status(), await external.text()).toBe(200);
  await expect(owner.getByRole('button', { name: 'Compare saved version' })).toBeVisible();
  await owner.getByRole('button', { name: 'Compare saved version' }).click();
  await expect(owner.getByRole('dialog').getByText('A newer separately saved question.', { exact: true })).toBeVisible();
  await owner.getByRole('button', { name: 'Continue with shared draft' }).click();
  await expect(owner.getByRole('button', { name: 'Compare saved version' })).toBeHidden();
  await owner.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect.poll(async () => (await questionsCol().findOne({ _id: questionId }))?.currentVersion).toBe(4);
  expect(await questionVersionsCol().countDocuments({ questionId })).toBe(4);

  await expect(owner.locator('.collaborative-editor__person').filter({ hasText: 'Teaching Assistant' }).first()).toBeVisible();
  const violations = (await new AxeBuilder({ page: owner }).include('.collaborative-editor').withTags(['wcag2a', 'wcag2aa']).analyze()).violations;
  expect(violations).toEqual([]);
  await owner.screenshot({ path: 'audit-results/question-collaboration/desktop.png', fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect.poll(() => owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page: owner }).include('.collaborative-editor').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await owner.screenshot({ path: 'audit-results/question-collaboration/mobile-dark.png', fullPage: true });

  const removed = await owner.request.delete(`${api}/instructors/${encodeURIComponent(colleagueSession.user.puid)}`);
  expect(removed.status(), await removed.text()).toBe(200);
  await expect(second).toBeDisabled({ timeout: 10000 });
  expect((await colleague.request.get(`${api}/questions/${questionId}/draft`)).status()).toBe(403);
  expect(await attemptsCol().countDocuments({ courseId })).toBe(0);
  expect(errors).toEqual([]);
});
