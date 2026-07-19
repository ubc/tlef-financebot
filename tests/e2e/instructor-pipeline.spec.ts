import { test, expect, type Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
import path from 'node:path';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import { coursesCol, themesCol, losCol, questionsCol, questionVersionsCol } from '../../server/src/components/mongodb/collections';
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
// Exactly one bare `$` (no closing pair) — render.ts's renderRichText treats
// a MATCHED `$...$` pair as inline KaTeX math (see its `delimiters` option),
// which would otherwise mangle this stem's text between two dollar amounts
// and break the row-text assertions below. practice-loop.spec.ts's STEM has
// the same one-`$`-only shape for the same reason.
const STEM = 'A project pays $1,200 in one year for an initial investment of 1,000 today. What is its NPV at a 10% discount rate?';

let bootstrapCourseId = '';
let courseId = '';
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
  // rationale). Like that spec, this deliberately leaves the `instructor`
  // courseRole grant(s) courses.service.createCourse's `$addToSet` put on the
  // `faculty` user in place — harmless residue on a shared dev user, and it's
  // what keeps `faculty` qualifying for the instructor shell on the very next
  // run of this (or any other instructor) spec.
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
      losCol().deleteMany({ courseId: { $in: ids } }),
      themesCol().deleteMany({ courseId: { $in: ids } }),
      coursesCol().deleteMany({ _id: { $in: ids } }),
    ]);
  });

  test('creates a course, builds structure, uploads a material, approves a seeded question, and publishes', async ({ page }) => {
    await test.step('log in and land on the instructor shell (My Courses)', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'My Courses' })).toBeVisible();
    });

    await test.step('create course', async () => {
      await page.getByRole('button', { name: '+ Create course' }).click();
      await expect(page.getByRole('heading', { name: 'Create Course' })).toBeVisible();
      await page.locator('#course-name').fill(COURSE_NAME);
      await page.locator('#course-code').fill(COURSE_CODE);
      await page.locator('#course-term').fill(COURSE_TERM);
      await page.getByRole('button', { name: 'Create course', exact: true }).click();
      await page.waitForURL(/\/instructor\/course\/[^/]+$/);
      const match = /\/instructor\/course\/([^/?]+)$/.exec(page.url());
      courseId = match?.[1] ?? '';
      expect(courseId).toBeTruthy();
      await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
    });

    await test.step('add a Topic and a Learning Objective', async () => {
      await page.getByRole('link', { name: 'Course Structure' }).click();
      await expect(page.getByRole('heading', { name: 'Course Structure' })).toBeVisible();

      await page.getByRole('button', { name: '+ Add Topic' }).click();
      await page.getByPlaceholder('Topic name').fill(TOPIC_NAME);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.locator('.tree-theme__name')).toHaveText(`Topic 1: ${TOPIC_NAME}`);

      await page.getByRole('button', { name: '+ Add LO' }).click();
      await page.getByPlaceholder('Learning Objective name').fill(LO_NAME);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.locator('.tree-lo__name')).toHaveText(`LO 1: ${LO_NAME}`);

      const tree = await fetchTree(page, courseId);
      themeId = tree.themes[0]._id;
      loId = tree.themes[0].los?.[0]._id ?? '';
      expect(themeId).toBeTruthy();
      expect(loId).toBeTruthy();
    });

    await test.step('upload a fixture material', async () => {
      await page.getByRole('link', { name: 'Course Materials' }).click();
      await expect(page.getByRole('heading', { name: 'Course Materials' })).toBeVisible();

      // The upload zone's real `<input type=file>` is intentionally hidden
      // (instructor-ui.ts's uploadZone) behind a "Browse files" button;
      // Playwright's setInputFiles does not require it to be visible.
      await page.locator('.upload-zone__input').setInputFiles(FIXTURE_PATH);
      await expect(page.locator('.material-row__name')).toHaveText(FIXTURE_NAME);
      // Ingest is async — the row's status may still read Processing here
      // (Task H brief: "status may be processing"); either is a pass.
      await expect(page.locator('.material-row__meta')).toContainText(/Processing|Ready/);
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
          { key: 'A', text: '$90.91 (NPV)', role: 'correct', explanation: 'NPV = -1000 + 1200 / 1.10 = 90.91.' },
          { key: 'B', text: '$200.00 (undiscounted profit)', role: 'partially-correct', explanation: 'This ignores discounting the future cash inflow.' },
          { key: 'C', text: '$1,200.00 (raw cash inflow)', role: 'clearly-wrong', explanation: 'That is the undiscounted future cash inflow alone.' },
          { key: 'D', text: '$0.00', role: 'common-misconception', explanation: 'Close to zero, but not the exact discounted NPV.' },
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
      await expect(row.getByText('Approved', { exact: true })).toBeVisible();
    });

    await test.step('publish the course', async () => {
      await page.getByRole('link', { name: 'Course Dashboard' }).click();
      await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
      await expect(page.locator('.page-header__subtitle')).toContainText('Sandbox (not yet published)');

      await page.getByRole('button', { name: 'Publish Course', exact: false }).click();
      await expect(page.locator('.page-header__subtitle')).toContainText(`${COURSE_CODE} · ${COURSE_TERM} · Published`);
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
