import { test, expect, type Page } from '@playwright/test';
import { AUTH_FILE } from './global-setup';

// EXAMPLE (Academic API demo) e2e coverage. Requires the FakeAcademicAPI
// container on :3689 (docker compose up in its checkout) in addition to
// MongoDB + the IdP. Seed facts used here (see FakeAcademicAPI/USERS.md):
// `faculty` teaches CPSC 110 101; `student` (student # 12345678) is on its
// roster and enrolled in nothing else; `staff` has no courses.

/** SP-initiated CWL login (test users' password equals their username). */
async function login(page: Page, username: string): Promise<void> {
  await page.goto('/auth/ubcshib');
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', username);
  // The SimpleSAMLphp login button is a bare <button>Login</button> (no type
  // attribute), so match by role/name — mirrors tests/e2e/global-setup.ts.
  await page.getByRole('button', { name: /login|log in|sign in|yes/i }).first().click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

test.describe('classes (faculty)', () => {
  test.use({ storageState: AUTH_FILE }); // global-setup signs in as `faculty`

  test('loads taught classes and the class list through the gated API', async ({ page }) => {
    // Provisioned instructors use the FinanceBot instructor router, where the
    // removable Academic API demo page is intentionally not a nav destination.
    // Keep its real integration/authorization proof at the public API boundary.
    const classesRes = await page.request.get('/api/classes');
    expect(classesRes.status()).toBe(200);
    const classes = (await classesRes.json()) as {
      teaching: Array<{ classes: Array<{ sectionId: string; courseCode: string }> }>;
    };
    const cpsc110 = classes.teaching
      .flatMap((period) => period.classes)
      .find((section) => section.courseCode === 'CPSC 110 101');
    expect(cpsc110).toBeTruthy();

    const rosterRes = await page.request.get(
      `/api/classes/${encodeURIComponent(cpsc110!.sectionId)}/students`,
    );
    expect(rosterRes.status()).toBe(200);
    const roster = (await rosterRes.json()) as {
      courseCode: string;
      students: Array<{ studentId: string }>;
    };
    expect(roster.courseCode).toBe('CPSC 110 101');
    expect(roster.students.some((student) => student.studentId === '12345678')).toBe(true);
  });
});

test.describe('classes (student)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sees enrolments only, with no class-list access', async ({ page }) => {
    await login(page, 'student');
    await page.goto('/#/classes');

    await expect(page.getByRole('heading', { name: /enrolled in/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^teaching$/i })).toHaveCount(0);
    await expect(page.getByText(/CPSC 110/).first()).toBeVisible();
    // Enrolled rows are plain rows, not buttons: no roster drill-down.
    await expect(page.getByRole('button', { name: /CPSC 110/ })).toHaveCount(0);
  });
});

test.describe('classes (staff)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('has no Classes nav item', async ({ page }) => {
    await login(page, 'staff');
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Student' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^classes$/i })).toHaveCount(0);

    const classesRes = await page.request.get('/api/classes');
    expect(classesRes.status()).toBe(403);
  });
});
