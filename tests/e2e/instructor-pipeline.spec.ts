import { test, expect, type Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
import path from 'node:path';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  previewAttemptsCol,
  previewStudentSessionsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

// Happy-path e2e for Task 15 Task H: an instructor creates a course, builds
// its Topic/LO structure, uploads a material, gets a question into Approved
// state, and publishes the course. Mirrors practice-loop.spec.ts's harness
// conventions (global-setup's real SAML session; HTTP routes for anything
// that has one; questions.service.createQuestion for the one authoring gap
// that doesn't — see that spec's module comment for why).
//
// Shell bootstrap note: main.ts's `isInstructor()` (and therefore which
// shell + route table `bootstrap()` wires up) is decided ONCE per page load
// from the session's `courseRoles` snapshot (GET /api/auth/me). A brand-new
// `faculty` user with zero prior courses has no `instructor` courseRole yet,
// so their very first page load would render the DEFAULT (non-green) shell,
// whose router doesn't even register `#/instructor/...` paths — the My
// Courses "+ Create course" button (rendered there too, via home.ts's
// `role === 'instructor'` branch, gated on CWL `faculty` affiliation, not
// courseRoles) would navigate to a path that shell's router can't resolve, a
// dead end. `beforeAll` below seeds one throwaway course over HTTP (same
// style as practice-loop.spec.ts's beforeAll) purely to grant that
// courseRole before the browser ever loads a page in this spec; it is never
// asserted against. The course actually driven through "Create Course" in
// the test body is a separate, second course.

const FIXTURE_PATH = path.join(__dirname, '../fixtures/sample-material.md');
const FIXTURE_NAME = 'sample-material.md';

const COURSE_NAME = 'Instructor Pipeline E2E Course';
const COURSE_CODE = 'FIN-INSTR-E2E';
const COURSE_TERM = '2026W';
const TOPIC_NAME = 'Capital Budgeting (E2E)';
const LO_NAME = 'Evaluate NPV of a project (E2E)';
// This fixture is deliberately conceptual: the pipeline spec verifies the
// Instructor workflow, while dedicated numeric specs own parameterization and
// evaluator proofs. A numerical stand-in without a proof is correctly rejected
// by the fail-closed numeric serving gate.
const STEM = 'Which statement best describes net present value when evaluating a project?';
const CORRECT_OPTION = 'It discounts future cash flows and subtracts the initial investment.';

let bootstrapCourseId = '';
let courseId = '';
// Create Course splits the term across two <select>s — Academic Year over a
// rolling window computed from the clock, and the four UBC terms
// (client/src/views/instructor/courses.ts). No year literal stays valid
// forever, so the spec reads the first offered year and rebuilds the combined
// term string the course record actually stores.
let selectedTerm = '';
let themeId = '';
let loId = '';

interface CourseTreeResponse {
  themes: Array<{ _id: string; name: string; los?: Array<{ _id: string; name: string }> }>;
}

/** Fetches the course hierarchy over the same real HTTP route api.ts's
 * `getCourseTree` uses, via the already-authenticated `page.request` (shares
 * the `faculty` session's cookies) — needed here because the UI itself never
 * surfaces raw theme/LO ids, and the seeded question in the "seed" step
 * below needs them. */
async function fetchTree(page: Page, id: string): Promise<CourseTreeResponse> {
  const res = await page.request.get(`/api/courses/${id}`);
  return (await res.json()) as CourseTreeResponse;
}

test.describe('instructor pipeline', () => {
  test.use({ storageState: AUTH_FILE }); // faculty session

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const res = await context.request.post('/api/courses', {
      data: { name: 'Instructor Pipeline E2E Bootstrap Course', courseCode: 'FIN-INSTR-BOOT', term: COURSE_TERM },
    });
    const created = (await res.json()) as { _id: string };
    bootstrapCourseId = created._id;
    await context.close();
  });

  // Cleans up the courses/themes/LOs/questions this run created against the
  // shared dev Mongo (see practice-loop.spec.ts's afterAll for the same
  // rationale). Remove the matching Instructor role grants as well so repeated
  // local runs do not leave stale course ids in the shared faculty user.
  test.afterAll(async () => {
    await connectMongo();
    const ids = [bootstrapCourseId, courseId].filter(Boolean).map((id) => new ObjectId(id));
    if (ids.length === 0) return;
    const questions = await questionsCol()
      .find({ courseId: { $in: ids } })
      .toArray();
    const questionIds = questions.map((q) => q._id);
    await Promise.all([
      questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
      questionsCol().deleteMany({ courseId: { $in: ids } }),
      previewAttemptsCol().deleteMany({ courseId: { $in: ids } }),
      previewStudentSessionsCol().deleteMany({ courseId: { $in: ids } }),
      losCol().deleteMany({ courseId: { $in: ids } }),
      themesCol().deleteMany({ courseId: { $in: ids } }),
      coursesCol().deleteMany({ _id: { $in: ids } }),
      usersCol().updateMany(
        { uid: 'faculty-user' },
        { $pull: { courseRoles: { courseId: { $in: ids } } } },
      ),
    ]);
  });

  test('creates a course, builds structure, uploads a material, approves a seeded question, and publishes', async ({ page }) => {
    await test.step('log in and land on the instructor shell (My Courses)', async () => {
      // Navigate to My Courses explicitly rather than relying on where `/`
      // lands. main.ts:345 makes the root fallback role-dependent — `isAdmin`
      // goes to #/admin/accounts, everyone else to #/instructor/courses — and
      // `isAdmin` is written at first login from ADMIN_CWL_ALLOWLIST and never
      // revoked when that list changes. So `page.goto('/')` reaching My Courses
      // depends on whether the shared dev database happens to have the faculty
      // user flagged admin, which is ambient state this spec does not own.
      // core-loop-demo.spec.ts navigates explicitly for the same reason.
      await page.goto('/#/instructor/courses');
      await expect(page.getByRole('heading', { name: 'My Courses' })).toBeVisible();
    });

    await test.step('create course', async () => {
      await page.getByRole('button', { name: '+ Create course' }).click();
      await expect(page.getByRole('heading', { name: 'Create Course' })).toBeVisible();
      await page.locator('#course-identity').fill(`${COURSE_CODE} - ${COURSE_NAME}`);
      await page.locator('#course-section').fill('101');
      const yearSelect = page.locator('#course-academic-year');
      const termSelect = page.locator('#course-term');
      const academicYear = String(await yearSelect.locator('option').first().getAttribute('value'));
      expect(academicYear).toMatch(/^\d{4}\/\d{2}$/);
      await yearSelect.selectOption(academicYear);
      await termSelect.selectOption('Winter Term 1');
      selectedTerm = `Winter Term 1, ${academicYear}`;
      await page.getByRole('button', { name: 'Create course', exact: true }).click();
      await page.waitForURL(/\/instructor\/course\/[^/]+$/);
      const match = /\/instructor\/course\/([^/?]+)$/.exec(page.url());
      courseId = match?.[1] ?? '';
      expect(courseId).toBeTruthy();
      await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();

      const duplicateResponse = await page.request.post('/api/courses', {
        data: {
          name: COURSE_NAME,
          courseCode: COURSE_CODE,
          section: '101',
          term: selectedTerm,
        },
      });
      expect(duplicateResponse.status()).toBe(409);
      await expect(duplicateResponse.json()).resolves.toEqual({ error: 'course-already-exists' });
    });

    await test.step('keep blocked Preview inside the guide', async () => {
      await page.getByRole('link', { name: /5\. Student preview: Waiting for Approved questions/ }).click();
      const guide = page.getByRole('dialog', { name: 'Prepare this course, one step at a time' });
      await expect(guide).toBeVisible();
      await expect(guide.getByRole('heading', { name: 'Test the real student experience' })).toBeVisible();
      await expect(guide.getByRole('button', { name: 'Approve a question before preview' })).toBeDisabled();
      expect(page.url()).toContain(`/#/instructor/course/${courseId}`);
      await guide.getByRole('button', { name: 'Close course setup guide' }).click();
    });

    await test.step('accept the term-aware suggested dates through the first Next Action', async () => {
      await page.getByRole('button', { name: /Complete course settings/ }).click();
      const datesDialog = page.getByRole('dialog', { name: 'Set course dates' });
      await expect(datesDialog).toBeVisible();
      await expect(datesDialog.getByLabel('Course starts')).toHaveValue('2026-09-08');
      await expect(datesDialog.getByLabel('Course ends')).toHaveValue('2026-12-07');
      await datesDialog.getByRole('button', { name: 'Save dates' }).click();
      await expect(datesDialog).toBeHidden();
      await expect(page.getByRole('button', { name: /Start building course knowledge/ })).toBeVisible();
    });

    await test.step('add a Topic and Learning Objective through the next guided action', async () => {
      await page.getByRole('button', { name: /Start building course knowledge/ }).click();
      const guide = page.getByRole('dialog', { name: 'Prepare this course, one step at a time' });
      await expect(guide.getByRole('heading', { name: 'How do you want to define the course?' })).toBeVisible();
      await guide.getByRole('button', { name: /I already have Learning Objectives/ }).click();
      await expect(guide.getByRole('heading', { name: 'Add your existing Learning Objectives' })).toBeVisible();
      await guide.getByLabel('Topic name', { exact: true }).fill(TOPIC_NAME);
      await guide.locator('.course-setup-guide__lo-input').fill(`1. ${LO_NAME}\n- ${LO_NAME.toLowerCase()}`);
      await guide.getByRole('button', { name: 'Save Learning Objectives' }).click();
      await expect(guide.getByRole('heading', { name: 'Add the sources the course should trust' })).toBeVisible();
      await guide.getByRole('button', { name: 'Close course setup guide' }).click();

      const tree = await fetchTree(page, courseId);
      expect(tree.themes).toHaveLength(1);
      expect(tree.themes[0].name).toBe(TOPIC_NAME);
      expect(tree.themes[0].los).toHaveLength(1);
      expect(tree.themes[0].los?.[0].name).toBe(LO_NAME);
      themeId = tree.themes[0]._id;
      loId = tree.themes[0].los?.[0]._id ?? '';
      expect(themeId).toBeTruthy();
      expect(loId).toBeTruthy();
    });

    await test.step('upload a fixture material', async () => {
      await page.getByRole('link', { name: 'Course Materials' }).click();
      await expect(page.getByRole('heading', { name: 'Course Knowledge Workspace' })).toBeVisible();

      // The upload zone's real `<input type=file>` is intentionally hidden
      // (instructor-ui.ts's uploadZone) behind a "Browse files" button;
      // Playwright's setInputFiles does not require it to be visible.
      await page.locator('.upload-zone__input').setInputFiles(FIXTURE_PATH);
      await expect(page.locator('.workspace-file__name')).toHaveText(FIXTURE_NAME);
      // Ingest is async — the row's status may still read Processing here
      // (Task H brief: "status may be processing"); either is a pass.
      const materialRow = page.locator('.workspace-file').filter({ hasText: FIXTURE_NAME });
      await expect(materialRow.locator('.workspace-file__meta')).toContainText(/processing|queued|parsing|chunking|embedding|indexing|classifying|ready/);
    });

    await test.step('seed a question ready to approve (no live LLM in this environment)', async () => {
      // Generation needs a real model — the live-LLM path is exercised by
      // the separate, gated test below (`test.skip()` called mid-test aborts
      // the WHOLE test at that point, so a single test can't literally
      // "skip step 4 and keep going" — see that test's comment). Here, seed
      // a question the same way practice-loop.spec.ts does for its one
      // authoring gap (no HTTP route creates a bare Question — only the
      // generation pipeline or questions.service.createQuestion do), and
      // stop at 'pending-review' rather than 'approved': the next step's
      // Approve click needs a real state transition to assert, not a fait
      // accompli.
      await connectMongo();
      const { questionId } = await createQuestion({
        courseId: new ObjectId(courseId),
        loIds: [new ObjectId(loId)],
        themeIds: [new ObjectId(themeId)],
        type: 'mcq',
        stem: STEM,
        difficulty: 'easy',
        createdBy: 'e2e-seed',
        options: [
          { key: 'A', text: CORRECT_OPTION, role: 'correct', explanation: 'NPV compares discounted future cash flows with the investment required today.' },
          { key: 'B', text: 'It adds all future cash flows without discounting them.', role: 'common-misconception', explanation: 'Ignoring timing overstates cash flows received later.' },
          { key: 'C', text: 'It reports only the project’s initial investment.', role: 'clearly-wrong', explanation: 'NPV also includes the discounted value of future cash flows.' },
          { key: 'D', text: 'It measures accounting profit without considering cash flows.', role: 'partially-correct', explanation: 'NPV is a discounted cash-flow measure, not an accounting-profit measure.' },
        ],
      });
      const res = await page.request.post(`/api/questions/${questionId.toString()}/transition`, { data: { to: 'pending-review' } });
      expect(res.ok()).toBeTruthy();
    });

    await test.step('approve the question from the Review Queue', async () => {
      await page.getByRole('link', { name: 'Review Queue' }).click();
      await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

      const row = page.locator('.queue-table__rows .queue-row', { hasText: STEM.slice(0, 30) });
      await expect(row).toBeVisible();
      await expect(row.getByText('Pending Review')).toBeVisible();

      await row.getByRole('button', { name: 'Approve', exact: true }).click();
      // Approved questions leave the awaiting-review queue immediately.
      await expect(row).toHaveCount(0);
    });

    await test.step('complete the real isolated Student Preview stage', async () => {
      await page.getByRole('link', { name: 'Course Dashboard' }).click();
      const previewStep = page.getByRole('link', { name: /5\. Student preview: Ready to test/ });
      await expect(previewStep).toBeVisible();
      await previewStep.click();

      await expect(page).toHaveURL(new RegExp(`#\\/preview\\/course\\/${courseId}$`));
      await expect(page.getByText('PREVIEW MODE', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Start →', exact: true }).click();
      await expect(page.getByText(STEM)).toBeVisible();
      await page.getByRole('button', { name: new RegExp(`^A\\s+${CORRECT_OPTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click();
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(page.getByText('Correct!', { exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Exit Preview', exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`#\\/instructor\\/course\\/${courseId}$`));
      await expect(page.getByRole('link', { name: /5\. Student preview: Tested recently/ })).toBeVisible();
    });

    await test.step('publish the course', async () => {
      await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
      await expect(page.locator('.page-header__subtitle')).toContainText('Sandbox (not yet published)');
      await expect(page.getByRole('heading', { name: 'Launch readiness' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Next actions' })).toBeVisible();

      // Course Home derives the one next-best task from live state. After this
      // fixture has dates, an LO, an Approved question, and a completed Preview,
      // the still-unassigned uploaded source is correctly surfaced next.
      const primaryAction = page.locator('.workflow-action--primary');
      await expect(primaryAction).toHaveCount(1);
      await expect(primaryAction).toBeVisible();
      await expect(primaryAction).toContainText('Assign course materials');
      await expect(page.getByText('NEXT STEP', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Publish Course', exact: false }).click();
      await expect(page.locator('.page-header__subtitle')).toContainText(
        `${COURSE_CODE} · Section 101 · ${selectedTerm} · Published`,
      );
    });
  });

  test('generates a question for the LO via a live LLM', async ({ page }) => {
    test.skip(!process.env.LLM_AVAILABLE, 'requires a live LLM — see .superpowers/sdd/task-15/task-h-report.md');
    // Reuses the SAME course/LO the pipeline test above created: serial
    // execution (playwright.config.ts: fullyParallel:false, workers:1)
    // guarantees that test ran first, in this file, before `afterAll` tears
    // the course down.
    test.setTimeout(180_000); // real generation can run well past the 30s default

    await page.goto(`/#/instructor/course/${courseId}/preseeding`);
    await expect(page.getByRole('heading', { name: 'Question Bank Coverage' })).toBeVisible();

    await page.getByRole('button', { name: 'Generate Questions →' }).first().click();
    await expect(page.getByRole('heading', { name: 'Generate Question with Custom Prompt' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate Question →' }).click();
    await expect(page.getByText(/Generation queued/i)).toBeVisible();

    // The generated question lands asynchronously as a Draft (202 { jobId },
    // background job) — poll the Review Queue for it rather than assume a
    // fixed delay.
    await page.getByRole('link', { name: 'Review Queue' }).click();
    await expect(page.getByText('Draft').first()).toBeVisible({ timeout: 120_000 });
  });
});
