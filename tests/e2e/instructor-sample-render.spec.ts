// The instructor's "what a student sees" panel must RENDER markdown + KaTeX,
// not print its source. It printed raw strings until 2026-08-13, so an
// instructor approving a question read LaTeX source where the student sees
// maths — which defeats the one thing the panel exists for and hid broken
// LaTeX until a student hit it.
//
// Seeding follows practice-loop.spec.ts: course/theme/LO over the real HTTP
// routes with the `faculty` session, then questions.service.createQuestion
// directly, since question authoring still has no HTTP route.
import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  coursesCol,
  themesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';
import { numericQuestionFields } from './numeric-fixture';

let courseId = '';
let questionId = '';

// Display math whose delimiters survive the markdown pass, opening with a
// command rather than a digit — the shapes GENERATOR_PROMPT asks for.
const STEM_MATH = String.raw`$$\text{PV} = \frac{C}{(1+r)^n}$$`;

test.use({ storageState: AUTH_FILE });

test.describe('instructor sample panel', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const api = context.request;

    const course = (await (
      await api.post('/api/courses', {
        data: { name: 'Sample Render E2E', courseCode: 'FIN-SR', term: '2026W' },
      })
    ).json()) as { _id: string };
    courseId = course._id;

    const theme = (await (
      await api.post(`/api/courses/${courseId}/themes`, { data: { name: 'Rendering (E2E)' } })
    ).json()) as { _id: string };
    const lo = (await (
      await api.post(`/api/themes/${theme._id}/los`, { data: { name: 'Render maths (E2E)' } })
    ).json()) as { _id: string };

    await connectMongo();
    const fields = numericQuestionFields();
    const created = await createQuestion({
      courseId: new ObjectId(courseId),
      loIds: [new ObjectId(lo._id)],
      themeIds: [new ObjectId(theme._id)],
      type: 'mcq',
      difficulty: 'easy',
      createdBy: 'e2e-seed',
      ...fields,
      // The fixture's own stem stays intact (other specs match on its opening
      // prose); the maths is appended so this spec has something to render.
      stem: `${fields.stem} Use ${STEM_MATH} to decide.`,
    });
    questionId = created.questionId.toString();

    await context.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    const cId = new ObjectId(courseId);
    const questions = await questionsCol().find({ courseId: cId }).toArray();
    await Promise.all([
      questionVersionsCol().deleteMany({ questionId: { $in: questions.map((q) => q._id) } }),
      questionsCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
    ]);
  });

  test('renders the worked example as maths, not as LaTeX source', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/bank/${questionId}`);

    const sample = page.locator('.question-sample');
    await expect(sample).toBeVisible();

    // A `.katex` node can only exist if renderRichText ran on this panel.
    await expect(sample.locator('.katex').first()).toBeVisible();

    // ...and the source is not on screen. innerText is required: KaTeX keeps
    // the original TeX in a visually-hidden MathML annotation, so a
    // textContent check matches `\frac` even on a correct render.
    await expect(sample.locator('.question-sample__stem')).not.toContainText('\\frac', {
      useInnerText: true,
    });

    // The panel's original contract still holds: substituted, not templated.
    await expect(sample.locator('.question-sample__stem')).not.toContainText('{{');
  });
});
