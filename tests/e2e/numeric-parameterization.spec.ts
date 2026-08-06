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
import { AUTH_FILE } from './global-setup';
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
      data: { name: THEME_NAME },
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
        { key: 'C', text: 'Cannot be determined', role: 'clearly-wrong', explanation: 'It can.' },
        { key: 'D', text: 'The payment itself', role: 'partially-correct', explanation: 'Ignores discounting.' },
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
    await page.goto(`/#/instructor/course/${courseId}/bank/${questionId}/params`);
    await expect(page.getByRole('heading', { name: 'Parameterization' })).toBeVisible();

    await test.step('add slots whose range lets the discount rate reach zero', async () => {
      await page.getByRole('button', { name: '+ Add Slot' }).click();
      await page.locator('#slot-name-0').fill('PAYMENT');
      await page.locator('#slot-min-0').fill('100');
      await page.locator('#slot-max-0').fill('900');
      await page.locator('#slot-step-0').fill('100');

      await page.getByRole('button', { name: '+ Add Slot' }).click();
      await page.locator('#slot-name-1').fill('RATE_PCT');
      // -100% makes (1 + RATE_PCT/100) exactly zero, so PV divides by zero.
      await page.locator('#slot-min-1').fill('-100');
      await page.locator('#slot-max-1').fill('10');
      await page.locator('#slot-step-1').fill('10');
    });

    await test.step('add the derived values', async () => {
      await page.getByRole('button', { name: '+ Add Derived Value' }).click();
      await page.locator('#derived-name-0').fill('PV');
      await page.locator('#derived-formula-0').fill('PAYMENT/(1+RATE_PCT/100)');

      await page.getByRole('button', { name: '+ Add Derived Value' }).click();
      await page.locator('#derived-name-1').fill('PV_WRONG');
      await page.locator('#derived-formula-1').fill('PAYMENT*(1+RATE_PCT/100)');
      await page.locator('#derived-error-1').fill('compounded forward instead of discounting back');
    });

    await test.step('saving reports the division by zero and withholds the proof', async () => {
      await page.getByRole('button', { name: 'Save Parameters' }).click();
      const banner = page.locator('.verification-banner--fail');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/division by zero/);
      await expect(banner).toContainText(/will not be served/i);
    });

    await test.step('narrowing the range to exclude -100% verifies it', async () => {
      await page.locator('#slot-min-1').fill('4');
      await page.locator('#slot-max-1').fill('12');
      await page.locator('#slot-step-1').fill('2');
      await page.getByRole('button', { name: 'Save Parameters' }).click();

      await expect(page.locator('.verification-banner--ok')).toBeVisible();
      await expect(page.locator('.verification-banner--fail')).toHaveCount(0);
    });

    await test.step('the question detail view shows a worked example with real numbers', async () => {
      await page.goto(`/#/instructor/course/${courseId}/bank/${questionId}`);
      const sample = page.locator('.question-sample');
      await expect(sample).toBeVisible();

      // The stem the instructor EDITS still carries placeholders; the example
      // below it must not — it is what a student would actually see.
      const stemText = await sample.locator('.question-sample__stem').innerText();
      expect(stemText).not.toContain('{{');
      expect(stemText).toMatch(/payment of \$\d/);

      // All four options render computed values, and they are distinct —
      // which is exactly what verification proved across 100 draws.
      const optionTexts = await sample.locator('.question-sample__option').allInnerTexts();
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
      expect(version?.derivedValues).toHaveLength(2);
    });
  });
});
