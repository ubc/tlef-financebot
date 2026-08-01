import { test, expect, type Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  attemptsCol,
  coursesCol,
  examAttemptsCol,
  examTemplatesCol,
  losCol,
  masteryCol,
  questionVersionsCol,
  questionsCol,
  reviewBookCol,
  rosterCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

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
const COURSE_NAME = `Exam Mode E2E ${Date.now()}`;
const STEMS = [
  'Exam integrity fixture: which cash flow is discounted?',
  'Exam integrity fixture: which portfolio is diversified?',
];
const EXPLANATIONS = [
  'EXAM-ONLY explanation for discounted cash flow.',
  'EXAM-ONLY explanation for portfolio diversification.',
];

test.describe('Exam Prep single-sitting integrity path', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ browser }) => {
    const instructorContext = await browser.newContext({ storageState: AUTH_FILE });
    const api = instructorContext.request;
    const courseResponse = await api.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: 'EXAM-E2E', term: '2026W' },
    });
    expect(courseResponse.status()).toBe(201);
    const course = (await courseResponse.json()) as { _id: string; registrationCode: string };
    courseId = course._id;
    registrationCode = course.registrationCode;

    const themeResponse = await api.post(`/api/courses/${courseId}/themes`, {
      data: { name: 'Exam integrity Topic' },
    });
    expect(themeResponse.status()).toBe(201);
    const theme = (await themeResponse.json()) as { _id: string };
    themeId = theme._id;
    const loResponse = await api.post(`/api/themes/${themeId}/los`, {
      data: { name: 'Complete an exam sitting safely' },
    });
    expect(loResponse.status()).toBe(201);
    const lo = (await loResponse.json()) as { _id: string };

    await api.put(`/api/courses/${courseId}/roster`, {
      data: { identifiers: ['student-user'] },
    });
    await connectMongo();
    for (let index = 0; index < STEMS.length; index += 1) {
      const created = await createQuestion({
        courseId: new ObjectId(courseId),
        loIds: [new ObjectId(lo._id)],
        themeIds: [new ObjectId(themeId)],
        type: 'mcq',
        stem: STEMS[index],
        difficulty: 'medium',
        createdBy: 'exam-mode-e2e',
        options: [
          { key: 'A', text: `Correct choice ${index + 1}`, role: 'correct', explanation: EXPLANATIONS[index] },
          { key: 'B', text: `Wrong choice ${index + 1}`, role: 'common-misconception', explanation: `Wrong ${EXPLANATIONS[index]}` },
          { key: 'C', text: `Partial choice ${index + 1}`, role: 'partially-correct', explanation: `Partial ${EXPLANATIONS[index]}` },
          { key: 'D', text: `Other choice ${index + 1}`, role: 'clearly-wrong', explanation: `Other ${EXPLANATIONS[index]}` },
        ],
      });
      expect((await api.post(`/api/questions/${created.questionId.toHexString()}/transition`, {
        data: { to: 'pending-review' },
      })).status()).toBe(200);
      expect((await api.post(`/api/questions/${created.questionId.toHexString()}/transition`, {
        data: { to: 'approved' },
      })).status()).toBe(200);
    }
    expect((await api.post(`/api/courses/${courseId}/publish`)).status()).toBe(200);
    const now = Date.now();
    const template = await api.put(`/api/courses/${courseId}/exam-templates/midterm`, {
      data: {
        themes: [{ themeId, mcqCount: 2, tfCount: 0, pointsPerQuestion: 1 }],
        timeLimitMinutes: 30,
        availabilityStart: new Date(now - 60_000).toISOString(),
        availabilityEnd: new Date(now + 3_600_000).toISOString(),
        loBreakdown: true,
      },
    });
    expect(template.status()).toBe(200);
    await instructorContext.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    const questions = await questionsCol().find({ courseId: cId }).toArray();
    const questionIds = questions.map((question) => question._id);
    await Promise.all([
      attemptsCol().deleteMany({ courseId: cId }),
      examAttemptsCol().deleteMany({ courseId: cId }),
      examTemplatesCol().deleteMany({ courseId: cId }),
      masteryCol().deleteMany({ courseId: cId }),
      reviewBookCol().deleteMany({ courseId: cId }),
      questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
      questionsCol().deleteMany({ courseId: cId }),
      rosterCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne(
        { uid: 'student-user' },
        { $pull: { courseRoles: { courseId: cId } } },
      ),
    ]);
  });

  test('withholds feedback, resumes after reload, then reveals results and collects misses', async ({ page }) => {
    await login(page, 'student');
    await page.goto('/#/');
    await page.getByPlaceholder('Registration code').fill(registrationCode);
    await page.getByRole('button', { name: /join/i }).click();
    await expect(page.getByText(COURSE_NAME)).toBeVisible();
    await page.goto(`/#/course/${courseId}`);

    await expect(page.getByRole('link', { name: 'Exam Prep', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Exam Prep', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Exam Prep', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start exam', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Midterm Exam Prep' })).toBeVisible();

    const liveTextBefore = await page.locator('body').innerText();
    for (const explanation of EXPLANATIONS) expect(liveTextBefore).not.toContain(explanation);
    const savedAnswer = page.waitForResponse((response) => (
      response.request().method() === 'PUT' && response.url().includes('/answers/0')
    ));
    await page.getByRole('button', { name: /Wrong choice/ }).click();
    expect((await savedAnswer).status()).toBe(204);
    await expect(page.getByRole('button', { name: /Wrong choice.*selected/ })).toBeVisible();
    const attemptUrl = page.url();
    const liveTextAfter = await page.locator('body').innerText();
    for (const explanation of EXPLANATIONS) expect(liveTextAfter).not.toContain(explanation);

    await page.reload();
    await expect(page).toHaveURL(attemptUrl);
    await page.locator('.exam-question-grid__item').first().click();
    await expect(page.getByRole('button', { name: /Wrong choice.*selected/ })).toBeVisible();
    const resumedText = await page.locator('body').innerText();
    for (const explanation of EXPLANATIONS) expect(resumedText).not.toContain(explanation);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /Submit exam \(1 unanswered\)/ }).click();
    await expect(page.getByRole('heading', { name: 'Midterm results' })).toBeVisible();
    await expect(page.getByText('0 / 2', { exact: true })).toBeVisible();
    for (const explanation of EXPLANATIONS) {
      await expect(page.getByText(explanation, { exact: false }).first()).toBeVisible();
    }

    await page.getByRole('link', { name: 'Open Review Book' }).click();
    await page.getByRole('button', { name: /expand entries/i }).click();
    await expect(page.getByText('Exam integrity fixture:', { exact: false }).first()).toBeVisible();

    const cId = new ObjectId(courseId);
    await expect.poll(() => examAttemptsCol().countDocuments({ courseId: cId, submittedAt: { $exists: true } })).toBe(1);
    await expect(attemptsCol().countDocuments({ courseId: cId, mode: 'exam-prep' })).resolves.toBe(2);
    await expect(reviewBookCol().countDocuments({ courseId: cId })).resolves.toBe(2);
  });
});
