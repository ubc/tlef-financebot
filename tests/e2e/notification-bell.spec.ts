import { test, expect, type Page, type Locator } from '@playwright/test';
import { ObjectId } from 'mongodb';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  auditCol,
  coursesCol,
  flagsCol,
  losCol,
  notificationsCol,
  questionsCol,
  questionVersionsCol,
  themesCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';
import { createQuestion } from '../../server/src/services/questions.service';
import { notify } from '../../server/src/services/notifications.service';
import type { Flag } from '../../server/src/types/domain';

// The in-app notification bell: navigate on click, dismiss on click, and
// "Clear all" (§4.3 bug fix, 2026-08-02).
//
// This is the ONLY automated coverage of the bell's DOM behaviour. The unit
// layer runs in Jest's Node environment with no jsdom installed
// (tests/AGENTS.md:66-69), so the pure route-mapping helper
// (client/src/notification-target.ts) is unit-testable but the widget that
// consumes it is not — everything below has to be proved in a real browser.
//
// Isolation: this spec seeds its own course, questions, flags AND
// notifications rather than reading whatever the dev database happens to
// hold. Commit 315d1dd fixed exactly that class of flakiness in this suite.
// Every assertion below is pinned to a body string carrying this run's
// timestamp token, so notifications left behind by earlier runs (the bell is
// per-user, not per-course, and residue outlives a course-scoped cleanup)
// cannot satisfy or break it.

test.use({ storageState: AUTH_FILE });

const RUN = Date.now();
const COURSE_NAME = `Notification Bell E2E ${RUN}`;
const COURSE_CODE = 'NOTIF-E2E';
const THEME_NAME = 'Notification routing';
const LO_NAME = 'Land on the flagged question';
// Two questions, each with its own open flag, so "the bell highlighted the
// RIGHT group" is a real assertion rather than "the only group on the page".
const STEM_A = `Which surface keeps the durable record of a flag? (${RUN})`;
const STEM_B = `Which control clears the notification bell? (${RUN})`;

let facultyPuid = '';
let courseId = '';
let themeId = '';
let loId = '';
let questionAId = '';
let questionBId = '';
let flagBId = '';

interface SeededInbox {
  flagBody: string;
  summaryBody: string;
}

/**
 * Two fresh notifications for the signed-in instructor: a `flag` one whose
 * `refId` points at question B's flag (so its target is
 * `…/flags?flag=<id>`), and a `daily-summary` one that acts as the control —
 * it must survive the single dismissal, which is what distinguishes "the
 * clicked row was dismissed" from "the panel emptied itself".
 *
 * Seeded through the production `notify()` primitive rather than a hand-built
 * insert, so the documents this spec asserts on are shaped exactly like the
 * ones flags.service.ts emits.
 */
async function seedInbox(label: string): Promise<SeededInbox> {
  const flagBody = `A question was flagged: "bell-${label}-${RUN}"`;
  const summaryBody = `Daily summary control row bell-${label}-${RUN}`;
  await notify({
    recipientPuid: facultyPuid,
    courseId: new ObjectId(courseId),
    kind: 'flag',
    priority: 'standard',
    body: flagBody,
    refType: 'flag',
    refId: new ObjectId(flagBId),
  });
  await notify({
    recipientPuid: facultyPuid,
    courseId: new ObjectId(courseId),
    kind: 'daily-summary',
    priority: 'standard',
    body: summaryBody,
  });
  return { flagBody, summaryBody };
}

/** The bell button. Its accessible name carries the unread count, so it is
 * matched by prefix and re-resolved on every use. */
function bell(page: Page): Locator {
  return page.getByRole('button', { name: /^Notifications/ });
}

function notifItem(page: Page, body: string): Locator {
  return page.locator('.notif-item').filter({ hasText: body });
}

/**
 * Land on an instructor route explicitly instead of `/`.
 *
 * `/` is role-dependent (`main.ts`'s `fallback:`), and the shared E2E
 * `faculty` fixture is currently in `ADMIN_CWL_ALLOWLIST`, so `/` resolves to
 * the Admin console — the ambient-state trap documented in
 * phase-4/Saurav/STATUS.md that already breaks two Phase 0 specs. The bell
 * lives in the shared instructor topbar either way; navigating explicitly
 * just keeps this spec independent of that setting.
 */
async function openInstructorShell(page: Page): Promise<void> {
  await page.goto('/#/instructor/courses');
  await expect(bell(page)).toBeVisible();
}

test.describe('notification bell — navigate, dismiss, clear all', () => {
  test.beforeAll(async ({ browser }) => {
    const instructorContext = await browser.newContext({ storageState: AUTH_FILE });
    const api = instructorContext.request;

    const me = await api.get('/api/auth/me');
    expect(me.status()).toBe(200);
    const session = (await me.json()) as { authenticated: boolean; user?: { puid: string } };
    if (!session.authenticated || !session.user) {
      throw new Error('notification-bell: expected an authenticated instructor session.');
    }
    facultyPuid = session.user.puid;

    const courseRes = await api.post('/api/courses', {
      data: { name: COURSE_NAME, courseCode: COURSE_CODE, term: '2026W' },
    });
    expect(courseRes.status()).toBe(201);
    courseId = ((await courseRes.json()) as { _id: string })._id;

    const themeRes = await api.post(`/api/courses/${courseId}/themes`, { data: { name: THEME_NAME } });
    expect(themeRes.status()).toBe(201);
    themeId = ((await themeRes.json()) as { _id: string })._id;

    const loRes = await api.post(`/api/themes/${themeId}/los`, { data: { name: LO_NAME } });
    expect(loRes.status()).toBe(201);
    loId = ((await loRes.json()) as { _id: string })._id;

    await connectMongo();

    const options = [
      { key: 'A', text: 'The flag queue', role: 'correct' as const, explanation: 'It retains every flag.' },
      {
        key: 'B',
        text: 'The notification bell',
        role: 'common-misconception' as const,
        explanation: 'The bell is a nudge surface, not a record.',
      },
      { key: 'C', text: 'The browser tab', role: 'clearly-wrong' as const, explanation: 'Nothing is stored there.' },
      {
        key: 'D',
        text: 'The audit log alone',
        role: 'partially-correct' as const,
        explanation: 'It records actions, not the open work.',
      },
    ];

    const seedQuestion = async (stem: string): Promise<{ questionId: ObjectId; versionId: ObjectId }> => {
      const created = await createQuestion({
        courseId: new ObjectId(courseId),
        loIds: [new ObjectId(loId)],
        themeIds: [new ObjectId(themeId)],
        type: 'mcq',
        stem,
        difficulty: 'easy',
        createdBy: 'notification-bell-e2e',
        options,
      });
      const question = await questionsCol().findOne({ _id: created.questionId });
      if (!question) throw new Error('notification-bell: seed question missing');
      return { questionId: created.questionId, versionId: question.currentVersionId };
    };

    const a = await seedQuestion(STEM_A);
    const b = await seedQuestion(STEM_B);
    questionAId = a.questionId.toHexString();
    questionBId = b.questionId.toHexString();

    // One open flag per question, inserted directly: this spec is about the
    // bell, and the student flagging path is already covered end-to-end by
    // flag-loop.spec.ts.
    const now = Date.now();
    const flagA: Flag & { _id: ObjectId } = {
      _id: new ObjectId(),
      courseId: new ObjectId(courseId),
      questionId: a.questionId,
      questionVersionId: a.versionId,
      puid: 'notif-bell-peer-1',
      reason: `Decoy flag ${RUN}`,
      state: 'open',
      createdAt: new Date(now),
    };
    const flagB: Flag & { _id: ObjectId } = {
      _id: new ObjectId(),
      courseId: new ObjectId(courseId),
      questionId: b.questionId,
      questionVersionId: b.versionId,
      puid: 'notif-bell-peer-2',
      reason: `Target flag ${RUN}`,
      state: 'open',
      createdAt: new Date(now + 1),
    };
    await flagsCol().insertMany([flagA, flagB]);
    flagBId = flagB._id.toHexString();

    await instructorContext.close();
  });

  test.afterAll(async () => {
    if (!courseId) return;
    await connectMongo();
    const cId = new ObjectId(courseId);
    const qIds = [questionAId, questionBId].filter(Boolean).map((id) => new ObjectId(id));

    await Promise.all([
      questionsCol().deleteMany({ courseId: cId }),
      questionVersionsCol().deleteMany({ questionId: { $in: qIds } }),
      flagsCol().deleteMany({ courseId: cId }),
      notificationsCol().deleteMany({ courseId: cId }),
      auditCol().deleteMany({ courseId: cId }),
      losCol().deleteMany({ courseId: cId }),
      themesCol().deleteMany({ courseId: cId }),
      coursesCol().deleteOne({ _id: cId }),
      usersCol().updateMany({ puid: facultyPuid }, { $pull: { courseRoles: { courseId: cId } } }),
    ]);
  });

  test('opening clears the badge, clicking a flag notification navigates and highlights it, and the dismissal survives a reload', async ({
    page,
  }) => {
    const { flagBody, summaryBody } = await seedInbox('nav');

    await openInstructorShell(page);

    // 1 — the badge carries an unread count, on the button's own accessible
    // name (a screen reader never reaches the sibling <span>).
    const badge = page.locator('.notif-bell__badge');
    await expect(badge).toBeVisible();
    await expect(bell(page)).toHaveAttribute('aria-label', /^Notifications \(\d+ unread\)$/);

    // …and OPENING the panel is the "I have looked at these" signal, so the
    // badge goes to zero. Before the fix, opening marked nothing read and the
    // badge stayed stuck on.
    await bell(page).click();
    await expect(page.locator('.notif-panel')).toBeVisible();
    await expect(badge).toBeHidden();
    await expect(bell(page)).toHaveAttribute('aria-label', 'Notifications');

    await expect(notifItem(page, flagBody)).toBeVisible();
    await expect(notifItem(page, summaryBody)).toBeVisible();

    // 2 — clicking the flag notification goes to the flag queue and points at
    // the flag it is about. Before the fix, rows were inert.
    await notifItem(page, flagBody).click();
    await expect(page).toHaveURL(/#\/instructor\/course\/[^/]+\/flags\?flag=/);
    await expect(page).toHaveURL(new RegExp(`#/instructor/course/${courseId}/flags\\?flag=${flagBId}$`));

    // The queue holds two flagged questions; exactly the notified one is
    // highlighted, so this proves routing, not just arrival.
    await expect(page.locator('.flag-group')).toHaveCount(2);
    const highlighted = page.locator('.flag-group--highlight');
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toBeVisible();
    await expect(highlighted).toHaveAttribute('data-question-id', questionBId);
    await expect(highlighted).toContainText(STEM_B);

    // Activating a row also closes the panel — you are now looking at the
    // thing it pointed at.
    await expect(page.locator('.notif-panel')).toBeHidden();

    // 3 — the clicked row is gone from the panel; the control row is not.
    await bell(page).click();
    await expect(notifItem(page, summaryBody)).toBeVisible();
    await expect(notifItem(page, flagBody)).toHaveCount(0);

    // 4 — and it stays gone across a full reload. This is the assertion that
    // proves the dismissal reached the SERVER (`dismissedAt`) rather than
    // living in the widget's memory, and therefore that the 30s poll can
    // never resurrect a row the user has dealt with.
    await page.reload();
    await expect(bell(page)).toBeVisible();
    await bell(page).click();
    await expect(notifItem(page, summaryBody)).toBeVisible();
    await expect(notifItem(page, flagBody)).toHaveCount(0);

    // Dismissed, not deleted: the document is retained so the audit trail
    // survives and a future "recently dismissed" view stays possible. Nothing
    // user-visible can distinguish the two, so it is asserted here.
    const dismissed = await notificationsCol().findOne({ recipientPuid: facultyPuid, body: flagBody });
    expect(dismissed).not.toBeNull();
    expect(dismissed?.dismissedAt).toBeInstanceOf(Date);
  });

  test('"Clear all" empties the bell, and it is still empty after a reload', async ({ page }) => {
    const { flagBody, summaryBody } = await seedInbox('clear');

    await openInstructorShell(page);
    await bell(page).click();
    await expect(notifItem(page, flagBody)).toBeVisible();
    await expect(notifItem(page, summaryBody)).toBeVisible();

    // "Clear all" replaced "Mark all read": it empties the list outright,
    // read and unread alike. Note this also dismisses anything else this
    // fixture user happened to be holding — that is the feature, and
    // dismissal is non-destructive (documents are retained).
    //
    // The panel empties OPTIMISTICALLY, so the visible empty state alone does
    // not prove the server was ever told. Wait for the request itself before
    // reloading, or the reload can abort an in-flight dismissal and this test
    // would report a product failure that is really its own race.
    const dismissedAll = page.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/notifications/dismiss-all',
    );
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.locator('.notif-panel__empty')).toHaveText('No notifications yet.');
    await expect(page.locator('.notif-item')).toHaveCount(0);
    expect((await dismissedAll).ok()).toBe(true);

    // Still empty after a reload — the server-side proof, not a local one.
    //
    // A freshly built bell starts with an empty list, so "No notifications
    // yet." is on screen BEFORE the first poll answers: asserting it straight
    // after a reload would pass even with the fix reverted. So the reload's
    // own poll response is inspected as the positive control. Settling the
    // network first guarantees the awaited GET is that poll and not a
    // pre-reload one whose response happened to land late.
    await page.waitForLoadState('networkidle');
    const listed = page.waitForResponse(
      (res) => res.request().method() === 'GET' && new URL(res.url()).pathname === '/api/notifications',
    );
    await page.reload();
    const payload = (await (await listed).json()) as Array<{ body: string }>;
    expect(payload.some((n) => n.body === flagBody || n.body === summaryBody)).toBe(false);

    await bell(page).click();
    await expect(page.locator('.notif-panel__empty')).toHaveText('No notifications yet.');
    await expect(page.locator('.notif-item')).toHaveCount(0);
  });
});
