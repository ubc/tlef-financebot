import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ObjectId, type WithId } from 'mongodb';
import { AUTH_FILE, RELEASED } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  attemptsCol, capabilitySettingsCol, coursesCol, flagsCol, losCol, questionVersionsCol, questionsCol,
  themesCol, tutorialProgressCol, usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';
import type { AttemptRecord, TutorialProgress, TutorialRole } from '../../server/src/types/domain';

const run = new ObjectId().toHexString();
const learnerPuid = `ROLE-EXPERIENCE-${run}`;
let courseId = '';
let themeId = '';
let loId = '';
let untouchedLoId = '';
let questionId = '';
let firstVersionId = '';
let secondVersionId = '';
let ownerPuid = '';
let previousProgress: WithId<TutorialProgress>[] = [];
let progressSnapshotTaken = false;
const from = new Date(Date.now() - 28 * 86_400_000).toISOString();
const to = new Date(Date.now() + 60_000).toISOString();
const query = new URLSearchParams({ mode: 'topic-practice', from, to });

async function responseJson(api: APIRequestContext, path: string): Promise<unknown> {
  const response = await api.get(path);
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function completeTour(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 4; step += 1) {
    const next = dialog.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.count())) break;
    await next.click();
  }
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
}

async function isolateRoleTutorials(role: TutorialRole): Promise<() => Promise<void>> {
  const original = await tutorialProgressCol().find({ puid: ownerPuid, role }).toArray();
  await tutorialProgressCol().deleteMany({ puid: ownerPuid, role });
  return async () => {
    await tutorialProgressCol().deleteMany({ puid: ownerPuid, role });
    if (original.length) await tutorialProgressCol().insertMany(original);
  };
}

test.describe('Role experience on real SAML and MongoDB', () => {
  test.use({ storageState: AUTH_FILE });
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    try {
      const api = context.request;
      const auth = await responseJson(api, '/api/auth/me') as { user: { puid: string } };
      ownerPuid = auth.user.puid;
      await connectMongo();
      previousProgress = await tutorialProgressCol().find({ puid: ownerPuid, role: 'instructor' }).toArray();
      progressSnapshotTaken = true;
      const catalogue = await responseJson(api, '/api/tutorials?role=instructor') as Array<{ id: string; version: number }>;
      // This fixture tests analytics without first-use overlays. The separate
      // tutorial test below uses the real persistence API, not an HTTP mock.
      for (const item of catalogue) {
        await tutorialProgressCol().updateOne(
          { puid: ownerPuid, role: 'instructor', tutorialId: item.id },
          { $set: { puid: ownerPuid, role: 'instructor', tutorialId: item.id, version: item.version, status: 'dismissed', updatedAt: new Date() } },
          { upsert: true },
        );
      }
      const created = await api.post('/api/courses', {
        data: { name: `Role Experience Acceptance ${run}`, courseCode: 'ROLE-QA', term: '2026W' },
      });
      expect(created.status()).toBe(201);
      courseId = (await created.json() as { _id: string })._id;
      const theme = await api.post(`/api/courses/${courseId}/themes`, { data: { name: 'Cash flow evidence', availableFrom: RELEASED } });
      expect(theme.status()).toBe(201);
      themeId = (await theme.json() as { _id: string })._id;
      for (const name of ['Compare cash-flow timing', 'Explain risk without attempts']) {
        const response = await api.post(`/api/themes/${themeId}/los`, { data: { name } });
        expect(response.status()).toBe(201);
        const id = (await response.json() as { _id: string })._id;
        if (!loId) loId = id;
        else untouchedLoId = id;
      }
      const cId = new ObjectId(courseId);
      await usersCol().insertOne({
        puid: learnerPuid, uid: `role-qa-${run}`, displayName: 'Acceptance learner', email: '',
        affiliations: ['student'], isAdmin: false, courseRoles: [{ courseId: cId, role: 'student' }],
        createdAt: new Date(), lastLoginAt: new Date(),
      });
      const createdQuestion = await createQuestion({
        courseId: cId, loIds: [new ObjectId(loId)], themeIds: [new ObjectId(themeId)],
        type: 'mcq', stem: 'Acceptance version one: why discount future cash flows?', difficulty: 'medium', createdBy: ownerPuid,
        options: [
          { key: 'A', text: 'Compare at the same point in time.', role: 'correct', explanation: 'Use a common valuation date.' },
          { key: 'B', text: 'Make every future amount larger.', role: 'common-misconception', explanation: 'Discounting does not increase every amount.' },
          { key: 'C', text: 'Remove all investment risk.', role: 'clearly-wrong', explanation: 'Risk remains.' },
          { key: 'D', text: 'Compare nominal totals only.', role: 'partially-correct', explanation: 'Timing also matters.' },
        ],
      });
      questionId = createdQuestion.questionId.toHexString();
      const question = await questionsCol().findOne({ _id: createdQuestion.questionId });
      expect(question).toBeTruthy();
      const first = await questionVersionsCol().findOne({ _id: question!.currentVersionId });
      expect(first).toBeTruthy();
      firstVersionId = first!._id.toHexString();
      const secondId = new ObjectId();
      const secondOptions = first!.options.map((option, index) => ({ ...option, key: first!.options[(index + 1) % first!.options.length].key }));
      await questionVersionsCol().insertOne({
        ...first!, _id: secondId, version: 2, stem: 'Acceptance version two: choose a common valuation date.',
        options: secondOptions, createdAt: new Date(),
      });
      secondVersionId = secondId.toHexString();
      await questionsCol().updateOne({ _id: question!._id }, { $set: { currentVersionId: secondId, currentVersion: 2 } });
      const attempt = (versionId: string, correct: boolean, index: number, exam = false, old = false): AttemptRecord => {
        const options = versionId === firstVersionId ? first!.options : secondOptions;
        const option = options.find((entry) => entry.role === (correct ? 'correct' : 'common-misconception'))!;
        return {
          puid: learnerPuid, courseId: cId, questionId: question!._id, questionVersionId: new ObjectId(versionId),
          loId: new ObjectId(loId), themeId: new ObjectId(themeId), mode: exam ? 'exam-prep' : 'topic-practice',
          strategy: 'b', selectedKey: option.key, selectedRole: option.role, correct, difficulty: 'medium', isRetry: false,
          createdAt: new Date(Date.now() - (old ? 40 : 2) * 86_400_000 + index * 60_000),
        };
      };
      await attemptsCol().insertMany([
        ...Array.from({ length: 6 }, (_, i) => attempt(firstVersionId, true, i)),
        ...Array.from({ length: 6 }, (_, i) => attempt(secondVersionId, false, i + 10)),
        ...Array.from({ length: 3 }, (_, i) => attempt(firstVersionId, false, i + 20, true)),
        attempt(firstVersionId, false, 0, false, true),
      ]);
    } finally { await context.close(); }
  });

  test.afterAll(async () => {
    await connectMongo();
    if (courseId) {
      const cId = new ObjectId(courseId);
      const questions = await questionsCol().find({ courseId: cId }).toArray();
      await Promise.all([
        attemptsCol().deleteMany({ courseId: cId }),
        flagsCol().deleteMany({ courseId: cId }),
        capabilitySettingsCol().deleteMany({ courseId: cId }),
        questionVersionsCol().deleteMany({ questionId: { $in: questions.map((question) => question._id) } }),
        questionsCol().deleteMany({ courseId: cId }),
        losCol().deleteMany({ courseId: cId }), themesCol().deleteMany({ courseId: cId }),
        coursesCol().deleteOne({ _id: cId }),
        usersCol().updateOne({ puid: ownerPuid }, { $pull: { courseRoles: { courseId: cId } } }),
      ]);
    }
    await usersCol().deleteOne({ puid: learnerPuid });
    if (ownerPuid && progressSnapshotTaken) {
      await tutorialProgressCol().deleteMany({ puid: ownerPuid, role: 'instructor' });
      if (previousProgress.length) await tutorialProgressCol().insertMany(previousProgress);
    }
  });

  test('retains zero-data objectives and separates historical versions, modes and dates', async ({ request }) => {
    const prefix = `/api/courses/${courseId}/analytics`;
    const rates = await responseJson(request, `${prefix}/failure-rates?${query}`) as Array<{
      attempts: number; failureRate?: number; los: Array<{ loId: string; attempts: number; insufficient: boolean; failureRate?: number }>;
    }>;
    expect(rates[0]).toMatchObject({ attempts: 12, failureRate: 0.5 });
    expect(rates[0].los.find((lo) => lo.loId === untouchedLoId)).toMatchObject({ attempts: 0, insufficient: true });
    expect(rates[0].los.find((lo) => lo.loId === untouchedLoId)?.failureRate).toBeUndefined();
    const patterns = await responseJson(request, `${prefix}/question-patterns?${query}`) as { items: Array<{ versionId: string; attempts: number; failureRate?: number }>; total: number };
    expect(patterns.total).toBe(2);
    expect(patterns.items.find((item) => item.versionId === firstVersionId)).toMatchObject({ attempts: 6, failureRate: 0 });
    expect(patterns.items.find((item) => item.versionId === secondVersionId)).toMatchObject({ attempts: 6, failureRate: 1 });
    const first = await responseJson(request, `${prefix}/questions/${questionId}/distribution?${query}&versionId=${firstVersionId}`) as { attempts: number; options: Array<{ role: string; count: number; pct?: number }> };
    expect(first.attempts).toBe(6);
    expect(first.options.find((option) => option.role === 'correct')).toMatchObject({ count: 6, pct: 1 });
    const examQuery = new URLSearchParams(query); examQuery.set('mode', 'exam-prep');
    const exam = await responseJson(request, `${prefix}/questions/${questionId}/distribution?${examQuery}&versionId=${firstVersionId}`) as { attempts: number; insufficient: boolean; options: Array<{ pct?: number }> };
    expect(exam).toMatchObject({ attempts: 3, insufficient: true });
    expect(exam.options.every((option) => option.pct === undefined)).toBe(true);
    expect((await request.get(`${prefix}/questions/${questionId}/distribution?versionId=${new ObjectId()}`)).status()).toBe(404);
  });

  test('persists Instructor tutorial status under the session identity across reload', async ({ page }) => {
    const result = await page.request.put('/api/tutorials/instructor-analytics', { data: { role: 'instructor', status: 'completed', puid: learnerPuid } });
    expect(result.status()).toBe(200);
    const saved = await tutorialProgressCol().findOne({ puid: ownerPuid, role: 'instructor', tutorialId: 'instructor-analytics' });
    expect(saved?.status).toBe('completed');
    expect(await tutorialProgressCol().countDocuments({ puid: learnerPuid })).toBe(0);
    await page.goto(`/#/instructor/course/${courseId}/analytics`);
    await expect(page.getByRole('heading', { name: 'Student Analytics', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Student Analytics', exact: true })).toBeVisible();
    await expect(page.locator('.tutorial-popover')).toHaveCount(0);
    expect((await responseJson(page.request, '/api/tutorials?role=instructor') as Array<{ id: string; status: string }>).find((item) => item.id === 'instructor-analytics')?.status).toBe('completed');
    await page.getByRole('link', { name: 'Help & Tutorials', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Help & Tutorials', exact: true })).toBeVisible();
    await page.getByLabel('Tutorial course').selectOption(courseId);
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Student Analytics', exact: true }) });
    await card.getByRole('button', { name: 'Replay', exact: true }).click();
    await completeTour(page);
    await page.screenshot({ path: '/private/tmp/financebot-role-experience/analytics-real-desktop.png', fullPage: false });
  });

  test('keeps aggregate analytics available while denying named student data without permission', async ({ page }) => {
    const original = await usersCol().findOne({ puid: ownerPuid });
    expect(original).toBeTruthy();
    const cId = new ObjectId(courseId);
    try {
      await usersCol().updateOne({ puid: ownerPuid }, { $set: { isAdmin: false } });
      await capabilitySettingsCol().insertOne({
        scope: 'course', courseId: cId, updatedBy: ownerPuid, updatedAt: new Date(),
        assignments: { 'analytics.view': { instructor: true }, 'analytics.individual': { instructor: false } },
      });
      const prefix = `/api/courses/${courseId}/analytics`;
      expect((await page.request.get(`${prefix}/failure-rates?${query}`)).status()).toBe(200);
      expect((await page.request.get(`${prefix}/question-patterns?${query}`)).status()).toBe(200);
      expect((await page.request.get(`${prefix}/low-engagement?inactiveDays=7`)).status()).toBe(403);
      expect((await page.request.get(`/api/courses/${courseId}/students?q=Acceptance`)).status()).toBe(403);
      await page.goto(`/#/instructor/course/${courseId}/analytics`);
      await expect(page.getByRole('heading', { name: 'Where to focus', exact: true })).toBeVisible();
      await expect(page.getByText('Individual profiles are unavailable with your course permissions.', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Student search')).toHaveCount(0);
      await expect(page.getByText('Acceptance learner', { exact: true })).toHaveCount(0);
    } finally {
      await usersCol().updateOne({ puid: ownerPuid }, { $set: { isAdmin: original!.isAdmin } });
      await capabilitySettingsCol().deleteMany({ courseId: cId });
    }
  });

  test('keeps Instructor review help available after background question enrichment', async ({ page }) => {
    await tutorialProgressCol().deleteOne({ puid: ownerPuid, role: 'instructor', tutorialId: 'instructor-review' });
    await questionsCol().updateOne({ _id: new ObjectId(questionId) }, { $set: { state: 'pending-review' } });
    await page.goto(`/#/instructor/course/${courseId}/queue`);
    await completeTour(page);
    await expect.poll(() => tutorialProgressCol().countDocuments({
      puid: ownerPuid, role: 'instructor', tutorialId: 'instructor-review', status: 'completed',
    })).toBe(1);
  });

  test('supports real TA help and all three tours without approval or resolution access', async ({ page }) => {
    const original = await usersCol().findOne({ puid: ownerPuid });
    expect(original).toBeTruthy();
    const cId = new ObjectId(courseId);
    const restoreProgress = await isolateRoleTutorials('ta');
    try {
      await usersCol().updateOne({ puid: ownerPuid }, {
        $set: { isAdmin: false, 'courseRoles.$[course].role': 'ta' },
      }, { arrayFilters: [{ 'course.courseId': cId }] });
      await capabilitySettingsCol().insertOne({
        scope: 'course', courseId: cId, updatedBy: ownerPuid, updatedAt: new Date(),
        assignments: {
          'question.review': { ta: true }, 'question.suggest-edit': { ta: true },
          'question.mark-reviewed': { ta: true }, 'flag.triage': { ta: true },
          'question.approve': { ta: true }, 'flag.resolve': { ta: true },
        },
      });
      await questionsCol().updateOne({ _id: new ObjectId(questionId) }, { $set: { state: 'pending-review' } });
      await flagsCol().insertOne({
        courseId: cId, questionId: new ObjectId(questionId), questionVersionId: new ObjectId(secondVersionId),
        puid: learnerPuid, source: 'student', reason: 'Acceptance-only wording report', state: 'open', createdAt: new Date(),
      });
      const permissions = await responseJson(page.request, `/api/courses/${courseId}/capabilities/me`);
      expect(permissions).toMatchObject({ 'question.review': true, 'question.approve': false, 'flag.resolve': false });
      await page.goto(`/#/ta/course/${courseId}/help`);
      await expect(page.getByRole('heading', { name: 'Help & Tutorials', exact: true })).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(3);
      await page.goto(`/#/ta/course/${courseId}/review`);
      await completeTour(page);
      await page.goto(`/#/ta/course/${courseId}/question/${questionId}`);
      await completeTour(page);
      await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
      await page.goto(`/#/ta/course/${courseId}/flags`);
      await completeTour(page);
      await expect(page.getByRole('button', { name: /^Resolve/ })).toHaveCount(0);
      await expect.poll(() => tutorialProgressCol().countDocuments({ puid: ownerPuid, role: 'ta', status: 'completed' })).toBe(3);
    } finally {
      await usersCol().updateOne({ puid: ownerPuid }, {
        $set: { isAdmin: original!.isAdmin, 'courseRoles.$[course].role': 'instructor' },
      }, { arrayFilters: [{ 'course.courseId': cId }] });
      await capabilitySettingsCol().deleteMany({ courseId: cId });
      await restoreProgress();
    }
  });

  test('supports real Admin help and all four tours while retaining account privileges', async ({ page }) => {
    const original = await usersCol().findOne({ puid: ownerPuid });
    expect(original).toBeTruthy();
    const restoreProgress = await isolateRoleTutorials('admin');
    try {
      // Local acceptance fixture only. Restore the exact privilege in finally;
      // the tutorials themselves never submit any grant or settings form.
      await usersCol().updateOne({ puid: ownerPuid }, { $set: { isAdmin: true } });
      await page.goto('/#/admin/help');
      await expect(page.getByRole('heading', { name: 'Help & Tutorials', exact: true })).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(4);
      for (const path of ['accounts', 'users', 'capabilities', 'platform-settings']) {
        await page.goto(`/#/admin/${path}`);
        await completeTour(page);
      }
      await expect.poll(() => tutorialProgressCol().countDocuments({ puid: ownerPuid, role: 'admin', status: 'completed' })).toBe(4);
      expect((await usersCol().findOne({ puid: ownerPuid }))?.isAdmin).toBe(true);
    } finally {
      await usersCol().updateOne({ puid: ownerPuid }, { $set: { isAdmin: original!.isAdmin } });
      await restoreProgress();
    }
  });
});
