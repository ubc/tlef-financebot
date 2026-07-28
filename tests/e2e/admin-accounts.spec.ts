import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  auditCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

const ACTIVE_UID = 'e2e-admin-active-prof';
const ACTIVE_PUID = 'PUID-E2E-ADMIN-ACTIVE-PROF';
const PENDING_UID = 'e2e-admin-pending-prof';

let adminPuid = '';
let originalIsAdmin = false;

async function cleanAdminFixtures(): Promise<void> {
  await Promise.all([
    platformInstructorGrantsCol().deleteMany({
      uid: { $in: [ACTIVE_UID, PENDING_UID] },
    }),
    usersCol().deleteMany({
      $or: [
        { puid: ACTIVE_PUID },
        { uid: { $in: [ACTIVE_UID, PENDING_UID] } },
      ],
    }),
    auditCol().deleteMany({
      action: { $in: ['role.assign', 'role.revoke'] },
      'detail.uid': { $in: [ACTIVE_UID, PENDING_UID] },
    }),
  ]);
}

test.describe('Admin Instructor accounts', () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const me = await context.request.get('/api/auth/me');
    expect(me.ok()).toBeTruthy();
    const auth = (await me.json()) as {
      authenticated: boolean;
      user?: { puid: string };
    };
    expect(auth.authenticated).toBe(true);
    adminPuid = auth.user?.puid ?? '';
    expect(adminPuid).toBeTruthy();
    await context.close();

    await connectMongo();
    const admin = await usersCol().findOne({ puid: adminPuid });
    expect(admin).toBeTruthy();
    originalIsAdmin = admin?.isAdmin ?? false;

    await cleanAdminFixtures();
    await usersCol().insertOne({
      puid: ACTIVE_PUID,
      uid: ACTIVE_UID,
      displayName: 'E2E Active Professor',
      email: 'e2e-active-prof@example.test',
      affiliations: ['faculty'],
      isAdmin: false,
      courseRoles: [],
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });
    await usersCol().updateOne(
      { puid: adminPuid },
      { $set: { isAdmin: true } },
    );
  });

  test.afterAll(async () => {
    await connectMongo();
    await cleanAdminFixtures();
    if (adminPuid) {
      await usersCol().updateOne(
        { puid: adminPuid },
        { $set: { isAdmin: originalIsAdmin } },
      );
    }
  });

  test('grants, searches, and revokes pending and active Instructor accounts', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    await page.goto('/#/admin/accounts');
    await expect(page.getByRole('heading', { name: 'Instructor Accounts' })).toBeVisible();

    const cwlInput = page.locator('#admin-instructor-cwl');
    await cwlInput.fill(`  ${PENDING_UID.toUpperCase()}  `);
    await page.getByRole('button', { name: 'Grant Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Grant saved for ${PENDING_UID}; it will activate on first CWL login.`,
      }),
    ).toBeVisible();
    const pendingCard = page.locator('article.card').filter({ hasText: `CWL: ${PENDING_UID}` });
    await expect(pendingCard).toContainText('Pending first login');

    await cwlInput.fill(ACTIVE_UID.toUpperCase());
    await page.getByRole('button', { name: 'Grant Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Instructor access granted to ${ACTIVE_UID}.`,
      }),
    ).toBeVisible();
    const activeCard = page.locator('article.card').filter({ hasText: `CWL: ${ACTIVE_UID}` });
    await expect(activeCard).toContainText('E2E Active Professor');
    await expect(activeCard).toContainText('Active');

    const searchInput = page.locator('#admin-instructor-search');
    await searchInput.fill('pending-prof');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(pendingCard).toBeVisible();
    await expect(activeCard).toHaveCount(0);

    await searchInput.fill('');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(pendingCard).toBeVisible();
    await expect(activeCard).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await pendingCard.getByRole('button', { name: 'Revoke Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Instructor access revoked for ${PENDING_UID}.`,
      }),
    ).toBeVisible();
    await expect(pendingCard).toHaveCount(0);

    page.once('dialog', (dialog) => void dialog.accept());
    await activeCard.getByRole('button', { name: 'Revoke Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Instructor access revoked for ${ACTIVE_UID}.`,
      }),
    ).toBeVisible();
    await expect(activeCard).toHaveCount(0);

    await expect.poll(async () => {
      const [grants, user] = await Promise.all([
        platformInstructorGrantsCol().countDocuments({
          uid: { $in: [ACTIVE_UID, PENDING_UID] },
        }),
        usersCol().findOne({ puid: ACTIVE_PUID }),
      ]);
      return {
        grants,
        platformInstructor: user?.platformInstructor ?? false,
      };
    }).toEqual({ grants: 0, platformInstructor: false });

    expect(browserErrors).toEqual([]);
  });
});
