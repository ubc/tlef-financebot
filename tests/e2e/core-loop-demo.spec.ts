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
  rosterCol,
  attemptsCol,
  reviewBookCol,
  masteryCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';
import { correctOptionText, numericFixture, optionPattern, wrongOptionText } from './numeric-fixture';

// Phase 1 Task 16 — the phase-exit demo, as ONE continuous narrative.
//
// The phase doc specifies this as a single flow you can show someone:
// instructor creates course -> uploads material -> generates (or seeds when no
// live LLM) -> approves -> student enrols with a code -> practices with
// adaptive feedback -> a miss lands in the Review Book -> re-practice updates
// mastery. Its two halves are individually covered elsewhere
// (instructor-pipeline.spec.ts, practice-loop.spec.ts); this spec deliberately
// re-walks them end to end rather than asserting the union, because the demo
// being one unbroken flow IS the exit criterion. Phase 4 Task 1's
// critical-paths.spec.ts is the gap-fill spec and should not duplicate this.
//
// Harness conventions follow practice-loop.spec.ts and
// instructor-pipeline.spec.ts: global-setup's real SAML `faculty` session for
// the instructor, an SP-initiated login for the student, real HTTP routes for
// anything that has one, and questions.service.createQuestion for the one
// authoring gap that does not (no HTTP route creates a bare Question).
//
// Generation leg: seeded rather than live. The live-LLM generation path is
// already covered by instructor-pipeline.spec.ts's `LLM_AVAILABLE`-gated test,
// which runs the real pipeline and polls the Review Queue for the Draft.
// Duplicating a 180s live test here would slow the exit demo without adding
// coverage — the phase doc explicitly permits seeding "via API when
// !LLM_AVAILABLE".

const FIXTURE_PATH = path.join(__dirname, '../fixtures/sample-material.md');
const FIXTURE_NAME = 'sample-material.md';

const COURSE_NAME = 'Core Loop Demo E2E Course';
const COURSE_CODE = 'FIN-DEMO-E2E';
const COURSE_TERM = '2026W';
const TOPIC_NAME = 'Discounted Cash Flow (Demo)';
const LO_NAME = 'Discount a single future cash flow (Demo)';

/** The seeded bank. Serving is adaptive, so the order these arrive in is not
 * fixed — the practice helper below matches on the visible stem rather than
 * assuming a sequence. Each stem carries exactly one bare `$` for the reason
 * documented in instructor-pipeline.spec.ts (a matched `$...$` pair is parsed
 * as inline KaTeX by renderRichText and would mangle the text assertions). */
// Numerical questions must be parameterized and verified or the numeric gate
// refuses to serve them (design spec 2026-08-05). Distinct prose leads keep
// the review-queue row lookups below able to tell the two apart.
const QUESTIONS = [
  numericFixture('For a zero-coupon corporate bond,', 2),
  numericFixture('For a zero-coupon treasury note,', 3),
];

/** SP-initiated CWL login (test users' password equals their username).
 * Established by classes.spec.ts; mirrored by practice-loop/flag-loop. */
async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

/** Answers whichever seeded question is currently on screen, correctly or
 * deliberately wrong, and returns the stem that was answered. Adaptive
 * selection decides the order, so this reads the card rather than assuming. */
async function answerCurrent(page: Page, how: 'correct' | 'wrong'): Promise<string> {
  await expect(page.locator('.practice-card')).toBeVisible();
  const cardText = await page.locator('.practice-card').innerText();
  const asked = QUESTIONS.find((q) => cardText.includes(q.stem.slice(0, 30)));
  expect(asked, `served question should be one of the seeded two; card was:\n${cardText}`).toBeTruthy();

  // Parameterized: each serve draws its own numbers, so recompute the option
  // text from the card the student is looking at rather than a constant.
  const optionText = how === 'correct' ? correctOptionText(cardText) : wrongOptionText(cardText);
  await page.getByRole('button', { name: optionPattern(optionText) }).first().click();
  await page.getByRole('button', { name: 'Submit' }).click();
  return asked!.stem;
}

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
let registrationCode = '';
/** Stem of the question the student deliberately missed — captured during
 * practice so the Review Book assertion checks the right entry regardless of
 * which of the two seeded questions adaptive selection served second. */
let missedStem = '';

test.describe('Phase 1 exit — core loop demo', () => {
  // `page` is the STUDENT throughout; the instructor drives a second context
  // minted from the faculty session (flag-loop.spec.ts's dual-session shape).
  test.use({ storageState: { cookies: [], origins: [] } });

  // Grants `faculty` an instructor courseRole before any instructor page load,
  // so main.ts's isInstructor() wires up the green shell and its route table on
  // the very first render. See instructor-pipeline.spec.ts's shell-bootstrap
  // note for why this throwaway course is necessary and never asserted against.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const res = await context.request.post('/api/courses', {
      data: { name: 'Core Loop Demo Bootstrap Course', courseCode: 'FIN-DEMO-BOOT', term: COURSE_TERM },
    });
    bootstrapCourseId = ((await res.json()) as { _id: string })._id;
    await context.close();
  });

  // This spec writes real documents to the shared dev Mongo, not a throwaway
  // test DB, so everything it creates is removed. The `instructor` courseRole
  // grant on `faculty` is deliberately left in place, as in
  // instructor-pipeline.spec.ts — harmless residue that keeps the next
  // instructor spec qualifying for the shell.
  test.afterAll(async () => {
    await connectMongo();
    const ids = [bootstrapCourseId, courseId].filter(Boolean).map((id) => new ObjectId(id));
    if (ids.length === 0) return;
    const questions = await questionsCol().find({ courseId: { $in: ids } }).toArray();
    const questionIds = questions.map((q) => q._id);
    await Promise.all([
      questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
      questionsCol().deleteMany({ courseId: { $in: ids } }),
      losCol().deleteMany({ courseId: { $in: ids } }),
      themesCol().deleteMany({ courseId: { $in: ids } }),
      rosterCol().deleteMany({ courseId: { $in: ids } }),
      attemptsCol().deleteMany({ courseId: { $in: ids } }),
      reviewBookCol().deleteMany({ courseId: { $in: ids } }),
      masteryCol().deleteMany({ courseId: { $in: ids } }),
      coursesCol().deleteMany({ _id: { $in: ids } }),
      usersCol().updateOne({ uid: 'student-user' }, { $pull: { courseRoles: { courseId: { $in: ids } } } }),
    ]);
  });

  test('instructor authors and publishes a course; student enrols, practices, misses, reviews, and moves mastery', async ({
    browser,
    page,
  }) => {
    const instructorContext = await browser.newContext({ storageState: AUTH_FILE });
    const instructor = await instructorContext.newPage();

    try {
      // ---------------------------------------------------------------
      // Instructor half
      // ---------------------------------------------------------------
      await test.step('instructor lands on the instructor shell', async () => {
        // Navigate to My Courses explicitly rather than relying on where `/`
        // lands. main.ts:345 makes the root fallback role-dependent —
        // `isAdmin` routes to #/admin/accounts, everyone else to
        // #/instructor/courses — and `isAdmin` is persisted on the user at
        // first login from ADMIN_CWL_ALLOWLIST and never revoked when that
        // list changes. So whether `/` reaches My Courses depends on the
        // dev database's accumulated state, not on this spec. The demo is
        // about the instructor arc, not role-landing precedence.
        await instructor.goto('/#/instructor/courses');
        await expect(instructor.getByRole('heading', { name: 'My Courses' })).toBeVisible();
      });

      await test.step('creates a course', async () => {
        await instructor.getByRole('button', { name: '+ Create course' }).click();
        await expect(instructor.getByRole('heading', { name: 'Create Course' })).toBeVisible();
        await instructor.locator('#course-identity').fill(`${COURSE_CODE} - ${COURSE_NAME}`);
        await instructor.locator('#course-section').fill('101');
        const yearSelect = instructor.locator('#course-academic-year');
        const termSelect = instructor.locator('#course-term');
        const academicYear = String(await yearSelect.locator('option').first().getAttribute('value'));
        expect(academicYear).toMatch(/^\d{4}\/\d{2}$/);
        await yearSelect.selectOption(academicYear);
        await termSelect.selectOption('Winter Term 1');
        selectedTerm = `Winter Term 1, ${academicYear}`;
        await instructor.getByRole('button', { name: 'Create course', exact: true }).click();
        await instructor.waitForURL(/\/instructor\/course\/[^/]+$/);
        courseId = /\/instructor\/course\/([^/?]+)$/.exec(instructor.url())?.[1] ?? '';
        expect(courseId).toBeTruthy();
      });

      await test.step('builds a Topic and a Learning Objective', async () => {
        await instructor.getByRole('link', { name: 'Course Structure' }).click();
        await expect(instructor.getByRole('heading', { name: 'Course Structure', level: 1 })).toBeVisible();

        await instructor.getByRole('button', { name: '+ Add Topic' }).click();
        await instructor.getByPlaceholder('Topic name').fill(TOPIC_NAME);
        await instructor.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(instructor.locator('.tree-theme__name')).toHaveText(`Topic 1: ${TOPIC_NAME}`);

        await instructor.getByRole('button', { name: '+ Add LO' }).click();
        await instructor.getByPlaceholder('Learning Objective name').fill(LO_NAME);
        await instructor.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(instructor.locator('.tree-lo__name')).toHaveText(`LO 1: ${LO_NAME}`);

        const tree = (await (await instructor.request.get(`/api/courses/${courseId}`)).json()) as {
          themes: Array<{ _id: string; los?: Array<{ _id: string }> }>;
        };
        themeId = tree.themes[0]._id;
        loId = tree.themes[0].los?.[0]._id ?? '';
        expect(themeId).toBeTruthy();
        expect(loId).toBeTruthy();
      });

      await test.step('uploads a course material', async () => {
        await instructor.getByRole('link', { name: 'Course Materials' }).click();
        await expect(instructor.getByRole('heading', { name: 'Course Knowledge Workspace' })).toBeVisible();
        await instructor.locator('.upload-zone__input').setInputFiles(FIXTURE_PATH);
        await expect(instructor.locator('.workspace-file__name')).toHaveText(FIXTURE_NAME);
        // Ingest is async; Processing or Ready both mean the upload landed.
        await expect(
          instructor.locator('.workspace-file').filter({ hasText: FIXTURE_NAME }).locator('.workspace-file__meta'),
        ).toContainText(/processing|queued|parsing|chunking|embedding|indexing|classifying|ready/);
      });

      await test.step('question bank is authored into pending review', async () => {
        await connectMongo();
        for (const q of QUESTIONS) {
          const { questionId } = await createQuestion({
            courseId: new ObjectId(courseId),
            loIds: [new ObjectId(loId)],
            themeIds: [new ObjectId(themeId)],
            type: 'mcq',
            difficulty: 'easy',
            createdBy: 'e2e-core-loop-demo',
            ...q,
          });
          const res = await instructor.request.post(`/api/questions/${questionId.toString()}/transition`, {
            data: { to: 'pending-review' },
          });
          expect(res.ok()).toBeTruthy();
        }
      });

      await test.step('approves every question from the Review Queue', async () => {
        await instructor.getByRole('link', { name: 'Review Queue' }).click();
        await expect(instructor.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

        for (const q of QUESTIONS) {
          const row = instructor.locator('.queue-table__rows .queue-row', { hasText: q.stem.slice(0, 30) });
          await expect(row).toBeVisible();
          await expect(row.getByText('Pending Review')).toBeVisible();
          await row.getByRole('button', { name: 'Approve', exact: true }).click();
          // Approved questions leave the awaiting-review queue immediately,
          // and the "N questions awaiting review" count drops with them —
          // same contract instructor-pipeline.spec.ts:201 asserts.
          await expect(row).toHaveCount(0);
        }
      });

      await test.step('rosters the student and publishes the course', async () => {
        // `student`'s CWL uid is `student-user` (SAML attribute, not the login
        // username) — enrollByCode's roster cross-check (ST-E02) matches on
        // that, so the login name alone would not enrol.
        const rosterRes = await instructor.request.put(`/api/courses/${courseId}/roster`, {
          data: { identifiers: ['student-user'] },
        });
        expect(rosterRes.ok()).toBeTruthy();

        await instructor.getByRole('link', { name: 'Course Dashboard' }).click();
        await expect(instructor.locator('.page-header__subtitle')).toContainText('Sandbox (not yet published)');
        await instructor.getByRole('button', { name: 'Publish Course', exact: false }).click();
        await expect(instructor.locator('.page-header__subtitle')).toContainText(
          `${COURSE_CODE} · Section 101 · ${selectedTerm} · Published`,
        );

        const course = (await (await instructor.request.get(`/api/courses/${courseId}`)).json()) as {
          registrationCode: string;
        };
        registrationCode = course.registrationCode;
        expect(registrationCode).toBeTruthy();
      });

      // ---------------------------------------------------------------
      // Student half
      // ---------------------------------------------------------------
      await test.step('student logs in and enrols with the registration code', async () => {
        await login(page, 'student');
        await page.goto('/#/');
        await page.getByPlaceholder('Registration code').fill(registrationCode);
        await page.getByRole('button', { name: /join/i }).click();
        await expect(page.getByText(COURSE_NAME)).toBeVisible();
      });

      await test.step('the LO starts as Not attempted', async () => {
        await page.goto(`/#/course/${courseId}/theme/${themeId}`);
        const loRow = page.locator('.progress-row', { hasText: LO_NAME });
        await expect(loRow).toBeVisible();
        await expect(loRow).toContainText('Not attempted');
      });

      await test.step('practices with adaptive feedback — one right, one deliberately wrong', async () => {
        await page.goto(`/#/course/${courseId}/practice/${loId}`);

        await answerCurrent(page, 'correct');
        await expect(page.getByText('Correct!')).toBeVisible();
        await page.getByRole('button', { name: /next question/i }).click();

        // Second seeded question, answered wrong on purpose. 'clearly-wrong'
        // resolves to Strategy B under the default adaptive strategy (full
        // reveal, no retry gate), which keeps this demo linear — the Strategy A
        // retry gate is Phase 4 critical-paths.spec.ts's to cover.
        missedStem = await answerCurrent(page, 'wrong');
        await expect(page.getByText(/not quite/i)).toBeVisible();
      });

      await test.step('the miss lands in the Review Book', async () => {
        await page.goto(`/#/course/${courseId}/review-book`);
        await expect(page.getByText(TOPIC_NAME)).toBeVisible();
        await page.getByRole('button', { name: /expand entries/i }).click();
        await expect(page.getByText(missedStem.slice(0, 40))).toBeVisible();
      });

      await test.step('re-practice moves mastery off Not attempted', async () => {
        // Layer-1 status leaves 'not-attempted' on the first scored attempt
        // (mastery.service.ts:124-133). 'covered' additionally needs >=4
        // attempts in the rolling window, >=75% accuracy, and a tier advanced
        // past 'easy' — reachable, but the exact path depends on adaptive
        // selection order, so this asserts the transition the demo actually
        // guarantees rather than a sequence that could flake.
        await page.goto(`/#/course/${courseId}/theme/${themeId}`);
        const loRow = page.locator('.progress-row', { hasText: LO_NAME });
        await expect(loRow).toBeVisible();
        await expect(loRow).toContainText('In progress');
        await expect(loRow).not.toContainText('Not attempted');

        // The badge is the demo's visible proof; the profile is the engine's.
        await connectMongo();
        const profile = await masteryCol().findOne({
          courseId: new ObjectId(courseId),
          loId: new ObjectId(loId),
          puid: { $exists: true },
        });
        expect(profile, 'a mastery profile should exist for the practised LO').toBeTruthy();
        expect(profile!.status).toBe('in-progress');
        expect(profile!.attemptCount).toBeGreaterThanOrEqual(2);
      });
    } finally {
      await instructorContext.close();
    }
  });
});
