import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  coursesCol,
  generationBlueprintsCol,
  losCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

// "Blueprint" meant nothing to the PI who reviewed the generation form
// (2026-08-08): it is a saved LO + type + difficulty + prompt bundle, but the
// label said none of that. The UI now says "Saved Setup" and carries a help tip
// that explains it. The API, service, collection and route keep the original
// `blueprint` name on purpose — see the divergence note in preseeding.ts.
//
// "Saved Prompts" was rejected: `PRESET_TEMPLATES` renders starter *prompt*
// buttons in this same form, so that name would have collided. This spec
// therefore asserts the word "prompt" is still free to mean the preset buttons.

const COURSE_NAME = 'Saved Setup E2E';
const TOPIC = 'Working capital (saved-setup e2e)';
const LO = 'Estimate a cash conversion cycle';
const SETUP_NAME = 'Cash cycle drill';

let courseId = '';
let facultyPuid = '';

test.describe('Generate Question "Saved Setup"', () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const me = await context.request.get('/api/auth/me');
    const auth = (await me.json()) as { user: { puid: string } };
    facultyPuid = auth.user.puid;

    const courseResponse = await context.request.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: 'FIN-SETUP', term: '2026W' },
    });
    expect(courseResponse.ok()).toBeTruthy();
    courseId = ((await courseResponse.json()) as { _id: string })._id;

    const theme = (await (
      await context.request.post(`/api/courses/${courseId}/themes`, { data: { name: TOPIC } })
    ).json()) as { _id: string };
    const loId = ((await (
      await context.request.post(`/api/themes/${theme._id}/los`, { data: { name: LO } })
    ).json()) as { _id: string })._id;

    // Seed one saved setup: "Run setup" only renders once one is SELECTED, so
    // without this the button's label would never appear on the page and the
    // "no blueprint survives" assertion could not see it.
    const setup = await context.request.post(`/api/courses/${courseId}/generation-blueprints`, {
      data: { name: SETUP_NAME, loId, count: 1, type: 'mcq', difficulty: 'medium', prompt: 'Drill the cash cycle.' },
    });
    expect(setup.ok()).toBeTruthy();

    await context.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    await Promise.all([
      generationBlueprintsCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateOne({ puid: facultyPuid }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('is named for what it saves, explains itself, and leaves no "blueprint" on the page', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));

    await page.goto(`/#/instructor/course/${courseId}/preseeding`);
    await expect(page.getByRole('heading', { name: 'Question Bank Coverage', level: 1 })).toBeVisible();

    await test.step('the user-facing name is "Saved Setup", not "Blueprint"', async () => {
      await expect(page.getByLabel('Saved Setup', { exact: true })).toBeVisible();
      await expect(page.getByPlaceholder('Setup name')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save setup' })).toBeVisible();
      // No user-visible "blueprint" survives anywhere on the page, in any case.
      await expect(page.locator('body')).not.toContainText(/blueprint/i);
      // "Custom request" stays the empty default (an <option> in a closed
      // select is never `visible`, so assert on value and text, not visibility).
      await expect(page.getByLabel('Saved Setup', { exact: true })).toHaveValue('');
      await expect(page.locator('#preseeding-saved-setup option[value=""]')).toHaveText('Custom request');
    });

    await test.step('selecting a saved setup reveals "Run setup", not "Run blueprint"', async () => {
      await page.getByLabel('Saved Setup', { exact: true }).selectOption({ label: SETUP_NAME });
      await expect(page.getByRole('button', { name: 'Run setup' })).toBeVisible();
      // Re-check with the extra control on screen: this is the state the
      // no-filter path above cannot reach.
      await expect(page.locator('body')).not.toContainText(/blueprint/i);
      // Selecting one loads its whole request back, which is what the name promises.
      await expect(page.getByLabel('Target LO')).toHaveValue(/.+/);
      await expect(page.getByPlaceholder('Setup name')).toHaveValue(SETUP_NAME);
    });

    await test.step('the help tip explains that it is re-runnable', async () => {
      const trigger = page.getByRole('button', { name: 'About Saved Setup' });
      await expect(trigger).toBeVisible();

      const bubbleId = await trigger.getAttribute('aria-describedby');
      expect(bubbleId).toBeTruthy();
      const bubble = page.locator(`#${bubbleId}`);
      await expect(bubble).toHaveAttribute('role', 'tooltip');
      // The point of the rename: say what is saved, and that it can be re-run.
      await expect(bubble).toContainText('re-run');
      await expect(bubble).toContainText('Learning Objective');
      await expect(bubble).toContainText('difficulty');
    });

    await test.step('the tip sits OUTSIDE the label, so it cannot steal focus into the select', async () => {
      const savedSetupSelect = page.getByLabel('Saved Setup', { exact: true });
      // Nested inside the `<label>`, clicking the trigger would also activate
      // the label and move focus into the select — the reason settings.ts's
      // `fieldLabelWithHelp` keeps them siblings.
      await expect(page.locator('label[for="preseeding-saved-setup"] .help-tip')).toHaveCount(0);
      await page.getByRole('button', { name: 'About Saved Setup' }).click();
      await expect(savedSetupSelect).not.toBeFocused();
    });

    await test.step('the open bubble is fully readable at every width', async () => {
      // "Saved Setup" is the FIRST field in the form row, so the old centred
      // bubble put half its width to the LEFT of a trigger sitting just inside
      // the content area — and `main` / `.outlet` clip at that edge, so a slice
      // of the text was unreadable (reported 2026-08-10).
      //
      // The viewport is NOT the binding constraint on desktop: `.outlet` starts
      // at the sidebar edge (x=272 at >=900px), so a bubble at x=254 is clipped
      // while still being "inside the viewport". Assert against the real
      // clipping ancestor.
      const trigger = page.getByRole('button', { name: 'About Saved Setup' });
      const bubble = page.locator(`#${await trigger.getAttribute('aria-describedby')}`);

      for (const width of [1440, 1024, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await trigger.click();
        await expect(bubble).toBeVisible();
        const box = await bubble.boundingBox();
        expect(box, `no bubble box at ${width}px`).toBeTruthy();
        const clipLeft = await page.evaluate(() => document.querySelector('.outlet')?.getBoundingClientRect().left ?? 0);
        expect(box!.x, `bubble clipped by the content edge at ${width}px`).toBeGreaterThanOrEqual(clipLeft);
        expect(box!.x + box!.width, `bubble clipped off the RIGHT at ${width}px`).toBeLessThanOrEqual(width);
        await trigger.click();
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    });

    await test.step('"prompt" still belongs to the preset buttons it always named', async () => {
      // The collision that ruled out "Saved Prompts": the starter prompt
      // buttons live in this same form, inches from the Saved Setup select.
      await expect(page.locator('.preseeding-presets .chip-btn').first()).toBeVisible();
    });

    expect(browserErrors).toEqual([]);
  });
});
