import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  contentRunsCol,
  coursesCol,
  losCol,
  materialsCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

const COURSE_NAME = 'Task 10 Generation E2E';
const MATERIAL_NAME = 'Lecture 3 IRR.pdf';
const ORIGINAL_STEM = 'Which discount rate makes the net present value of a project equal to zero?';
const VARIANT_STEM = 'A project has an IRR above its required return. What should the manager conclude?';

let courseId = '';
let themeId = '';
let loId = '';
let questionId = '';
let facultyPuid = '';

const originalOptions = [
  { key: 'A', text: 'Internal rate of return', role: 'correct' as const, explanation: 'IRR sets NPV to zero.' },
  { key: 'B', text: 'Coupon rate', role: 'common-misconception' as const, explanation: 'A coupon rate applies to debt cash flows.' },
  { key: 'C', text: 'Accounting return', role: 'partially-correct' as const, explanation: 'Accounting return is not a discounted-cash-flow break-even rate.' },
  { key: 'D', text: 'Inflation rate', role: 'clearly-wrong' as const, explanation: 'Inflation does not solve this equation.' },
];

const variantOptions = [
  { key: 'A', text: 'Accept when other constraints are satisfied', role: 'correct' as const, explanation: 'IRR exceeds the hurdle rate.' },
  { key: 'B', text: 'Reject because NPV must be negative', role: 'common-misconception' as const, explanation: 'IRR above the hurdle implies positive NPV under conventional cash flows.' },
  { key: 'C', text: 'Ignore the required return', role: 'partially-correct' as const, explanation: 'The comparison to required return is essential.' },
  { key: 'D', text: 'The project has no cash flows', role: 'clearly-wrong' as const, explanation: 'IRR requires cash flows.' },
];

test.describe('Task 10 custom generation and regeneration', () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const me = await context.request.get('/api/auth/me');
    const auth = (await me.json()) as { user: { puid: string } };
    facultyPuid = auth.user.puid;

    const courseResponse = await context.request.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: 'FIN-T10', term: '2026W' },
    });
    expect(courseResponse.ok()).toBeTruthy();
    const course = (await courseResponse.json()) as { _id: string };
    courseId = course._id;

    const themeResponse = await context.request.post(`/api/courses/${courseId}/themes`, {
      data: { name: 'Capital budgeting' },
    });
    const theme = (await themeResponse.json()) as { _id: string };
    themeId = theme._id;

    const loResponse = await context.request.post(`/api/themes/${themeId}/los`, {
      data: { name: 'Evaluate projects using IRR' },
    });
    const lo = (await loResponse.json()) as { _id: string };
    loId = lo._id;
    await context.close();

    await connectMongo();
    await materialsCol().insertOne({
      courseId: new ObjectId(courseId),
      name: MATERIAL_NAME,
      format: 'pdf',
      status: 'ready',
      assignments: [{ themeId: new ObjectId(themeId), loId: new ObjectId(loId) }],
      uploadedAt: new Date(),
    });
    const created = await createQuestion({
      courseId: new ObjectId(courseId),
      loIds: [new ObjectId(loId)],
      themeIds: [new ObjectId(themeId)],
      type: 'mcq',
      stem: ORIGINAL_STEM,
      options: originalOptions,
      difficulty: 'medium',
      createdBy: 'task-10-e2e',
    });
    questionId = created.questionId.toHexString();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    const questions = await questionsCol().find({ courseId: cId }).toArray();
    const questionIds = questions.map((question) => question._id);
    await Promise.all([
      questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
      questionsCol().deleteMany({ courseId: cId }),
      materialsCol().deleteMany({ courseId: cId }),
      contentRunsCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne(
        { puid: facultyPuid },
        { $pull: { courseRoles: { courseId: cId } } },
      ),
    ]);
  });

  test('preset and @mention clicks enqueue, then regeneration previews before explicit replacement', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));

    let generationPayload: Record<string, unknown> | undefined;
    await page.route(`**/api/courses/${courseId}/generate`, async (route) => {
      generationPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ runId: '1234567890abcdef12345678' }),
      });
    });

    await page.goto(`/#/instructor/course/${courseId}/preseeding`);
    await expect(page.getByRole('heading', { name: 'Question Bank Coverage' })).toBeVisible();
    await page.getByRole('button', { name: 'Applied scenario' }).click();
    const prompt = page.getByLabel(/Custom prompt/i);
    await expect(prompt).toHaveValue(/applied business scenario/i);

    await page.getByLabel('Material @mention autocomplete').fill(MATERIAL_NAME);
    await page.getByRole('button', { name: 'Insert @mention' }).click();
    await expect(prompt).toHaveValue(new RegExp(`@"${MATERIAL_NAME.replace('.', '\\.')}"`));
    await page.getByRole('button', { name: 'Generate Question →' }).click();
    await expect(page.getByText(/Generation queued as run 12345678/i)).toBeVisible();
    expect(generationPayload).toMatchObject({
      loId,
      type: 'mcq',
      difficulty: 'medium',
    });
    expect(String(generationPayload?.prompt)).toContain(`@"${MATERIAL_NAME}"`);

    await page.route(
      `**/api/courses/${courseId}/questions/${questionId}/regenerate`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            variant: {
              stem: VARIANT_STEM,
              options: variantOptions,
              difficulty: 'hard',
              sourceRefs: [],
              agentDecision: {
                decision: 'pass',
                reasoning: 'Grounded and distinct.',
                roleAssessment: 'Roles are valid.',
              },
            },
          }),
        });
      },
    );
    let patchRequests = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === `/api/questions/${questionId}`
      ) {
        patchRequests += 1;
      }
    });

    await page.goto(`/#/instructor/course/${courseId}/bank/${questionId}`);
    await expect(page.getByText(ORIGINAL_STEM)).toBeVisible();
    await page.getByRole('button', { name: /Regenerate/ }).click();
    await expect(page.getByRole('heading', { name: 'Regenerate side by side' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate alternative' }).click();
    await expect(page.getByRole('heading', { name: 'Current question' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Generated variant' })).toBeVisible();
    await expect(page.getByText(VARIANT_STEM)).toBeVisible();
    expect(patchRequests).toBe(0);

    await page.getByRole('button', { name: 'Replace with variant' }).click();
    await expect(page.getByText(/saved explicitly as question version 2/i)).toBeVisible();
    expect(patchRequests).toBe(1);
    await expect(page.locator('.question-stem-input')).toHaveValue(VARIANT_STEM);
    expect(browserErrors).toEqual([]);
  });
});
