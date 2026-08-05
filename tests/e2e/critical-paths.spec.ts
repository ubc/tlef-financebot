import { test, expect, type Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
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
  sessionSummariesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';
import {
  CORRECT_EXPLANATION,
  MISCONCEPTION_EXPLANATION,
  correctOptionText,
  misconceptionOptionText,
  numericFixture,
  optionPattern,
  wrongOptionText,
} from './numeric-fixture';

// Phase 4 Task 1 Step 2 — critical-path gap fill.
//
// Step 1's audit mapped the three required critical paths onto existing specs
// and found all three already covered:
//   (a) login -> enrol -> practice -> feedback -> Review Book  practice-loop.spec.ts
//   (b) exam integrity, no feedback leakage mid-attempt          exam-mode.spec.ts
//   (c) flag -> auto-pause -> resolve                            flag-loop.spec.ts
// plus core-loop-demo.spec.ts, which walks the whole Phase 1 demo end to end
// and closes the mastery-transition gap the audit found in (a).
//
// This file covers ONLY what none of those reach, per the plan's "gap-fill
// only — do not duplicate the three existing specs":
//   1. interrupted practice resumes with persisted mastery (ST-E03)
//   2. the Strategy-A retry gate withholds explanations until the retry
//      resolves (ST-P04) — practice-loop.spec.ts explicitly steers AROUND this
//      path, picking a clearly-wrong option to stay on Strategy B
//   3. the deferred session summary greets the student next session (ST-P10/11)
//
// Harness conventions follow practice-loop.spec.ts: global-setup's faculty
// session seeds over real HTTP routes, questions.service.createQuestion covers
// the one authoring gap with no route, and everything created is torn down
// because this runs against the shared dev Mongo.

const COURSE_NAME = 'Critical Paths E2E Course';
const THEME_NAME = 'Bond Valuation (Critical Paths)';
const LO_NAME = 'Price a coupon bond (Critical Paths)';

/** Two approved questions in the same LO. The Strategy-A retry gate needs a
 * SECOND question to offer as the retry — `selectRetryQuestion` excludes the
 * one just answered, so a single-question bank would silently degrade to a
 * full reveal and the gate would never be exercised. */
// Numerical questions must be parameterized and verified or the numeric gate
// refuses to serve them (design spec 2026-08-05). Each variant's prose lead is
// distinct so the row lookups below can still tell them apart by stem prefix.
const QUESTIONS = [
  numericFixture('For a zero-coupon corporate bond,', 2),
  numericFixture('For a zero-coupon treasury note,', 3),
];

/** SP-initiated CWL login (test users' password equals their username). */
async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

/** Reads the question currently rendered in `card` and returns its fixture
 * together with the RENDERED text. The questions are parameterized, so option
 * values differ per serve — callers recompute them from `rendered` rather than
 * reading a constant off the fixture. */
async function askedIn(
  card: ReturnType<Page['locator']>,
): Promise<{ fixture: (typeof QUESTIONS)[number]; rendered: string }> {
  const rendered = await card.innerText();
  const fixture = QUESTIONS.find((q) => rendered.includes(q.stem.slice(0, 30)));
  expect(fixture, `card should render one of the seeded questions; got:\n${rendered}`).toBeTruthy();
  return { fixture: fixture!, rendered };
}

let courseId = '';
let themeId = '';
let loId = '';
let registrationCode = '';

test.describe('Phase 4 critical paths (gap fill)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const api = context.request;

    // strategy-a unconditionally, so the retry gate fires on ANY miss rather
    // than only on a common-misconception pick under `adaptive`. That keeps
    // the gate assertion independent of which distractor the ladder serves.
    const courseRes = await api.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: 'FIN-CRIT-E2E', term: '2026W' },
    });
    const course = (await courseRes.json()) as { _id: string; registrationCode: string };
    courseId = course._id;
    registrationCode = course.registrationCode;
    await api.patch(`/api/courses/${courseId}`, { data: { feedbackStrategy: 'strategy-a' } });

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
    for (const q of QUESTIONS) {
      const { questionId } = await createQuestion({
        courseId: new ObjectId(courseId),
        loIds: [new ObjectId(loId)],
        themeIds: [new ObjectId(themeId)],
        type: 'mcq',
        difficulty: 'easy',
        createdBy: 'e2e-critical-paths',
        ...q,
      });
      await api.post(`/api/questions/${questionId.toString()}/transition`, { data: { to: 'pending-review' } });
      await api.post(`/api/questions/${questionId.toString()}/transition`, { data: { to: 'approved' } });
    }

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
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne({ uid: 'student-user' }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('interrupted practice resumes with persisted mastery and discards the unsubmitted question (ST-E03)', async ({
    page,
  }) => {
    await login(page, 'student');
    await page.goto('/#/');
    await page.getByPlaceholder('Registration code').fill(registrationCode);
    await page.getByRole('button', { name: /join/i }).click();
    await expect(page.getByText(COURSE_NAME)).toBeVisible();

    await page.goto(`/#/course/${courseId}/practice/${loId}`);
    const card = page.locator('.practice-card').first();
    const first = await askedIn(card);
    await page.getByRole('button', { name: optionPattern(correctOptionText(first.rendered)) }).first().click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();

    // Mastery after one scored attempt, read from the LO list.
    await page.goto(`/#/course/${courseId}/theme/${themeId}`);
    const loRow = page.locator('.progress-row', { hasText: LO_NAME });
    await expect(loRow).toContainText('In progress');

    // Interruption: select an answer on the NEXT question but never submit it,
    // then reload. ST-E03 allows exactly one unsubmitted question to be lost.
    await page.goto(`/#/course/${courseId}/practice/${loId}`);
    const second = await askedIn(page.locator('.practice-card').first());
    await page.getByRole('button', { name: optionPattern(wrongOptionText(second.rendered)) }).first().click();
    await page.reload();

    // The unsubmitted selection is gone — a fresh card, nothing pre-selected,
    // and no feedback from the abandoned question.
    await expect(page.locator('.practice-card').first()).toBeVisible();
    await expect(page.locator('.practice-card [aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByText('Correct!')).toHaveCount(0);
    await expect(page.getByText(/not quite/i)).toHaveCount(0);

    // …but the mastery earned before the interruption survived it.
    await page.goto(`/#/course/${courseId}/theme/${themeId}`);
    await expect(page.locator('.progress-row', { hasText: LO_NAME })).toContainText('In progress');

    await connectMongo();
    const profile = await masteryCol().findOne({ courseId: new ObjectId(courseId), loId: new ObjectId(loId) });
    expect(profile, 'the pre-interruption attempt should be persisted server-side').toBeTruthy();
    expect(profile!.attemptCount).toBe(1);
  });

  test('the Strategy-A retry gate withholds the other options until the retry resolves (ST-P04)', async ({
    page,
  }) => {
    await login(page, 'student');
    await page.goto(`/#/course/${courseId}/practice/${loId}`);

    const card = page.locator('.practice-card').first();
    const asked = await askedIn(card);
    const other = QUESTIONS.find((q) => q.stem !== asked.fixture.stem)!;

    // Must be the common-misconception option specifically: that role is what
    // opens the Strategy A retry gate.
    await page.getByRole('button', { name: optionPattern(misconceptionOptionText(asked.rendered)) }).first().click();
    await page.getByRole('button', { name: 'Submit' }).click();

    // Chosen-only reveal: the student sees why THEIR pick was wrong…
    await expect(page.getByText(MISCONCEPTION_EXPLANATION)).toBeVisible();
    // …and the correct answer's explanation is withheld — not merely hidden by
    // CSS. Assert on page content so a rendered-but-invisible leak still fails.
    await expect(page.locator('body')).not.toContainText(CORRECT_EXPLANATION);

    // The gate offers a DIFFERENT question testing the same concept, in place.
    const retryPanel = page.locator('.practice-card__retry');
    await expect(retryPanel).toBeVisible();
    await expect(retryPanel).toContainText(other.stem.slice(0, 30));

    // Resolving the retry correctly reveals that question fully.
    const retryRendered = await retryPanel.innerText();
    await retryPanel
      .getByRole('button', { name: optionPattern(correctOptionText(retryRendered)) })
      .first()
      .click();
    await retryPanel.getByRole('button', { name: 'Submit' }).click();
    await expect(retryPanel.getByText(CORRECT_EXPLANATION)).toBeVisible();
  });

  test('a deferred session summary greets the student on their next visit (ST-P10, ST-P11)', async ({ page }) => {
    await login(page, 'student');

    // Practise once so there is a session worth summarising.
    await page.goto(`/#/course/${courseId}/practice/${loId}`);
    const asked = await askedIn(page.locator('.practice-card').first());
    await page.getByRole('button', { name: optionPattern(correctOptionText(asked.rendered)) }).first().click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();

    // "Session Summary →" carries `?since=`, which session-summary.ts:295
    // treats as ENDING the session: it computes and stores the deferred
    // summary in one step and confirms inline. The separate "Defer to next
    // session" button is the no-`since` path, reached when reviewing a
    // previous session rather than closing the current one.
    await page.getByRole('link', { name: /session summary/i }).click();
    await expect(page.getByRole('heading', { name: 'Session Summary' })).toBeVisible();
    await expect(page.getByText('Session ended — this will greet you next time.')).toBeVisible();

    // Next visit to the course home surfaces it (ST-P11).
    await page.goto(`/#/course/${courseId}`);
    await expect(page.getByText(/Welcome back — last time you covered/)).toBeVisible();

    await connectMongo();
    const stored = await sessionSummariesCol().findOne({ courseId: new ObjectId(courseId) });
    expect(stored, 'the deferred summary should be persisted, not just rendered').toBeTruthy();
  });
});
