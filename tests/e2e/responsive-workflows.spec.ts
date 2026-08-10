import { expect, test, type Page } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  coursesCol,
  losCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';

let courseId = '';
let themeId = '';
let loId = '';
let facultyPuid = '';
let originalIsAdmin = false;

const LONG_LO = 'Explain how a deliberately long learning-objective label remains usable inside responsive filters and workflow cards.';
const GUIDED_LO = 'Evaluate a responsive workflow without losing completed setup work.';

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.bodyWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
}

async function expectNoHorizontalClipping(page: Page): Promise<void> {
  const result = await page.locator('.outlet').evaluate((outlet) => {
    const outletRect = outlet.getBoundingClientRect();
    const candidates = Array.from(outlet.querySelectorAll(
      'input, textarea, select, button, a.btn, article, section, table, .bank-row > *, .queue-row > *, .preseeding-row > *',
    ));
    const clipped = candidates
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.left < outletRect.left - 1 || rect.right > outletRect.right + 1;
      })
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        text: (element.textContent ?? '').trim().slice(0, 60),
      }));
    return {
      clipped,
      scrollOverflow: outlet.scrollWidth > outlet.clientWidth + 1,
    };
  });
  expect(result).toEqual({ clipped: [], scrollOverflow: false });
}

test.describe('responsive cross-role workflows', () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const me = await context.request.get('/api/auth/me');
    const auth = (await me.json()) as { user?: { puid: string } };
    facultyPuid = auth.user?.puid ?? '';
    expect(facultyPuid).toBeTruthy();

    await connectMongo();
    const faculty = await usersCol().findOne({ puid: facultyPuid });
    expect(faculty).toBeTruthy();
    originalIsAdmin = faculty?.isAdmin ?? false;
    await usersCol().updateOne({ puid: facultyPuid }, { $set: { isAdmin: true } });

    const courseResponse = await context.request.post('/api/courses', {
      data: { name: 'Responsive Workflow Fixture', courseCode: 'UI-RESP', term: '2026W' },
    });
    expect(courseResponse.status()).toBe(201);
    courseId = ((await courseResponse.json()) as { _id: string })._id;

    const datesResponse = await context.request.patch(`/api/courses/${courseId}`, {
      data: {
        termStart: '2026-09-08T07:00:00.000Z',
        termEnd: '2026-12-07T08:00:00.000Z',
      },
    });
    expect(datesResponse.ok()).toBe(true);

    const themeResponse = await context.request.post(`/api/courses/${courseId}/themes`, {
      data: { name: 'Responsive layout' },
    });
    expect(themeResponse.status()).toBe(201);
    themeId = ((await themeResponse.json()) as { _id: string })._id;

    const loResponse = await context.request.post(`/api/themes/${themeId}/los`, {
      data: { name: LONG_LO },
    });
    expect(loResponse.status()).toBe(201);
    loId = ((await loResponse.json()) as { _id: string })._id;

    await createQuestion({
      courseId: new ObjectId(courseId),
      themeIds: [new ObjectId(themeId)],
      loIds: [new ObjectId(loId)],
      type: 'mcq',
      difficulty: 'medium',
      stem: 'Which interface behaviour keeps a long learning objective usable on a narrow screen?',
      createdBy: 'responsive-workflows-e2e',
      options: [
        { key: 'A', text: 'Wrap and reflow the content.', role: 'correct', explanation: 'Responsive layouts preserve every action.' },
        { key: 'B', text: 'Clip the action buttons.', role: 'common-misconception', explanation: 'Clipping makes controls unreachable.' },
        { key: 'C', text: 'Force a desktop-width table.', role: 'partially-correct', explanation: 'A scroll region can help, but a card layout is clearer here.' },
        { key: 'D', text: 'Hide the status.', role: 'clearly-wrong', explanation: 'Status is essential context.' },
      ],
    });
    await context.close();
  });

  test.afterAll(async () => {
    await connectMongo();
    if (courseId) {
      const cId = new ObjectId(courseId);
      const questions = await questionsCol().find({ courseId: cId }).toArray();
      const questionIds = questions.map((question) => question._id);
      await Promise.all([
        questionVersionsCol().deleteMany({ questionId: { $in: questionIds } }),
        questionsCol().deleteMany({ courseId: cId }),
        losCol().deleteMany({ courseId: cId }),
        themesCol().deleteMany({ courseId: cId }),
        coursesCol().deleteOne({ _id: cId }),
        usersCol().updateOne(
          { puid: facultyPuid },
          {
            $set: { isAdmin: originalIsAdmin },
            $pull: { courseRoles: { courseId: cId } },
          },
        ),
      ]);
    } else if (facultyPuid) {
      await usersCol().updateOne({ puid: facultyPuid }, { $set: { isAdmin: originalIsAdmin } });
    }
  });

  test('Admin and Instructor operations do not clip controls at desktop or phone widths', async ({ page }) => {
    const routes = [
      { path: '/admin/users', heading: 'User Directory' },
      { path: '/admin/capabilities', heading: 'Capability Matrix' },
      { path: '/admin/platform-settings', heading: 'Platform Settings' },
      { path: `/instructor/course/${courseId}/bank`, heading: 'Question Bank' },
      { path: `/instructor/course/${courseId}/queue`, heading: 'Review Queue' },
      { path: `/instructor/course/${courseId}/preseeding`, heading: 'Question Bank Coverage' },
      { path: `/instructor/course/${courseId}/tas`, heading: 'Teaching Assistants' },
      { path: `/instructor/course/${courseId}/analytics`, heading: 'Student Analytics' },
      { path: `/instructor/course/${courseId}/materials`, heading: 'Course Knowledge Workspace' },
    ];

    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(`/#${route.path}`);
        await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible();
        await expect(page.locator('.state--error, .alert--error')).toHaveCount(0);
        await expectNoHorizontalClipping(page);
      }
    }
  });

  test('Course Setup Guide is keyboard-safe and keeps all five stages usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/instructor/course/${courseId}`);
    await expect(page.getByRole('heading', { name: 'Responsive Workflow Fixture' })).toBeVisible();

    const courseStages = page.locator('.course-flow__step');
    await expect(courseStages).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      await expect(courseStages.nth(index)).toBeVisible();
    }
    await expectNoHorizontalClipping(page);
    await expectNoPageHorizontalOverflow(page);

    const nextAction = page.getByRole('button', { name: /Add supporting course materials/i });
    await nextAction.focus();
    await expect(nextAction).toBeFocused();
    await page.keyboard.press('Enter');

    const guide = page.getByRole('dialog', { name: 'Prepare this course, one step at a time' });
    await expect(guide).toBeVisible();
    const guideHeading = guide.getByRole('heading', { name: 'Add the sources the course should trust' });
    await expect(guideHeading).toBeFocused();

    const guideStages = guide.locator('.course-setup-guide__stage');
    await expect(guideStages).toHaveCount(5);
    await expect(guideStages.locator('.course-setup-guide__stage-number')).toHaveText(['1', '2', '3', '4', '5']);
    for (let index = 0; index < 5; index += 1) {
      await expect(guideStages.nth(index)).toBeVisible();
    }
    const stageBounds = await guideStages.evaluateAll((stages) => stages.map((stage) => {
      const rect = stage.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
    }));
    for (const bounds of stageBounds) {
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
    }
    const guideSurface = guide.locator('.course-setup-guide__surface');
    const guideOverflow = await guideSurface.evaluate((surface) => ({
      clientWidth: surface.clientWidth,
      scrollWidth: surface.scrollWidth,
    }));
    expect(guideOverflow.scrollWidth).toBeLessThanOrEqual(guideOverflow.clientWidth + 1);
    await expectNoPageHorizontalOverflow(page);

    // Escape closes the modal and returns keyboard focus to the exact action
    // that opened it when the dashboard has not been rerendered.
    await page.keyboard.press('Escape');
    await expect(guide).toBeHidden();
    await expect(nextAction).toBeFocused();

    // Reopen from the keyboard, complete a real (non-AI) setup mutation, then
    // close normally. The saved LO must still exist after the modal is gone.
    await page.keyboard.press('Enter');
    await expect(guide).toBeVisible();
    // Wait for the guide's intentional initial-focus microtask before moving
    // focus to a stage button; otherwise that microtask can race this very
    // fast synthetic keyboard sequence and move focus back to the heading.
    await expect(guideHeading).toBeFocused();
    const learningObjectivesStage = guide.getByRole('button', { name: /2\. Learning objectives/i });
    await learningObjectivesStage.focus();
    await page.keyboard.press('Enter');
    await expect(guide.getByRole('heading', { name: 'Add your existing Learning Objectives' })).toBeFocused();
    await guide.getByLabel('Topic name', { exact: true }).fill('Guided responsive setup');
    await guide.getByRole('textbox', { name: /Learning Objectives — one per line/i }).fill(GUIDED_LO);
    await guide.getByRole('button', { name: 'Save Learning Objectives' }).click();
    await expect(guideHeading).toBeFocused();
    await guide.getByRole('button', { name: 'Close course setup guide' }).click();
    await expect(guide).toBeHidden();

    const treeResponse = await page.request.get(`/api/courses/${courseId}`);
    expect(treeResponse.ok()).toBe(true);
    const tree = (await treeResponse.json()) as {
      themes: Array<{ los?: Array<{ name: string }> }>;
    };
    expect(tree.themes.flatMap((theme) => theme.los ?? []).map((lo) => lo.name)).toContain(GUIDED_LO);
  });
});
