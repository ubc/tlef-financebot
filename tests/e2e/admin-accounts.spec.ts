import { expect, test, type Locator } from '@playwright/test';
import { AUTH_FILE } from './global-setup';
import { connectMongo } from '../../server/src/components/mongodb';
import {
  auditCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../../server/src/components/mongodb/collections';

const ACTIVE_PUID = 'PUID-E2E-ADMIN-ACTIVE-PROF';
const PENDING_PUID = 'PUID-E2E-ADMIN-PENDING-PROF';

async function openGrantMenu(row: Locator): Promise<Locator> {
  const trigger = row.getByRole('button', { name: 'Grant', exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const menu = row.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function chooseGrant(row: Locator, name: string): Promise<void> {
  const menu = await openGrantMenu(row);
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

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
    await platformInstructorGrantsCol().insertOne({
      puid: PENDING_PUID,
      grantedByPuid: adminPuid,
      createdAt: new Date(),
      updatedAt: new Date(),
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

  test('unified directory grants existing users and filters/revokes pending PUID grants with empty uid', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    // Keep optional tours out of the account workflow without changing progress.
    await page.route('**/api/tutorials**', route => route.request().method() === 'GET'
      ? route.fulfill({ json: ['admin-users', 'admin-accounts'].map(id => ({ id, role: 'admin', version: 1, status: 'dismissed' })) })
      : route.fallback());

    await page.goto('/#/admin/accounts');
    await expect(page.getByRole('heading', { name: 'User Directory', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add (?:as )?Instructor/ })).toHaveCount(0);
    await expect(page.locator('#admin-instructor-puid')).toHaveCount(0);
    const searchInput = page.getByRole('searchbox', { name: 'Search users', exact: true });
    await searchInput.fill('PUID-E2E-ADMIN-');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const activeRow = page.locator('.ac-table tbody tr').filter({
      has: page.getByRole('button', { name: 'E2E Active Professor', exact: true }),
    });
    const pendingRow = page.locator('.ac-table tbody tr').filter({
      has: page.getByRole('button', { name: PENDING_PUID, exact: true }),
    });
    await expect(activeRow).toBeVisible();
    await expect(pendingRow).toContainText('Pending first login');
    expect(await usersCol().findOne({ puid: PENDING_PUID })).toBeNull();

    const [grantResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/api/admin/platform-instructors/${ACTIVE_PUID}`)
        && response.request().method() === 'PUT'),
      chooseGrant(activeRow, 'Grant Instructor'),
    ]);
    expect(grantResponse.ok()).toBe(true);
    await expect(page.getByRole('status')).toHaveText('Instructor access granted.');
    await expect((await openGrantMenu(activeRow)).getByRole('menuitem', { name: 'Revoke Instructor', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(async () => ({
      grantCount: await platformInstructorGrantsCol().countDocuments({ puid: ACTIVE_PUID }),
      platformInstructor: (await usersCol().findOne({ puid: ACTIVE_PUID }))?.platformInstructor,
    })).toEqual({ grantCount: 1, platformInstructor: true });
    await activeRow.getByRole('button', { name: 'E2E Active Professor', exact: true }).click();
    await expect(page.locator('.ac-people-properties dd').first()).toHaveText('Not released');
    await expect(page.locator('.ac-people-properties')).toContainText(ACTIVE_PUID);
    await page.getByRole('button', { name: 'Close user details', exact: true }).click();

    await page.getByLabel('Account status', { exact: true }).selectOption('pending');
    await expect(pendingRow).toBeVisible();
    await expect(activeRow).toHaveCount(0);
    await searchInput.fill('PENDING-PROF');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(pendingRow).toBeVisible();
    await expect(activeRow).toHaveCount(0);

    await page.getByLabel('Account status', { exact: true }).selectOption('');
    await searchInput.fill('Active Professor');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(activeRow).toBeVisible();
    await expect(pendingRow).toHaveCount(0);

    await searchInput.fill('PUID-E2E-ADMIN-');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(pendingRow).toBeVisible();
    await expect(activeRow).toBeVisible();

    await chooseGrant(pendingRow, 'Revoke Instructor');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await platformInstructorGrantsCol().countDocuments({ puid: PENDING_PUID })).toBe(1);
    await chooseGrant(pendingRow, 'Revoke Instructor');
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByRole('status')).toHaveText('Instructor access revoked.');
    await expect(pendingRow).toHaveCount(0);

    await chooseGrant(activeRow, 'Revoke Instructor');
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByRole('status')).toHaveText('Instructor access revoked.');
    await expect(activeRow).toBeVisible();
    await expect((await openGrantMenu(activeRow)).getByRole('menuitem', { name: 'Grant Instructor', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

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
