import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from '../e2e/global-setup';
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
  sessionSummariesCol,
  examTemplatesCol,
  examAttemptsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

// Accessibility scans using axe-core. We assert WCAG 2.0/2.1 A + AA rules and
// require zero violations, so a regression (missing label, low contrast, bad
// heading order, …) fails the build.
//
// Phase 4 Task 2. Before this, the suite scanned the logged-out landing screen
// and nothing else: its two signed-in tests waited on Phase-0 selectors that no
// longer exist (a `/welcome/i` heading, and a `#/classes` route the instructor
// shell does not register), so both timed out rather than scanning anything.
// Every student practice surface and the whole instructor shell had therefore
// never been checked. Those two tests are replaced below by the surfaces the
// phase doc actually requires:
//   student    — question view (KaTeX + table), feedback under BOTH strategies,
//                Review Book, exam attempt, exam results
//   instructor — dashboard, review queue, bank, analytics

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Freeze animations so axe measures the steady-state render. Otherwise it can
 * catch the view fade-in mid-flight and report transient (not real) low
 * contrast. */
async function freezeAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation-duration: 0s !important; transition: none !important; }',
  });
}

/** Scans the current page and fails with a readable per-violation summary
 * rather than a raw object diff — `toEqual([])` on axe output is effectively
 * unreadable once there is more than one violation. */
async function expectNoViolations(page: Page, surface: string): Promise<void> {
  await freezeAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  // Include the offending selectors and axe's own failure summary: a bare rule
  // id tells you a surface is broken but not what to change, and these scans
  // are only useful if a red run is directly actionable.
  const summary = violations.flatMap((v) =>
    v.nodes.slice(0, 4).map(
      (n) =>
        `${v.impact ?? 'unknown'} · ${v.id} · ${n.target.join(' ')} · ` +
        `${(n.failureSummary ?? v.help).replace(/\s+/g, ' ').trim()}`,
    ),
  );
  expect(summary, `WCAG A/AA violations on ${surface}`).toEqual([]);
}

/** Enrols the student in the seeded course. Idempotent (ST-E02: a duplicate
 * code is an informational no-op), and called by BOTH student tests so neither
 * depends on the other having run — `-g` filtering or a reorder would otherwise
 * leave the second one staring at "You do not have access to this course." */
async function enrol(page: Page): Promise<void> {
  await page.goto('/#/');
  const code = page.getByPlaceholder('Registration code');
  await code.waitFor();
  await code.fill(registrationCode);
  await page.getByRole('button', { name: /join/i }).click();
  await expect(page.getByText(COURSE_NAME)).toBeVisible();
}

/** SP-initiated CWL login (test users' password equals their username). */
async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

const COURSE_NAME = 'A11y Scan Course';
const THEME_NAME = 'Bond Pricing (A11y)';
const LO_NAME = 'Discount a cash flow (A11y)';

// Deliberately exercises the rich-text pipeline the phase doc calls out: a
// MATCHED `$…$` pair renders as inline KaTeX (render.ts:66) and the pipe table
// renders through marked. Both produce DOM axe must be happy with — KaTeX in
// particular emits deeply nested markup with its own aria handling.
const RICH_STEM = [
  'At a discount rate of $r = 0.10$, what is the present value of the year-1 cash flow?',
  '',
  '| Year | Cash flow |',
  '| --- | --- |',
  '| 1 | 100 |',
  '| 2 | 200 |',
].join('\n');

let courseId = '';
let themeId = '';
let loId = '';
let registrationCode = '';

test('landing screen has no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /log in with cwl/i }).waitFor();
  await expectNoViolations(page, 'landing (logged out)');
});

test.describe('a11y across the signed-in surfaces', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const api = context.request;

    const course = (await (
      await api.post('/api/courses', {
        data: { name: COURSE_NAME, courseCode: 'FIN-A11Y', term: '2026W' },
      })
    ).json()) as { _id: string; registrationCode: string };
    courseId = course._id;
    registrationCode = course.registrationCode;

    const theme = (await (
      await api.post(`/api/courses/${courseId}/themes`, { data: { name: THEME_NAME } })
    ).json()) as { _id: string };
    themeId = theme._id;
    const lo = (await (
      await api.post(`/api/themes/${themeId}/los`, { data: { name: LO_NAME } })
    ).json()) as { _id: string };
    loId = lo._id;

    await api.put(`/api/courses/${courseId}/roster`, { data: { identifiers: ['student-user'] } });
    await api.post(`/api/courses/${courseId}/publish`);

    await connectMongo();

    // Two approved questions: the rich one drives the question/feedback scans
    // and the exam; the plain one gives the Strategy-A retry gate something to
    // offer (selectRetryQuestion excludes the question just answered).
    const stems = [RICH_STEM, 'What is the present value of 200 at 10% for one year?'];
    for (const [index, stem] of stems.entries()) {
      const { questionId } = await createQuestion({
        courseId: new ObjectId(courseId),
        loIds: [new ObjectId(loId)],
        themeIds: [new ObjectId(themeId)],
        type: 'mcq',
        stem,
        difficulty: 'easy',
        createdBy: 'a11y-seed',
        options: [
          { key: 'A', text: `Correct value ${index}`, role: 'correct', explanation: 'Discount the cash flow by one period.' },
          { key: 'B', text: `Misconception ${index}`, role: 'common-misconception', explanation: 'That treats the rate as a dollar amount.' },
          { key: 'C', text: `Clearly wrong ${index}`, role: 'clearly-wrong', explanation: 'That compounds forward instead of discounting.' },
          { key: 'D', text: `Partial ${index}`, role: 'partially-correct', explanation: 'Right idea, wrong period.' },
        ],
      });
      await api.post(`/api/questions/${questionId.toString()}/transition`, { data: { to: 'pending-review' } });
      await api.post(`/api/questions/${questionId.toString()}/transition`, { data: { to: 'approved' } });
    }

    // A third question left in pending-review so the Review Queue renders its
    // real table rather than an empty state.
    const { questionId: queued } = await createQuestion({
      courseId: new ObjectId(courseId),
      loIds: [new ObjectId(loId)],
      themeIds: [new ObjectId(themeId)],
      type: 'mcq',
      stem: 'Awaiting review: which factor discounts a two-year cash flow?',
      difficulty: 'medium',
      createdBy: 'a11y-seed',
      options: [
        { key: 'A', text: 'The squared discount factor', role: 'correct', explanation: 'Two periods compound the factor.' },
        { key: 'B', text: 'The same one-year factor', role: 'common-misconception', explanation: 'That discounts a single period.' },
        { key: 'C', text: 'No discounting at all', role: 'clearly-wrong', explanation: 'Future cash must be discounted.' },
        { key: 'D', text: 'Half the rate', role: 'partially-correct', explanation: 'Not how compounding works.' },
      ],
    });
    await api.post(`/api/questions/${queued.toString()}/transition`, { data: { to: 'pending-review' } });

    // A midterm template, available now, so the Exam Prep surfaces can start.
    const now = Date.now();
    await api.put(`/api/courses/${courseId}/exam-templates/midterm`, {
      data: {
        themes: [{ themeId, mcqCount: 2, tfCount: 0, pointsPerQuestion: 1 }],
        availabilityStart: new Date(now - 60 * 60 * 1000).toISOString(),
        availabilityEnd: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
        loBreakdown: true,
      },
    });

    await context.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    const questions = await questionsCol().find({ courseId: cId }).toArray();
    const questionIds = questions.map((q) => q._id);
    await Promise.all([
      questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
      questionsCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      rosterCol().deleteMany({ courseId: cId }),
      attemptsCol().deleteMany({ courseId: cId }),
      reviewBookCol().deleteMany({ courseId: cId }),
      masteryCol().deleteMany({ courseId: cId }),
      sessionSummariesCol().deleteMany({ courseId: cId }),
      examTemplatesCol().deleteMany({ courseId: cId }),
      examAttemptsCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne({ uid: 'student-user' }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('instructor surfaces have no WCAG A/AA violations', async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const page = await context.newPage();
    try {
      await page.goto(`/#/instructor/course/${courseId}`);
      await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
      await expectNoViolations(page, 'instructor course dashboard');

      await page.goto(`/#/instructor/course/${courseId}/bank`);
      await expect(page.getByRole('heading', { name: 'Question Bank' })).toBeVisible();
      await expectNoViolations(page, 'instructor question bank');

      await page.goto(`/#/instructor/course/${courseId}/queue`);
      await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
      await expectNoViolations(page, 'instructor review queue');

      await page.goto(`/#/instructor/course/${courseId}/analytics`);
      await expect(page.getByRole('heading', { name: /analytics/i }).first()).toBeVisible();
      await expectNoViolations(page, 'instructor analytics');
    } finally {
      await context.close();
    }
  });

  test('student practice surfaces have no WCAG A/AA violations', async ({ page }) => {
    await login(page, 'student');
    await enrol(page);

    await page.goto(`/#/course/${courseId}`);
    await expect(page.getByRole('heading', { name: COURSE_NAME })).toBeVisible();
    await expectNoViolations(page, 'student course home');

    await page.goto(`/#/course/${courseId}/theme/${themeId}`);
    await expect(page.locator('.progress-row', { hasText: LO_NAME })).toBeVisible();
    await expectNoViolations(page, 'student LO list');

    // Question view — the seeded stem renders inline KaTeX and a markdown table.
    await page.goto(`/#/course/${courseId}/practice/${loId}`);
    await expect(page.locator('.practice-card')).toBeVisible();
    await expectNoViolations(page, 'student question view (KaTeX + table)');

    // Strategy A: a common-misconception pick withholds the other options and
    // attaches a retry in place (attempts.service.ts decideStrategy, adaptive).
    await page.getByRole('button', { name: /Misconception/ }).first().click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.locator('.practice-card__retry')).toBeVisible();
    await expectNoViolations(page, 'student feedback — Strategy A (retry gate)');

    // Strategy B: a clearly-wrong pick gives the full reveal.
    const retry = page.locator('.practice-card__retry');
    await retry.getByRole('button', { name: /Clearly wrong/ }).first().click();
    await retry.getByRole('button', { name: 'Submit' }).click();
    await expect(retry.getByText(/not quite/i)).toBeVisible();
    await expectNoViolations(page, 'student feedback — Strategy B (full reveal)');

    await page.goto(`/#/course/${courseId}/review-book`);
    await expect(page.getByText(THEME_NAME)).toBeVisible();
    await expectNoViolations(page, 'student review book');
  });

  test('student exam surfaces have no WCAG A/AA violations', async ({ page }) => {
    // The submit control goes through a native window.confirm (exam-attempt.ts
    // :144), which Playwright dismisses by default — that would silently cancel
    // the submission and strand the test before the results view.
    page.on('dialog', (dialog) => void dialog.accept());

    await login(page, 'student');
    await enrol(page);

    await page.goto(`/#/course/${courseId}/exams`);
    await expect(page.locator('.exam-card')).toBeVisible();
    await expectNoViolations(page, 'student exam select');

    await page.getByRole('button', { name: 'Start exam' }).first().click();
    await expect(page).toHaveURL(/exam-attempt/);
    await expect(page.locator('.exam-question')).toBeVisible();
    await expectNoViolations(page, 'student exam attempt (no feedback mid-attempt)');

    // Answer every question so the results view renders a real score breakdown
    // rather than an all-unanswered edge case. One sitting draws 2 questions.
    for (;;) {
      await page.locator('.exam-options button').first().click();
      const next = page.getByRole('button', { name: 'Next', exact: true });
      if (await next.isDisabled()) break;
      await next.click();
    }

    await page.getByRole('button', { name: /^Submit exam/ }).click();
    await expect(page).toHaveURL(/results/, { timeout: 15_000 });
    await expect(page.locator('.exam-score-card')).toBeVisible();
    await expectNoViolations(page, 'student exam results');
  });
});
