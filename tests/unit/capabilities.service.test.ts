import { ObjectId } from 'mongodb';
import type { CapabilitySettings, User } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  capabilitySettingsCol: jest.fn(),
}));

import { capabilitySettingsCol } from '../../server/src/components/mongodb/collections';
import {
  CAPABILITIES,
  PLATFORM_DEFAULTS,
  effectivePermission,
  hasCapability,
} from '../../server/src/services/capabilities.service';

const courseId = new ObjectId();

function user(role: 'student' | 'instructor' | 'ta', puid = `PUID-${role}`): User {
  return {
    puid,
    uid: role,
    displayName: role,
    email: `${role}@example.ubc.ca`,
    affiliations: role === 'student' ? ['student'] : ['staff'],
    isAdmin: false,
    courseRoles: [{ courseId, role }],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

function seed(settings: CapabilitySettings[]): void {
  jest.mocked(capabilitySettingsCol).mockReturnValue({
    findOne: jest.fn(async (filter: { scope: string; courseId?: ObjectId }) => settings.find((doc) => (
      doc.scope === filter.scope
      && (doc.scope === 'platform' || doc.courseId?.equals(filter.courseId!))
    )) ?? null),
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  seed([]);
});

describe('capability resolution (§4.2)', () => {
  it('keeps instructor defaults all true and Student defaults all false', () => {
    for (const capability of CAPABILITIES) {
      expect(PLATFORM_DEFAULTS[capability].instructor).toBe(true);
      expect(PLATFORM_DEFAULTS[capability].student).toBe(false);
    }
  });

  it('enforces the hard TA approve/resolve invariant despite every override', async () => {
    seed([{
      scope: 'course',
      courseId,
      assignments: {
        'question.approve': { ta: true },
        'flag.resolve': { ta: true },
      },
      userOverrides: {
        'PUID-ta': { 'question.approve': true, 'flag.resolve': true },
      },
      updatedBy: 'admin',
      updatedAt: new Date(),
    }]);

    await expect(hasCapability(user('ta'), courseId, 'question.approve')).resolves.toBe(false);
    await expect(hasCapability(user('ta'), courseId, 'flag.resolve')).resolves.toBe(false);
  });

  it('resolves user override before course, course before platform, then default', async () => {
    seed([
      {
        scope: 'platform',
        assignments: { 'analytics.view': { ta: true } },
        updatedBy: 'admin',
        updatedAt: new Date(),
      },
      {
        scope: 'course',
        courseId,
        assignments: { 'analytics.view': { ta: false } },
        userOverrides: { special: { 'analytics.view': true } },
        updatedBy: 'instructor',
        updatedAt: new Date(),
      },
    ]);

    await expect(hasCapability(user('ta'), courseId, 'analytics.view')).resolves.toBe(false);
    await expect(hasCapability(user('ta', 'special'), courseId, 'analytics.view')).resolves.toBe(true);
    await expect(hasCapability(user('ta'), courseId, 'question.review')).resolves.toBe(true);
  });

  it('reports the winning source for effective permissions', async () => {
    seed([
      {
        scope: 'platform',
        assignments: { 'materials.upload': { ta: true } },
        updatedBy: 'admin',
        updatedAt: new Date(),
      },
      {
        scope: 'course',
        courseId,
        assignments: { 'analytics.view': { ta: true } },
        userOverrides: { special: { 'hierarchy.edit': true } },
        updatedBy: 'instructor',
        updatedAt: new Date(),
      },
    ]);

    await expect(effectivePermission(courseId, 'ta', 'question.create-draft')).resolves.toEqual({
      value: false, source: 'default',
    });
    await expect(effectivePermission(courseId, 'ta', 'materials.upload')).resolves.toEqual({
      value: true, source: 'admin-override',
    });
    await expect(effectivePermission(courseId, 'ta', 'analytics.view')).resolves.toEqual({
      value: true, source: 'course',
    });
    await expect(effectivePermission(courseId, 'ta', 'hierarchy.edit', 'special')).resolves.toEqual({
      value: true, source: 'user-override',
    });
  });

  it('grants admins every capability without consulting settings', async () => {
    const admin = { ...user('student'), isAdmin: true };

    await expect(hasCapability(admin, courseId, 'question.approve')).resolves.toBe(true);
    expect(capabilitySettingsCol).not.toHaveBeenCalled();
  });
});
