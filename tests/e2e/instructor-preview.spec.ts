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

  test('previews published/unpublished approved content and saves no student progress', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    await page.goto(`/#/instructor/course/${courseId.toHexString()}`);
    await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
    await expect(page.getByText('Sandbox (not yet published)')).toBeVisible();

    await page.getByRole('button', { name: /Preview as Student/i }).click();
    await expect(page.getByText(/Instructor preview —/i)).toBeVisible();
    await expect(page.getByText(/No student progress, Review Book entries, flags, or analytics will be saved/i)).toBeVisible();
    await expect(page.getByText(THEME_NAME)).toBeVisible();
    await expect(page.getByText(LO_NAME)).toBeVisible();

    await page.getByRole('link', { name: new RegExp(LO_NAME) }).click();
    await expect(page.locator('.practice-card')).toBeVisible();
    await expect(page.getByText(APPROVED_STEM)).toBeVisible();
    await expect(page.getByText(DRAFT_STEM)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Flag this question/i })).toHaveCount(0);

    await page.getByRole('button', { name: /^A\s+4$/ }).click();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText('Correct!')).toBeVisible();

    await expect.poll(() => previewAttemptsCol().countDocuments({ courseId })).toBe(1);
    const liveCounts = await Promise.all([
      attemptsCol().countDocuments({ courseId }),
      masteryCol().countDocuments({ courseId }),
      reviewBookCol().countDocuments({ courseId }),
      flagsCol().countDocuments({ courseId }),
      notificationsCol().countDocuments({ courseId }),
      sessionSummariesCol().countDocuments({ courseId }),
    ]);
    expect(liveCounts).toEqual([0, 0, 0, 0, 0, 0]);

    // Publication is deliberately irrelevant to the preview endpoints. Flip
    // the same fixture to published and prove the UI remains usable without
    // creating another submission.
    await coursesCol().updateOne({ _id: courseId }, { $set: { published: true } });
    await page.goto(`/#/instructor/course/${courseId.toHexString()}/preview`);
    await page.getByRole('link', { name: new RegExp(LO_NAME) }).click();
    await expect(page.getByText(APPROVED_STEM)).toBeVisible();
    await expect(previewAttemptsCol().countDocuments({ courseId })).resolves.toBe(1);
    expect(pageErrors).toEqual([]);
  });
});
