import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import { coursesCol, losCol, themesCol, usersCol } from '../../server/src/components/mongodb/collections';

// "+ Generate Question" is an action, not a filter: it now sits in its own
// `.bank-actions` container and carries the bank's Topic/LO/Type filters to
// the coverage page, which opens the generate form already targeting that LO
// (bank.ts `generatePath` / preseeding.ts's arrival handling). Before this,
// a PI who had narrowed the bank to one Learning Objective landed on a page
// listing every LO and had to find theirs again.
//
// Two Topics with one LO each: the LO under test is deliberately the SECOND
// one, so "the form shows the filtered LO" can't pass by accidentally
// agreeing with the form's default (the course's first LO).

const COURSE_NAME = 'Bank Generate Scope E2E';
const TOPIC_ONE = 'Time value of money (scope e2e)';
const TOPIC_TWO = 'Capital budgeting (scope e2e)';
const LO_ONE = 'Discount a single future cash flow';
const LO_TWO = 'Rank projects by net present value';

let courseId = '';
let themeTwoId = '';
let loOneId = '';
let loTwoId = '';
let facultyPuid = '';

test.describe('Question Bank "+ Generate Question" filter scope', () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const me = await context.request.get('/api/auth/me');
    const auth = (await me.json()) as { user: { puid: string } };
    facultyPuid = auth.user.puid;

    const courseResponse = await context.request.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: 'FIN-SCOPE', term: '2026W' },
    });
    expect(courseResponse.ok()).toBeTruthy();
    courseId = ((await courseResponse.json()) as { _id: string })._id;

    const themeOne = (await (
      await context.request.post(`/api/courses/${courseId}/themes`, { data: { name: TOPIC_ONE } })
    ).json()) as { _id: string };
    const themeTwo = (await (
      await context.request.post(`/api/courses/${courseId}/themes`, { data: { name: TOPIC_TWO } })
    ).json()) as { _id: string };
    themeTwoId = themeTwo._id;

    loOneId = ((await (
      await context.request.post(`/api/themes/${themeOne._id}/los`, { data: { name: LO_ONE } })
    ).json()) as { _id: string })._id;
    loTwoId = ((await (
      await context.request.post(`/api/themes/${themeTwoId}/los`, { data: { name: LO_TWO } })
    ).json()) as { _id: string })._id;

    await context.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    await Promise.all([
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne({ puid: facultyPuid }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('carries the LO/Type filters into the generate form, and leaves the unfiltered path alone', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));

    await test.step('the action buttons are not filters', async () => {
      await page.goto(`/#/instructor/course/${courseId}/bank`);
      await expect(page.getByRole('heading', { name: 'Question Bank', level: 1 })).toBeVisible();
      await expect(page.locator('.bank-filters')).toBeVisible();
      await expect(page.locator('.bank-filters').getByRole('button', { name: '+ Generate Question' })).toHaveCount(0);
      await expect(page.locator('.bank-filters').getByRole('button', { name: '↑ Import' })).toHaveCount(0);
      await expect(page.locator('.bank-actions').getByRole('button', { name: '+ Generate Question' })).toBeVisible();
      await expect(page.locator('.bank-actions').getByRole('button', { name: '↑ Import' })).toBeDisabled();
    });

    await test.step('no filters: the plain coverage table, no prefill, no focus jump', async () => {
      await page.getByRole('button', { name: '+ Generate Question' }).click();
      await page.waitForURL(new RegExp(`/instructor/course/${courseId}/preseeding$`));
      await expect(page.getByRole('heading', { name: 'Question Bank Coverage', level: 1 })).toBeVisible();
      await expect(page.locator('.preseeding-table__rows .preseeding-row')).toHaveCount(2);
      const targetLo = page.getByLabel('Target LO');
      await expect(targetLo).toHaveValue(loOneId);
      await expect(targetLo).not.toBeFocused();
      await expect(page.getByLabel('Question Type')).toHaveValue('mcq');
    });

    await test.step('LO + Type filters arrive prefilled, focused, with the coverage table intact', async () => {
      await page.goto(`/#/instructor/course/${courseId}/bank`);
      await page.getByLabel('Filter by Learning Objective').selectOption(loTwoId);
      await page.getByLabel('Filter by question type').selectOption('true-false');
      // Status is a bank-browsing filter: set it to prove it is NOT carried.
      await page.getByLabel('Filter by publication state').selectOption('draft');

      await page.getByRole('button', { name: '+ Generate Question' }).click();
      await page.waitForURL(/\/preseeding\?/);
      const query = new URLSearchParams(page.url().split('?')[1]);
      expect(query.get('loId')).toBe(loTwoId);
      expect(query.get('type')).toBe('true-false');
      expect(query.get('status')).toBeNull();

      const targetLo = page.getByLabel('Target LO');
      await expect(targetLo).toHaveValue(loTwoId);
      await expect(targetLo).toBeFocused();
      await expect(page.getByLabel('Question Type')).toHaveValue('true-false');
      // Stephen's Phase 5 redesign owns merging these pages; the table stays.
      await expect(page.locator('.preseeding-table__rows .preseeding-row')).toHaveCount(2);
    });

    await test.step('a Topic filter preselects that Topic’s first LO without opening the form', async () => {
      await page.goto(`/#/instructor/course/${courseId}/bank`);
      await page.getByLabel('Filter by Topic').selectOption(themeTwoId);
      await page.getByRole('button', { name: '+ Generate Question' }).click();
      await page.waitForURL(/\/preseeding\?/);
      const targetLo = page.getByLabel('Target LO');
      await expect(targetLo).toHaveValue(loTwoId);
      await expect(targetLo).not.toBeFocused();
    });

    await test.step('an unknown LO falls back to the default form', async () => {
      await page.goto(`/#/instructor/course/${courseId}/preseeding?loId=${new ObjectId().toHexString()}&type=nonsense`);
      await expect(page.getByRole('heading', { name: 'Question Bank Coverage', level: 1 })).toBeVisible();
      await expect(page.getByLabel('Target LO')).toHaveValue(loOneId);
      await expect(page.getByLabel('Question Type')).toHaveValue('mcq');
    });

    expect(browserErrors).toEqual([]);
  });
});
