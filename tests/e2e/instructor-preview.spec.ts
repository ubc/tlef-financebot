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
// Deliberately CONCEPTUAL, not parameterized. This spec's subject is preview
// isolation, not numerics — the old "what is 2 + 2?" was a stand-in, and the
// numeric gate (design spec 2026-08-05) would refuse to serve it since it
// reads as numerical with no verification proof. Parameterizing a dummy would
// add noise; making it genuinely conceptual is the honest fix.
const APPROVED_STEM = 'In Instructor Preview, which best describes diversification?';
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
        { key: 'A', text: 'It reduces idiosyncratic risk', role: 'correct', explanation: 'Spreading holdings cancels firm-specific shocks.' },
        { key: 'B', text: 'It removes all market risk', role: 'common-misconception', explanation: 'Systematic risk cannot be diversified away.' },
        { key: 'C', text: 'It guarantees higher returns', role: 'partially-correct', explanation: 'It changes the risk profile, not expected return.' },
        { key: 'D', text: 'It concentrates holdings', role: 'clearly-wrong', explanation: 'That is the opposite of diversifying.' },
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

  // Both tests flag the SAME approved question as the same instructor, and
  // Preview is now unconditionally TEST-queued, so the first test leaves an
  // open live flag behind. `flagQuestion()` dedupes on (puid, current version,
  // state:'open'), which would turn the second test's flag into a no-op: it
  // would fail at its two reason assertions below, which look for
  // 'Cross-tab test flag' and would find the first test's reason instead, while
  // its notification-badge assertion passed for the wrong reason on the first
  // test's leftover unread notification. Loud, but wrong about what broke.
  // Clearing the live queue between tests keeps each one's counts its own.
  test.beforeEach(async () => {
    await Promise.all([
      flagsCol().deleteMany({ courseId }),
      notificationsCol().deleteMany({ courseId }),
    ]);
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

    // Two submit-looking buttons at once is what made a PI reviewer click the
    // answer Submit expecting it to send the flag (2026-08-08).
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0);

    // The explanation moved off the label and behind the ⓘ, which describes it
    // for screen readers whatever the pointer is doing.
    await expect(page.getByText(/does not count toward student analytics/)).toHaveCount(0);
    // There is no longer a choice to make: Preview always files the TEST flag.
    await expect(page.locator('.practice-card').getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByText('Sends a Preview test flag')).toBeVisible();

    const testFlagTip = page.getByRole('button', { name: 'About the Preview test flag' });
    const tipBubbleId = await testFlagTip.getAttribute('aria-describedby');
    expect(tipBubbleId).toBeTruthy();
    await expect(page.locator(`#${tipBubbleId}`))
      .toContainText('files the flag in your Flag Queue tagged as a Preview test');
    // The second sentence described an unchecked state that no longer exists.
    await expect(page.locator(`#${tipBubbleId}`)).not.toContainText('Unchecked');
    // One bubble per card, shared by the ⓘ trigger and the Send flag button —
    // not a stray duplicate from the retry-in-place recursion.
    await expect(page.locator(`#${tipBubbleId}`)).toHaveCount(1);

    // Sending is now the ONLY action, so the consequence has to be announced on
    // the button that takes it — the pre-checked checkbox that used to carry
    // this `aria-describedby` is gone, and the accessibility reason for it is
    // not. axe cannot catch the regression: the button keeps a valid accname
    // either way.
    const sendFlag = page.getByRole('button', { name: 'Send flag', exact: true });
    await expect(sendFlag).toHaveAttribute('aria-describedby', tipBubbleId ?? '');
    await sendFlag.click();
    await expect(page.getByRole('status')).toContainText('Flagged');
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /removes all market risk/ }).click();
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
    await page.getByRole('button', { name: /expand entries/i }).click();
    await expect(page.getByText(APPROVED_STEM)).toBeVisible();

    await expect.poll(() => previewAttemptsCol().countDocuments({ courseId })).toBe(1);
    const previewSession = await previewStudentSessionsCol().findOne({
      courseId,
      instructorPuid,
    });
    expect(previewSession?.flags).toHaveLength(1);
    expect(previewSession?.reviewBookEntries).toHaveLength(1);
    // Attempts, mastery, Review Book and session summaries stay at zero — that
    // is the isolation guarantee and it is unchanged. Flags and notifications
    // are 1 because Preview now always files the TEST queue item; that single
    // exception is documented in docs/api-contract.md and asserted below to be
    // genuinely a TEST flag rather than a leaked student one.
    const liveCounts = await Promise.all([
      attemptsCol().countDocuments({ courseId }),
      masteryCol().countDocuments({ courseId }),
      reviewBookCol().countDocuments({ courseId }),
      flagsCol().countDocuments({ courseId }),
      notificationsCol().countDocuments({ courseId }),
      sessionSummariesCol().countDocuments({ courseId }),
    ]);
    expect(liveCounts).toEqual([0, 0, 0, 1, 1, 0]);
    const liveFlags = await flagsCol().find({ courseId }).toArray();
    expect(liveFlags).toHaveLength(1);
    expect(liveFlags[0]?.source).toBe('instructor-preview-test');
    expect(liveFlags[0]?.reason).toBe('Anonymous preview isolation check');

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
    // No opt-in step: the checkbox is gone and Preview always TEST-queues, so
    // the cross-tab broadcast below has to happen off the plain Send flag
    // click. Assert the control's absence — a re-introduced checkbox defaulting
    // to unchecked would otherwise make this test silently stop covering the
    // broadcast.
    await expect(page.locator('.practice-card').getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Send flag', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Flagged');

    // BroadcastChannel invalidates the other tab immediately; this assertion
    // intentionally completes well inside the 30-second polling fallback.
    await expect(instructorPage.locator('.notif-bell__badge')).toBeVisible({ timeout: 5_000 });
    await instructorPage.getByRole('button', { name: /Notifications/ }).click();
    await expect(instructorPage.getByText(/Cross-tab test flag/).first()).toBeVisible();
    await instructorPage.getByRole('button', { name: /Notifications/ }).click();

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
