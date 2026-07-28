import { test, expect, type Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  attemptsCol,
  auditCol,
  coursesCol,
  flagsCol,
  losCol,
  masteryCol,
  notificationsCol,
  questionsCol,
  questionVersionsCol,
  reviewBookCol,
  rosterCol,
  sessionSummariesCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';
import { checkAutoPause } from '../../server/src/services/flags.service';
import type { AttemptRecord, Flag } from '../../server/src/types/domain';

// Phase 2 exit proof (Task 11): real SAML student + instructor browser
// sessions drive the public UI/routes. Four peer flags/attempts are inserted
// directly as isolated fixtures because the local IdP intentionally exposes
// only one student persona; checkAutoPause still runs through the production
// service, including publication transition and elevated notification.

async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

let courseId = '';
let registrationCode = '';
let themeId = '';
let loId = '';
let questionId = '';
let questionVersionId = '';

const COURSE_NAME = `Flag Loop E2E ${Date.now()}`;
const COURSE_CODE = 'FLAG-E2E';
const THEME_NAME = 'Flag safety loop';
const LO_NAME = 'Verify publication safety';
const STEM = 'Which control removes a paused question from student serving?';
const FLAG_REASON = 'Phase 2 exit proof';

test.describe('Phase 2 flag safety loop', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ browser }) => {
    const instructorContext = await browser.newContext({ storageState: AUTH_FILE });
    const api = instructorContext.request;

    const courseRes = await api.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: COURSE_CODE, term: '2026W' },
    });
    expect(courseRes.status()).toBe(201);
    const course = (await courseRes.json()) as { _id: string; registrationCode: string };
    courseId = course._id;
    registrationCode = course.registrationCode;

    const themeRes = await api.post(`/api/courses/${courseId}/themes`, {
      data: { name: THEME_NAME },
    });
    expect(themeRes.status()).toBe(201);
    const theme = (await themeRes.json()) as { _id: string };
    themeId = theme._id;

    const loRes = await api.post(`/api/themes/${themeId}/los`, {
      data: { name: LO_NAME },
    });
    expect(loRes.status()).toBe(201);
    const lo = (await loRes.json()) as { _id: string };
    loId = lo._id;

    await api.put(`/api/courses/${courseId}/roster`, {
      data: { identifiers: ['student-user'] },
    });
    await api.post(`/api/courses/${courseId}/publish`);

    await connectMongo();
    const created = await createQuestion({
      courseId: new ObjectId(courseId),
      loIds: [new ObjectId(loId)],
      themeIds: [new ObjectId(themeId)],
      type: 'mcq',
      stem: STEM,
      difficulty: 'easy',
      createdBy: 'flag-loop-e2e',
      options: [
        {
          key: 'A',
          text: 'Approved-only serving',
          role: 'correct',
          explanation: 'Paused questions are excluded from the Approved-only pool.',
        },
        {
          key: 'B',
          text: 'A client-side warning',
          role: 'common-misconception',
          explanation: 'The server publication state is the enforcement point.',
        },
        {
          key: 'C',
          text: 'A hidden CSS class',
          role: 'clearly-wrong',
          explanation: 'CSS cannot enforce the serving contract.',
        },
        {
          key: 'D',
          text: 'A browser refresh',
          role: 'partially-correct',
          explanation: 'Refreshing only observes the server state; it does not create it.',
        },
      ],
    });
    questionId = created.questionId.toHexString();
    const question = await questionsCol().findOne({ _id: created.questionId });
    if (!question) throw new Error('flag-loop seed question missing');
    questionVersionId = question.currentVersionId.toHexString();

    const pendingRes = await api.post(`/api/questions/${questionId}/transition`, {
      data: { to: 'pending-review' },
    });
    expect(pendingRes.status()).toBe(200);
    const approvedRes = await api.post(`/api/questions/${questionId}/transition`, {
      data: { to: 'approved' },
    });
    expect(approvedRes.status()).toBe(200);

    await instructorContext.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    const qId = questionId ? new ObjectId(questionId) : undefined;

    const cleanup = [
      questionsCol().deleteMany({ courseId: cId }),
      flagsCol().deleteMany({ courseId: cId }),
      attemptsCol().deleteMany({ courseId: cId }),
      masteryCol().deleteMany({ courseId: cId }),
      reviewBookCol().deleteMany({ courseId: cId }),
      notificationsCol().deleteMany({ courseId: cId }),
      auditCol().deleteMany({ courseId: cId }),
      sessionSummariesCol().deleteMany({ courseId: cId }),
      rosterCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateMany(
        { uid: { $in: ['student-user', 'faculty-user'] } },
        { $pull: { courseRoles: { courseId: cId } } },
      ),
    ];
    if (qId) cleanup.push(questionVersionsCol().deleteMany({ questionId: qId }));
    await Promise.all(cleanup);
  });

  test('flag -> notify -> auto-pause -> serving exclusion -> clear -> restored', async ({
    browser,
    page,
  }) => {
    await login(page, 'student');
    await page.goto('/#/');
    await page.getByPlaceholder('Registration code').fill(registrationCode);
    await page.getByRole('button', { name: /join/i }).click();
    await expect(page.getByText(COURSE_NAME)).toBeVisible();

    await page.goto(`/#/course/${courseId}/practice/${loId}`);
    await expect(page.getByText(STEM)).toBeVisible();
    await page.getByRole('button', { name: '🏳 Flag this question' }).click();
    await page.getByLabel('Why are you flagging this question? (optional)').fill(FLAG_REASON);
    await page.getByRole('button', { name: 'Send flag' }).click();
    await expect(page.getByText('Flagged ✓')).toBeVisible();

    const instructorContext = await browser.newContext({ storageState: AUTH_FILE });
    const instructorPage = await instructorContext.newPage();
    try {
      await instructorPage.goto(`/#/instructor/course/${courseId}/flags`);
      await expect(instructorPage.getByRole('heading', { name: 'Flags' })).toBeVisible();
      await expect(instructorPage.getByText(STEM)).toBeVisible();
      await expect(instructorPage.getByText(`"${FLAG_REASON}"`, { exact: false })).toBeVisible();
      await expect(instructorPage.getByText('1 flag', { exact: true })).toBeVisible();

      await instructorPage.getByRole('button', { name: /Notifications/ }).click();
      await expect(
        instructorPage.getByText(`A question was flagged: "${FLAG_REASON}"`),
      ).toBeVisible();

      const cId = new ObjectId(courseId);
      const tId = new ObjectId(themeId);
      const lId = new ObjectId(loId);
      const qId = new ObjectId(questionId);
      const vId = new ObjectId(questionVersionId);
      const student = await usersCol().findOne({ uid: 'student-user' });
      if (!student) throw new Error('flag-loop student user missing');

      const peerPuids = ['flag-peer-2', 'flag-peer-3', 'flag-peer-4', 'flag-peer-5'];
      const now = Date.now();
      const peerFlags: Array<Flag & { _id: ObjectId }> = peerPuids.map((puid, index) => ({
        _id: new ObjectId(),
        courseId: cId,
        questionId: qId,
        questionVersionId: vId,
        puid,
        reason: `Seeded peer flag ${index + 2}`,
        state: 'open',
        createdAt: new Date(now + index),
      }));
      await flagsCol().insertMany(peerFlags);

      const attempterPuids = [student.puid, ...peerPuids];
      const attempts: Array<AttemptRecord & { _id: ObjectId }> = attempterPuids.map(
        (puid, index) => ({
          _id: new ObjectId(),
          puid,
          courseId: cId,
          questionId: qId,
          questionVersionId: vId,
          loId: lId,
          themeId: tId,
          mode: 'topic-practice',
          strategy: 'b',
          selectedKey: 'C',
          correct: false,
          selectedRole: 'clearly-wrong',
          difficulty: 'easy',
          isRetry: false,
          createdAt: new Date(now + index),
        }),
      );
      await attemptsCol().insertMany(attempts);

      await expect(checkAutoPause(qId)).resolves.toBe(true);
      await expect
        .poll(async () => (await questionsCol().findOne({ _id: qId }))?.state)
        .toBe('paused');

      const pausedServe = await page.request.post(
        `/api/courses/${courseId}/practice/next`,
        { data: { loId, sessionServedIds: [] } },
      );
      expect(pausedServe.status()).toBe(404);
      await expect(pausedServe.json()).resolves.toEqual({ error: 'no-question-available' });

      await instructorPage.reload();
      await expect(instructorPage.getByText('5 flags', { exact: true })).toBeVisible();
      await instructorPage.getByRole('button', { name: /Notifications/ }).click();
      await expect(
        instructorPage.getByText('A question was auto-paused after exceeding the flag thresholds.'),
      ).toBeVisible();

      await instructorPage.getByRole('button', { name: 'Clear' }).click();
      await expect(instructorPage.getByText('Resolved: cleared')).toBeVisible();
      await expect
        .poll(async () => (await questionsCol().findOne({ _id: qId }))?.state)
        .toBe('approved');

      const restoredServe = await page.request.post(
        `/api/courses/${courseId}/practice/next`,
        { data: { loId, sessionServedIds: [] } },
      );
      expect(restoredServe.status()).toBe(200);
      const restoredQuestion = (await restoredServe.json()) as { questionId: string };
      expect(restoredQuestion.questionId).toBe(questionId);

      await expect
        .poll(() =>
          notificationsCol().countDocuments({
            courseId: cId,
            recipientPuid: student.puid,
            kind: 'flag-resolved',
          }),
        )
        .toBe(1);

      // Hash-only navigation keeps the existing student shell (and its
      // intentionally 30-second notification cache) alive. Reload once to
      // exercise the bell's immediate initial poll instead of sleeping for a
      // polling interval.
      await page.goto(`/#/course/${courseId}`);
      await page.reload();
      await page.getByRole('button', { name: /Notifications/ }).click();
      await expect(page.getByText('Your flag was resolved (clear).')).toBeVisible();
    } finally {
      await instructorContext.close();
    }
  });
});
