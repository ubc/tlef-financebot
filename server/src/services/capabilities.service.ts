import type { ObjectId } from 'mongodb';
import { capabilitySettingsCol } from '../components/mongodb/collections';
import type {
  Capability,
  CapabilityRole,
  CapabilitySettings,
  CourseRole,
  User,
} from '../types/domain';

export type { Capability } from '../types/domain';

export const CAPABILITIES = [
  'question.review',
  'question.suggest-edit',
  'question.mark-reviewed',
  'question.create-draft',
  'question.approve',
  'flag.triage',
  'flag.resolve',
  'analytics.view',
  'analytics.individual',
  'exam.configure',
  'course.manage-tas',
  'materials.upload',
  'hierarchy.edit',
] as const satisfies readonly Capability[];

const TA_DEFAULTS = new Set<Capability>([
  'question.review',
  'question.suggest-edit',
  'question.mark-reviewed',
  'flag.triage',
]);

export const PLATFORM_DEFAULTS = Object.fromEntries(CAPABILITIES.map((capability) => [
  capability,
  {
    student: false,
    instructor: true,
    ta: TA_DEFAULTS.has(capability),
    admin: true,
  },
])) as Record<Capability, Record<CapabilityRole, boolean>>;

const TA_HARD_DENY = new Set<Capability>(['question.approve', 'flag.resolve']);

export interface EffectivePermission {
  value: boolean;
  source: 'default' | 'course' | 'admin-override' | 'user-override';
}

async function settingsFor(courseId: ObjectId): Promise<{
  course: CapabilitySettings | null;
  platform: CapabilitySettings | null;
}> {
  const [course, platform] = await Promise.all([
    capabilitySettingsCol().findOne({ scope: 'course', courseId }),
    capabilitySettingsCol().findOne({ scope: 'platform' }),
  ]);
  return { course, platform };
}

export async function effectivePermission(
  courseId: ObjectId,
  role: CapabilityRole,
  capability: Capability,
  puid?: string,
): Promise<EffectivePermission> {
  if (role === 'admin') return { value: true, source: 'default' };
  if (role === 'ta' && TA_HARD_DENY.has(capability)) {
    return { value: false, source: 'default' };
  }
  const settings = await settingsFor(courseId);
  const userValue = puid === undefined
    ? undefined
    : settings.course?.userOverrides?.[puid]?.[capability];
  if (userValue !== undefined) return { value: userValue, source: 'user-override' };
  const courseValue = settings.course?.assignments[capability]?.[role];
  if (courseValue !== undefined) return { value: courseValue, source: 'course' };
  const platformValue = settings.platform?.assignments[capability]?.[role];
  if (platformValue !== undefined) return { value: platformValue, source: 'admin-override' };
  return { value: PLATFORM_DEFAULTS[capability][role], source: 'default' };
}

export async function hasCapability(
  user: User,
  courseId: ObjectId,
  capability: Capability,
): Promise<boolean> {
  if (user.isAdmin) return true;
  const role = user.courseRoles.find((entry) => entry.courseId.equals(courseId))?.role;
  if (!role) return false;
  return (await effectivePermission(courseId, role, capability, user.puid)).value;
}

export async function setCourseUserCapabilities(
  courseId: ObjectId,
  puid: string,
  permissions: Partial<Record<Capability, boolean>>,
  updatedBy: string,
): Promise<void> {
  const current = await capabilitySettingsCol().findOne({ scope: 'course', courseId });
  const previous = current?.userOverrides?.[puid] ?? {};
  const sanitized = Object.fromEntries(Object.entries(permissions).filter(
    ([capability]) => CAPABILITIES.includes(capability as Capability),
  )) as Partial<Record<Capability, boolean>>;
  await capabilitySettingsCol().updateOne(
    { scope: 'course', courseId },
    {
      $set: {
        userOverrides: {
          ...(current?.userOverrides ?? {}),
          [puid]: { ...previous, ...sanitized },
        },
        updatedBy,
        updatedAt: new Date(),
      },
      $setOnInsert: { scope: 'course', courseId, assignments: {} },
    },
    { upsert: true },
  );
}

export async function saveCapabilitySettings(
  scope: { scope: 'platform' } | { scope: 'course'; courseId: ObjectId },
  assignments: CapabilitySettings['assignments'],
  updatedBy: string,
): Promise<void> {
  await capabilitySettingsCol().updateOne(
    scope,
    {
      $set: { assignments, updatedBy, updatedAt: new Date() },
      $setOnInsert: scope,
    },
    { upsert: true },
  );
}

export function courseRole(user: User, courseId: ObjectId): CourseRole | undefined {
  return user.courseRoles.find((entry) => entry.courseId.equals(courseId))?.role;
}
