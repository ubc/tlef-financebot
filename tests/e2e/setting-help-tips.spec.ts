import { test, expect } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import { coursesCol, usersCol } from '../../server/src/components/mongodb/collections';

// Course Settings help tips: the ⓘ affordances on Auto-pause, Feedback Strategy
// and Registration Code (UI bug fix, 2026-08-06 — instructors could not tell
// what those settings did from their labels alone).
//
// This is the ONLY automated coverage of the widget's behaviour. Jest runs
// testEnvironment: 'node' with no jsdom (tests/AGENTS.md:66-69), so helpTip()
// cannot be unit-tested; hover, focus and Escape only exist in a real browser.
//
// What it is really guarding is the ACCESSIBILITY contract, which is the part
// that silently rots. WCAG 2.1 AA 1.4.13 requires the explanation to be
// reachable without a pointer and dismissable, and both halves have already
// broken once here: the first cut let a `:focus-visible` show rule outrank the
// Escape rule on specificity, so Escape appeared to do nothing while the
// trigger still held focus. A screenshot review passed that build.

test.use({ storageState: AUTH_FILE });

const RUN = Date.now();
const COURSE_NAME = `Help Tips E2E ${RUN}`;
// Course code has its own uniqueness constraint, so it carries the token too —
// a fixed code makes the second run of this spec fail on a duplicate.
const COURSE_CODE = `TIP-${RUN % 100000}`;

let courseId = '';
let facultyPuid = '';

test.describe('Course Settings help tips', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    try {
      const api = context.request;
      const course = (await (
        await api.post('/api/courses', {
          data: { name: COURSE_NAME, courseCode: COURSE_CODE, term: '2026W' },
        })
      ).json()) as { _id: string; createdBy?: string };
      courseId = course._id;

      await connectMongo();
      const seeded = await coursesCol().findOne({ _id: new ObjectId(courseId) });
      facultyPuid = seeded?.createdBy ?? '';
    } finally {
      await context.close();
    }
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    await Promise.all([
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateMany({ puid: facultyPuid }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('every setting tip opens on hover and on keyboard focus, and Escape dismisses it', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/settings`);
    await expect(page.getByRole('heading', { name: 'Course Settings' })).toBeVisible();

    // The three settings the instructors asked about, plus the three auto-pause
    // numbers, whose two thresholds are independent rules — the fact the tips
    // exist to convey.
    const labels = [
      'Auto-pause',
      'Minimum attempts before auto-pause applies',
      'Flag percentage threshold',
      'Flag count threshold',
      'Feedback Strategy',
      'Registration Code',
    ];

    for (const label of labels) {
      const trigger = page.getByRole('button', { name: `About ${label}` });
      const bubble = page.locator('.help-tip', { has: trigger }).locator('.help-tip__bubble');

      await expect(bubble).toBeHidden();
      await trigger.hover();
      await expect(bubble).toBeVisible();
      // Non-empty: an ⓘ that opens an empty bubble is worse than no ⓘ.
      await expect(bubble).not.toHaveText('');
      await page.mouse.move(0, 0);
      await expect(bubble).toBeHidden();
    }

    // Keyboard only, no pointer anywhere near it.
    const codeTrigger = page.getByRole('button', { name: 'About Registration Code' });
    const codeBubble = page.locator('.help-tip', { has: codeTrigger }).locator('.help-tip__bubble');
    await codeTrigger.focus();
    await expect(codeBubble).toBeVisible();

    // Escape dismisses even though the trigger still holds focus. This is the
    // assertion that fails if the show rules ever out-specify the dismiss rule.
    await page.keyboard.press('Escape');
    await expect(codeBubble).toBeHidden();
    await expect(codeTrigger).toBeFocused();

    // ...and the tip is available again on the next visit, even when focus
    // leaves and returns within a single task. Both moves run in ONE
    // page.evaluate on purpose: driving them as two Playwright calls puts a
    // round-trip between them, which is enough for a deferred handler to run
    // and paper over a focus race. A user tabbing away and straight back gets
    // no such gap.
    await page.evaluate(() => {
      const byLabel = (label: string): HTMLElement | undefined =>
        Array.from(document.querySelectorAll<HTMLElement>('.help-tip__trigger')).find(
          (node) => node.getAttribute('aria-label') === label,
        );
      byLabel('About Auto-pause')?.focus();
      byLabel('About Registration Code')?.focus();
    });
    await expect(codeBubble).toBeVisible();
  });

  test('clicking pins a tip open so it survives the pointer leaving (the touch path)', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/settings`);
    await expect(page.getByRole('heading', { name: 'Course Settings' })).toBeVisible();

    // Deliberately a tip the keyboard has not touched: :focus-visible sticks to
    // a button focused programmatically first, which would keep the bubble up
    // for reasons unrelated to pinning and make this pass vacuously.
    const trigger = page.getByRole('button', { name: 'About Flag percentage threshold' });
    const bubble = page.locator('.help-tip', { has: trigger }).locator('.help-tip__bubble');

    await trigger.click();
    await page.mouse.move(0, 0);
    await expect(bubble).toBeVisible();

    // Clicking again unpins. The pointer sits back on the trigger after a
    // click, where hover legitimately keeps the bubble up, so move away first.
    await trigger.click();
    await page.mouse.move(0, 0);
    await expect(bubble).toBeHidden();
  });

  test('the tips describe the settings as implemented, not as the labels read', async ({ page }) => {
    await page.goto(`/#/instructor/course/${courseId}/settings`);
    await expect(page.getByRole('heading', { name: 'Course Settings' })).toBeVisible();

    const textOf = async (label: string): Promise<string> => {
      const trigger = page.getByRole('button', { name: `About ${label}` });
      return (await page.locator('.help-tip', { has: trigger }).locator('.help-tip__bubble').textContent()) ?? '';
    };

    // meetsAutoPauseThreshold() OR's two independent arms, and minAttempts
    // guards only the percentage one. Instructors read the three fields as a
    // single combined rule, which is the misreading these tips exist to correct
    // — so the copy asserting it is worth pinning.
    expect(await textOf('Flag count threshold')).toContain('either threshold alone is enough');
    expect(await textOf('Minimum attempts before auto-pause applies')).toContain('does not restrain the flag-count rule');

    // enrollByCode() requires a roster hit as well as the code (ST-E02).
    expect(await textOf('Registration Code')).toContain('never grants access on its own');
  });
});
