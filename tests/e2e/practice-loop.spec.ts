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
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

// Happy-path e2e for Task 14 (ST-P01..P11, ST-R05): a student joins a course
// by registration code, practices a question, deliberately misses a second
// one, and finds the miss in their Review Book.
//
// Seeding note: course/theme/LO creation and the publication-state
// transitions all have real HTTP routes (server/src/routes/courses.routes.ts,
// questions.routes.ts), so beforeAll drives those over HTTP using the
// `faculty` instructor session global-setup.ts already established. Raw
// question AUTHORING has no HTTP route yet, though — per
// server/src/routes/questions.routes.ts, the only question-bank surface is
// browse/edit/transition; a brand-new Question can only be created today via
// the async LLM generation pipeline (not wired to a route in this phase) or
// directly through questions.service.createQuestion(). So this seed calls
// that service function directly (a real MongoDB connection, same as the
// running app uses) for question authoring, then walks it
// draft -> pending-review -> approved through the real transition HTTP route
// like an instructor would in the bank UI.

/** SP-initiated CWL login (test users' password equals their username). See
 * tests/e2e/classes.spec.ts, which established this pattern first. */
async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

let courseId = '';
let registrationCode = '';
const THEME_NAME = 'Time Value of Money (E2E)';
const LO_NAME = 'Compute present value (E2E)';
const STEM = 'What is the present value of $100 received in 1 year at a 10% annual discount rate?';

test.describe('practice loop (student)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ browser }) => {
    const instructorContext = await browser.newContext({ storageState: AUTH_FILE }); // faculty session
    const api = instructorContext.request;

    const courseRes = await api.post('/api/courses', {
      data: { name: 'Practice Loop E2E Course', courseCode: 'FIN-E2E', term: '2026W' },
    });
    const course = (await courseRes.json()) as { _id: string; registrationCode: string };
    courseId = course._id;
    registrationCode = course.registrationCode;

    const themeRes = await api.post(`/api/courses/${courseId}/themes`, { data: { name: THEME_NAME } });
    const theme = (await themeRes.json()) as { _id: string };

    const loRes = await api.post(`/api/themes/${theme._id}/los`, { data: { name: LO_NAME } });
    const lo = (await loRes.json()) as { _id: string };

    // `student`'s CWL uid (from the IdP's SAML attributes, not the login
    // username) is `student-user` — confirmed against the seeded users
    // collection (`db.users.findOne({ displayName: /Student/ })`). Putting
    // that identifier (or the matching email) on the roster satisfies
    // enrollByCode's roster cross-check (ST-E02); the login username alone
    // does not match.
    await api.put(`/api/courses/${courseId}/roster`, { data: { identifiers: ['student-user'] } });
    await api.post(`/api/courses/${courseId}/publish`);

    await connectMongo();
    const { questionId } = await createQuestion({
      courseId: new ObjectId(courseId),
      loIds: [new ObjectId(lo._id)],
      themeIds: [new ObjectId(theme._id)],
      type: 'mcq',
      stem: STEM,
      difficulty: 'easy',
      createdBy: 'e2e-seed',
      options: [
        { key: 'A', text: '$90.91', role: 'correct', explanation: 'PV = 100 / 1.10 = 90.91.' },
        { key: 'B', text: '$100.00', role: 'partially-correct', explanation: 'This ignores discounting entirely.' },
        { key: 'C', text: '$110.00', role: 'clearly-wrong', explanation: 'That is the future value, not present value.' },
        { key: 'D', text: '$95.00', role: 'common-misconception', explanation: 'Close, but not the exact discounted value.' },
      ],
    });

    await api.post(`/api/questions/${questionId.toString()}/transition`, { data: { to: 'pending-review' } });
    await api.post(`/api/questions/${questionId.toString()}/transition`, { data: { to: 'approved' } });

    await instructorContext.close();
  });

  // Cleans up the seeded course/theme/LO/question and any state the run
  // created on the shared dev database (roster entry, the student's
  // courseRoles grant, attempts, review-book entries) — this spec creates
  // real documents against the real Mongo the app uses, not a throwaway test
  // DB, so leaving them behind would accumulate across repeated runs.
  test.afterAll(async () => {
    if (!courseId) return;
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
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne({ uid: 'student-user' }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('joins by code, practices, misses one, and finds it in the Review Book', async ({ page }) => {
    await login(page, 'student');

    await page.goto('/#/');
    await page.getByPlaceholder('Registration code').fill(registrationCode);
    await page.getByRole('button', { name: /add a course/i }).click();
    await expect(page.getByText('FIN-E2E')).toBeVisible();

    await page.getByText('Practice Loop E2E Course').click();
    await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();
    await expect(page.getByText(THEME_NAME)).toBeVisible();

    await page.getByRole('link', { name: THEME_NAME }).click();
    await page.getByRole('link', { name: /start practice/i }).click();

    // First attempt: the correct option.
    await expect(page.locator('.practice-card')).toBeVisible();
    await page.getByRole('button', { name: /90\.91/ }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Correct!')).toBeVisible();

    await page.getByRole('button', { name: /next question/i }).click();

    // Second attempt on the (only) approved question: deliberately wrong —
    // 'clearly-wrong' under the default adaptive strategy resolves to
    // Strategy B (full reveal, no retry), keeping this happy-path spec simple.
    await expect(page.locator('.practice-card')).toBeVisible();
    await page.getByRole('button', { name: /110\.00/ }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(/not quite/i)).toBeVisible();

    await page.goto(`/#/course/${courseId}/review-book`);
    await page.getByText(THEME_NAME).click(); // expand the collapsed theme group
    await expect(page.getByText(STEM.slice(0, 40))).toBeVisible();
  });
});
