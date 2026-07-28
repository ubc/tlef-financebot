import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  attemptsCol,
  coursesCol,
  flagsCol,
  losCol,
  masteryCol,
  notificationsCol,
  previewAttemptsCol,
  previewStudentSessionsCol,
  questionVersionsCol,
  questionsCol,
  reviewBookCol,
  sessionSummariesCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

const COURSE_NAME = 'Instructor Preview E2E Course';
const THEME_NAME = 'Preview Theme';
const LO_NAME = 'Preview compound interest';
const APPROVED_STEM = 'In Instructor Preview, what is 2 + 2?';
const DRAFT_STEM = 'DRAFT CONTENT MUST NOT APPEAR';

const courseId = new ObjectId();
const themeId = new ObjectId();
const loId = new ObjectId();
let instructorPuid = '';
let approvedQuestionId: ObjectId | undefined;
let draftQuestionId: ObjectId | undefined;

test.describe('Instructor student preview', () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeAll(async () => {
    await connectMongo();
    const instructor = await usersCol().findOne({ uid: 'faculty-user' })
      ?? await usersCol().findOne({ affiliations: 'faculty' });
    if (!instructor) throw new Error('Instructor preview E2E requires the global-setup faculty user.');
    instructorPuid = instructor.puid;

    await coursesCol().insertOne({
      _id: courseId,
      name: COURSE_NAME,
      courseCode: 'PREVIEW-E2E',
      term: '2026W',
      ownerPuid: instructor.puid,
      registrationCode: `PV${courseId.toHexString().slice(-6).toUpperCase()}`,
      published: false,
      feedbackStrategy: 'adaptive',
      autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 },
      redirectFailureThreshold: 3,
      reviewBacklogThreshold: 10,
      createdAt: new Date(),
    });
    await themesCol().insertOne({
      _id: themeId,
      courseId,
      name: THEME_NAME,
      order: 1,
    });
    await losCol().insertOne({
      _id: loId,
      courseId,
      themeId,
      name: LO_NAME,
      order: 1,
    });
    await usersCol().updateOne(
      { puid: instructor.puid },
      { $addToSet: { courseRoles: { courseId, role: 'instructor' } } },
    );

    const approved = await createQuestion({
      courseId,
      loIds: [loId],
      themeIds: [themeId],
      type: 'mcq',
      stem: APPROVED_STEM,
      difficulty: 'medium',
      createdBy: 'preview-e2e',
      options: [
        { key: 'A', text: '4', role: 'correct', explanation: 'Two plus two equals four.' },
        { key: 'B', text: '5', role: 'common-misconception', explanation: 'This adds one too many.' },
        { key: 'C', text: '3', role: 'partially-correct', explanation: 'This is one too few.' },
        { key: 'D', text: '22', role: 'clearly-wrong', explanation: 'This concatenates instead of adding.' },
      ],
    });
    approvedQuestionId = approved.questionId;
    await questionsCol().updateOne(
      { _id: approved.questionId },
      { $set: { state: 'approved', updatedAt: new Date() } },
    );

    const draft = await createQuestion({
      courseId,
      loIds: [loId],
      themeIds: [themeId],
      type: 'true-false',
      stem: DRAFT_STEM,
      difficulty: 'easy',
      createdBy: 'preview-e2e',
      options: [
        { key: 'T', text: 'True', role: 'correct', explanation: 'Draft fixture.' },
        { key: 'F', text: 'False', role: 'common-misconception', explanation: 'Draft fixture.' },
      ],
    });
    draftQuestionId = draft.questionId;
  });

  test.afterAll(async () => {
    const questionIds = [approvedQuestionId, draftQuestionId].filter(
      (id): id is ObjectId => id !== undefined,
    );
    await Promise.all([
      previewAttemptsCol().deleteMany({ courseId }),
      previewStudentSessionsCol().deleteMany({ courseId }),
      attemptsCol().deleteMany({ courseId }),
      masteryCol().deleteMany({ courseId }),
      reviewBookCol().deleteMany({ courseId }),
      flagsCol().deleteMany({ courseId }),
      notificationsCol().deleteMany({ courseId }),
      sessionSummariesCol().deleteMany({ courseId }),
      questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
      questionsCol().deleteMany({ courseId }),
      losCol().deleteMany({ courseId }),
      themesCol().deleteMany({ courseId }),
      coursesCol().deleteOne({ _id: courseId }),
      usersCol().updateOne(
        { puid: instructorPuid },
        { $pull: { courseRoles: { courseId } } },
      ),
    ]);
  });

  test('uses the full student shell while keeping every preview action isolated', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    await page.goto(`/#/instructor/course/${courseId.toHexString()}`);
    await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
    await expect(page.getByText('Sandbox (not yet published)')).toBeVisible();

    await page.getByRole('button', { name: /Preview as Student/i }).click();
    await expect(page).toHaveURL(new RegExp(`#\\/preview\\/course\\/${courseId.toHexString()}$`));
    await expect(page.locator('.sidebar--student')).toBeVisible();
    await expect(page.locator('.sidebar--instructor')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Student' })).toBeVisible();
    await expect(page.getByText('PREVIEW MODE', { exact: true })).toBeVisible();
    await expect(page.getByText('Anonymous Student', { exact: true })).toBeVisible();
    await expect(page.getByText('Anonymous Student Preview', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Courses', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review Book', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Exam Prep', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Exit Preview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
    await expect(page.getByText(THEME_NAME)).toBeVisible();

    await page.getByRole('button', { name: 'Start →', exact: true }).click();
    await expect(page.locator('.practice-card')).toBeVisible();
    await expect(page.getByRole('heading', { name: LO_NAME, exact: true })).toBeVisible();
    await expect(page.getByText(APPROVED_STEM)).toBeVisible();
    await expect(page.getByText(DRAFT_STEM)).toHaveCount(0);
    await page.getByRole('button', { name: /Flag this question/i }).click();
    await page.getByRole('textbox', { name: /Why are you flagging/i })
      .fill('Anonymous preview isolation check');
    await page.getByRole('button', { name: 'Send flag', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Flagged');

    await page.getByRole('button', { name: /^B\s+5$/ }).click();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText(/Not quite/i)).toBeVisible();
    const storedPreviewBeforeReload = await page.evaluate(
      () => sessionStorage.getItem('financebot-anonymous-preview'),
    );
    expect(storedPreviewBeforeReload).not.toBeNull();
    await page.reload();
    await expect(page.locator('.practice-card')).toBeVisible();
    await expect(page.evaluate(
      () => sessionStorage.getItem('financebot-anonymous-preview'),
    )).resolves.toBe(storedPreviewBeforeReload);
    await page.getByRole('link', { name: 'End Session & Return', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Session Summary' })).toBeVisible();
    await expect(page.getByText('Review Book Added')).toBeVisible();
    await page.getByRole('link', { name: 'Go to Review Book', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review Book' })).toBeVisible();
    await expect(page.getByText(APPROVED_STEM)).toBeVisible();

    await expect.poll(() => previewAttemptsCol().countDocuments({ courseId })).toBe(1);
    const previewSession = await previewStudentSessionsCol().findOne({
      courseId,
      instructorPuid,
    });
    expect(previewSession?.flags).toHaveLength(1);
    expect(previewSession?.reviewBookEntries).toHaveLength(1);
    const liveCounts = await Promise.all([
      attemptsCol().countDocuments({ courseId }),
      masteryCol().countDocuments({ courseId }),
      reviewBookCol().countDocuments({ courseId }),
      flagsCol().countDocuments({ courseId }),
      notificationsCol().countDocuments({ courseId }),
      sessionSummariesCol().countDocuments({ courseId }),
    ]);
    expect(liveCounts).toEqual([0, 0, 0, 0, 0, 0]);

    await page.getByRole('link', { name: 'Exit Preview', exact: true }).click();
    await expect(page.locator('.sidebar--instructor')).toBeVisible();
    await expect(page.locator('.sidebar--student')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();

    // Publication is deliberately irrelevant to preview. Flip the fixture and
    // prove the backwards-compatible legacy URL starts a new anonymous session.
    await coursesCol().updateOne({ _id: courseId }, { $set: { published: true } });
    await page.goto(`/#/instructor/course/${courseId.toHexString()}/preview`);
    await expect(page.locator('.sidebar--student')).toBeVisible();
    await page.getByRole('button', { name: 'Start →', exact: true }).click();
    await expect(page.getByText(APPROVED_STEM)).toBeVisible();
    await expect(previewAttemptsCol().countDocuments({ courseId })).resolves.toBe(1);
    expect(pageErrors).toEqual([]);
  });

  test('broadcasts a TEST flag across open tabs and lets the instructor process it without student side effects', async ({ page, context }) => {
    if (!approvedQuestionId) throw new Error('Approved Preview fixture was not created.');
    const instructorPage = await context.newPage();
    await instructorPage.goto(`/#/instructor/course/${courseId.toHexString()}`);
    await expect(instructorPage.getByRole('heading', { name: COURSE_NAME })).toBeVisible();

    await page.goto(`/#/instructor/course/${courseId.toHexString()}`);
    await page.getByRole('button', { name: /Preview as Student/i }).click();
    await page.getByRole('button', { name: 'Start →', exact: true }).click();
    await expect(page.getByText(APPROVED_STEM)).toBeVisible();

    await page.getByRole('button', { name: /Flag this question/i }).click();
    await page.getByRole('textbox', { name: /Why are you flagging/i })
      .fill('Cross-tab test flag');
    await page.getByRole('checkbox', { name: /Send as a test flag to Instructor Queue/i }).check();
    await page.getByRole('button', { name: 'Send flag', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Flagged');

    // BroadcastChannel invalidates the other tab immediately; this assertion
    // intentionally completes well inside the 30-second polling fallback.
    await expect(instructorPage.locator('.notif-bell__badge')).toBeVisible({ timeout: 5_000 });
    await instructorPage.getByRole('button', { name: /Notifications/ }).click();
    await expect(instructorPage.getByText(/Test flag from Instructor Preview/)).toBeVisible();

    await instructorPage.goto(`/#/instructor/course/${courseId.toHexString()}/flags`);
    await expect(instructorPage.getByText('TEST · Instructor Preview')).toBeVisible();
    await expect(instructorPage.locator('.flag-row__reason').filter({ hasText: 'Cross-tab test flag' })).toBeVisible();
    await instructorPage.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(instructorPage.getByRole('heading', { name: 'Instructor Preview Test Flag' })).toBeVisible();
    await expect(instructorPage.getByText(/changes the real Question Bank/)).toBeVisible();

    const editedStem = `${APPROVED_STEM} (verified)`;
    await instructorPage.locator('.question-stem-input').fill(editedStem);
    await instructorPage.getByRole('button', { name: 'Save & Update Question Bank' }).click();
    await expect(instructorPage).toHaveURL(new RegExp(`/flags$`));

    const [storedFlag, storedQuestion, storedVersion] = await Promise.all([
      flagsCol().findOne({
        courseId,
        questionId: approvedQuestionId,
        source: 'instructor-preview-test',
      }),
      questionsCol().findOne({ _id: approvedQuestionId }),
      questionVersionsCol().findOne({ questionId: approvedQuestionId }, { sort: { version: -1 } }),
    ]);
    expect(storedFlag?.state).toBe('resolved-corrected');
    expect(storedQuestion?.state).toBe('approved');
    expect(storedVersion?.stem).toBe(editedStem);

    const recipients = await notificationsCol()
      .find({ courseId })
      .project({ recipientPuid: 1 })
      .toArray();
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients.every((notification) => notification.recipientPuid === instructorPuid)).toBe(true);
  });
});
