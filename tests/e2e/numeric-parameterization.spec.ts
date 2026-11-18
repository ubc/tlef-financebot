// The instructor's derived-value editor and the verification it triggers
// (design spec 2026-08-05). Drives the real panel in a real browser: a broken
// range is rejected with a reason, fixing it earns a proof, and only then is
// the question servable.
//
// Harness conventions follow instructor-pipeline.spec.ts — global-setup's real
// SAML session, HTTP routes for anything that has one, and a beforeAll that
// seeds a throwaway course so the `faculty` user holds an `instructor`
// courseRole before the first page load.
import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE, RELEASED } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  coursesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

const COURSE_NAME = 'Numeric Parameterization E2E Course';
const THEME_NAME = 'Time Value of Money (param E2E)';
const LO_NAME = 'Compute present value (param E2E)';

// Seeded WITHOUT paramSlots/derivedValues on purpose: this is exactly the
// shape the generator produced before Task 4, and the state an instructor
// arrives at the panel to fix.
const STEM = 'For a zero-coupon note, what is the present value of a payment of ${{PAYMENT}}'
  + ' at an annual discount rate of {{RATE_PCT}}%?';

let courseId = '';
let questionId = '';

test.describe('numeric parameterization', () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const api = context.request;

    const course = (await (await api.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: 'FIN-PARAM-E2E', term: 'Winter Term 1, 2026/27' },
    })).json()) as { _id: string };
    courseId = course._id;

    const theme = (await (await api.post(`/api/courses/${courseId}/themes`, {
      data: { name: THEME_NAME, availableFrom: RELEASED },
    })).json()) as { _id: string };
    const lo = (await (await api.post(`/api/themes/${theme._id}/los`, {
      data: { name: LO_NAME },
    })).json()) as { _id: string };

    await connectMongo();
    const created = await createQuestion({
      courseId: new ObjectId(courseId),
      loIds: [new ObjectId(lo._id)],
      themeIds: [new ObjectId(theme._id)],
      type: 'mcq',
      stem: STEM,
      difficulty: 'easy',
      createdBy: 'e2e-param-seed',
      options: [
        { key: 'A', text: '${{PV}}', role: 'correct', explanation: 'Discount one period.' },
        { key: 'B', text: '${{PV_WRONG}}', role: 'common-misconception', explanation: 'Compounded forward.' },
        { key: 'C', text: '${{PV_TWICE}}', role: 'clearly-wrong', explanation: 'Discounted two periods.' },
        { key: 'D', text: '${{PV_UNDISCOUNTED}}', role: 'partially-correct', explanation: 'Ignores discounting.' },
      ],
    });
    questionId = created.questionId.toString();

    await context.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const id = new ObjectId(courseId);
    const questions = await questionsCol().find({ courseId: id }).toArray();
    await Promise.all([
      questionVersionsCol().deleteMany({ questionId: { $in: questions.map((q) => q._id) } }),
      questionsCol().deleteMany({ courseId: id }),
      losCol().deleteMany({ courseId: id }),
      themesCol().deleteMany({ courseId: id }),
      coursesCol().deleteMany({ _id: id }),
    ]);
  });

  test('a broken range is rejected with a reason; fixing it earns a proof', async ({ page }) => {
    // The old Parameterization URL redirects into the workspace's Parameters mode (spec 2026-11-18 D7).
    await page.goto(`/#/instructor/course/${courseId}/bank/${questionId}/params`);
    await expect(page).toHaveURL(new RegExp(`/questions\\?.*q=${questionId}.*mode=params`));
    const params = page.getByRole('region', { name: 'Parameters' });
    await expect(params).toBeVisible();

    await test.step('add slots whose range lets the discount rate reach zero', async () => {
      await params.getByRole('button', { name: '+ Add drawn variable' }).click();
      await params.getByLabel('Variable 1 name').fill('PAYMENT');
      await params.getByLabel('Variable 1 minimum').fill('100');
      await params.getByLabel('Variable 1 maximum').fill('900');
      await params.getByLabel('Variable 1 step').fill('100');

      await params.getByRole('button', { name: '+ Add drawn variable' }).click();
      await params.getByLabel('Variable 2 name').fill('RATE_PCT');
      // -100% makes (1 + RATE_PCT/100) exactly zero, so PV divides by zero.
      await params.getByLabel('Variable 2 minimum').fill('-100');
      await params.getByLabel('Variable 2 maximum').fill('10');
      await params.getByLabel('Variable 2 step').fill('10');
    });

    await test.step('add the derived values', async () => {
      const rows: Array<[string, string, string]> = [
        ['PV', 'PAYMENT/(1+RATE_PCT/100)', ''],
        ['PV_WRONG', 'PAYMENT*(1+RATE_PCT/100)', 'compounded forward instead of discounting back'],
        ['PV_TWICE', 'PAYMENT/(1+RATE_PCT/100)^2', 'discounted for two periods instead of one'],
        ['PV_UNDISCOUNTED', 'PAYMENT', 'omitted discounting'],
      ];
      for (const [index, [name, formula, mistake]] of rows.entries()) {
        await params.getByRole('button', { name: '+ Add computed value' }).click();
        await params.getByLabel(`Computed value ${index + 1} name`).fill(name);
        await params.getByLabel(`Computed value ${index + 1} formula`).fill(formula);
        if (mistake) await params.getByLabel(`Computed value ${index + 1} mistake`).fill(mistake);
      }
    });

    await test.step('saving reports the division by zero and withholds the proof', async () => {
      await params.getByRole('button', { name: 'Save parameters' }).click();
      const banner = page.locator('.questions-params__verification.is-failed');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/division by zero/);
      await expect(banner).toContainText(/will not be served/i);
    });

    await test.step('narrowing the range to exclude -100% verifies it', async () => {
      await params.getByLabel('Variable 2 minimum').fill('4');
      await params.getByLabel('Variable 2 maximum').fill('12');
      await params.getByLabel('Variable 2 step').fill('2');
      await params.getByRole('button', { name: 'Save parameters' }).click();

      await expect(page.locator('.questions-params__verification.is-verified')).toBeVisible();
      await expect(page.locator('.questions-params__verification.is-failed')).toHaveCount(0);
    });

    await test.step('Preview shows a worked example with real numbers', async () => {
      await page.getByRole('group', { name: 'Reader mode' }).getByRole('button', { name: 'Preview', exact: true }).click();
      const sample = page.getByRole('region', { name: 'Student preview' });
      await expect(sample.locator('.questions-preview__stem')).toBeVisible();

      // The stored stem carries placeholders; the preview must not — it is
      // what a student would actually see.
      const stemText = await sample.locator('.questions-preview__stem').innerText();
      expect(stemText).not.toContain('{{');
      expect(stemText).toMatch(/payment of \$\d/);

      // All four options render computed values, and they are distinct —
      // which is exactly what verification proved across 100 draws.
      const optionTexts = await sample.locator('.gw-answer').allInnerTexts();
      expect(optionTexts).toHaveLength(4);
      for (const text of optionTexts) expect(text).not.toContain('{{');
      const numbers = optionTexts
        .map((t) => /\$([\d.]+)/.exec(t)?.[1])
        .filter((n): n is string => Boolean(n));
      expect(new Set(numbers).size).toBe(numbers.length);
    });

    await test.step('the stored version now carries a proof', async () => {
      await connectMongo();
      const head = await questionsCol().findOne({ _id: new ObjectId(questionId) });
      const version = await questionVersionsCol().findOne({ _id: head!.currentVersionId });
      expect(version?.verification?.evaluatorVersion).toBeGreaterThan(0);
      expect(version?.derivedValues?.map(({ name }) => name)).toEqual(['PV', 'PV_WRONG', 'PV_TWICE', 'PV_UNDISCOUNTED']);
    });
  });
});
