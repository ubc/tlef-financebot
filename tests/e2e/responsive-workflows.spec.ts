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
});
