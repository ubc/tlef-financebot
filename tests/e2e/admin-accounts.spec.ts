import { expect, test } from '@playwright/test';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  auditCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

const ACTIVE_PUID = 'PUID-E2E-ADMIN-ACTIVE-PROF';
const PENDING_PUID = 'PUID-E2E-ADMIN-PENDING-PROF';

let adminPuid = '';
let originalIsAdmin = false;

async function cleanAdminFixtures(): Promise<void> {
  await Promise.all([
    platformInstructorGrantsCol().deleteMany({
      puid: { $in: [ACTIVE_PUID, PENDING_PUID] },
    }),
    usersCol().deleteMany({
      puid: { $in: [ACTIVE_PUID, PENDING_PUID] },
    }),
    auditCol().deleteMany({
      action: { $in: ['role.assign', 'role.revoke'] },
      'detail.puid': { $in: [ACTIVE_PUID, PENDING_PUID] },
    }),
  ]);
}

test.describe('Admin user accounts', () => {
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
      uid: '',
      displayName: 'E2E Active Professor',
      email: '',
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

  test('lists every user and grants/searches/revokes by PUID with empty uid', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    await page.goto('/#/admin/accounts');
    await expect(page.getByRole('heading', { name: 'User Accounts' })).toBeVisible();
    await expect(page.getByText('E2E Active Professor')).toBeVisible();

    const puidInput = page.locator('#admin-instructor-puid');
    await puidInput.fill(`  ${PENDING_PUID}  `);
    await page.getByRole('button', { name: 'Add as Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Grant saved for ${PENDING_PUID}; it will activate on first login.`,
      }),
    ).toBeVisible();
    const pendingCard = page.locator('article.card').filter({
      hasText: `PUID: ${PENDING_PUID}`,
    });
    await expect(pendingCard).toContainText('Pending first login');

    await puidInput.fill(ACTIVE_PUID);
    await page.getByRole('button', { name: 'Add as Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: 'Instructor access granted to E2E Active Professor.',
      }),
    ).toBeVisible();
    const activeCard = page.locator('article.card').filter({
      hasText: `PUID: ${ACTIVE_PUID}`,
    });
    await expect(activeCard).toContainText('E2E Active Professor');
    await expect(activeCard).toContainText('CWL username was not released by SAML.');
    await expect(activeCard).toContainText('Instructor');

    const searchInput = page.locator('#admin-user-search');
    await searchInput.fill('PENDING-PROF');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(pendingCard).toBeVisible();
    await expect(activeCard).toHaveCount(0);

    await searchInput.fill('Active Professor');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(activeCard).toBeVisible();
    await expect(pendingCard).toHaveCount(0);

    await searchInput.fill('');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(pendingCard).toBeVisible();
    await expect(activeCard).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await pendingCard.getByRole('button', { name: 'Revoke Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Instructor access revoked for ${PENDING_PUID}.`,
      }),
    ).toBeVisible();
    await expect(pendingCard).toHaveCount(0);

    page.once('dialog', (dialog) => void dialog.accept());
    await activeCard.getByRole('button', { name: 'Revoke Instructor' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: 'Instructor access revoked for E2E Active Professor.',
      }),
    ).toBeVisible();
    await expect(activeCard).toBeVisible();
    await expect(activeCard.getByRole('button', { name: 'Grant Instructor' })).toBeVisible();

    await expect.poll(async () => {
      const [grants, user] = await Promise.all([
        platformInstructorGrantsCol().countDocuments({
          puid: { $in: [ACTIVE_PUID, PENDING_PUID] },
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
