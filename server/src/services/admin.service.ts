import { ObjectId, type Filter, type WithId } from 'mongodb';
import {
  auditCol,
  capabilitySettingsCol,
  platformInstructorGrantsCol,
  platformSettingsCol,
  usersCol,
} from '../components/mongodb/collections';
import {
  CAPABILITY_PROFILES,
  capabilitiesForConfigured,
  temperatureAllowed,
} from '../components/genai/llm/model-capabilities';
import { env } from '../config/env';
import {
  CAPABILITIES,
  PLATFORM_DEFAULTS,
  effectivePermission,
  saveCapabilitySettings,
} from './capabilities.service';
import { PIPELINE_STEPS } from '../types/domain';
import type {
  CapabilityRole,
  CapabilitySettings,
  CourseRole,
  PipelineStep,
  PlatformInstructorGrant,
  PlatformSettings,
  StepModelConfig,
  User,
} from '../types/domain';

export interface AdminAccount {
  puid: string;
  status: 'active' | 'pending' | 'deactivated';
  uid: string;
  displayName: string;
  email: string;
  affiliations: string[];
  isAdmin: boolean;
  platformInstructor: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  grantedAt?: string;
  updatedAt?: string;
}

export interface PlatformInstructorRevokeResult {
  puid: string;
  granted: false;
  revoked: boolean;
}

/** PUIDs are opaque identifiers; only trim accidental surrounding whitespace. */
export function normalizePuid(rawPuid: string): string {
  return rawPuid.trim();
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function accountFromUser(
  user: WithId<User>,
  grant?: WithId<PlatformInstructorGrant>,
): AdminAccount {
  return {
    puid: user.puid,
    status: user.deactivatedAt ? 'deactivated' : 'active',
    uid: user.uid,
    displayName: user.displayName || user.email || user.uid || user.puid,
    email: user.email,
    affiliations: user.affiliations,
    isAdmin: user.isAdmin,
    platformInstructor: Boolean(grant),
    lastLoginAt: user.lastLoginAt.toISOString(),
    createdAt: user.createdAt.toISOString(),
    ...(grant
      ? {
          grantedAt: grant.createdAt.toISOString(),
          updatedAt: grant.updatedAt.toISOString(),
        }
      : {}),
  };
}

function pendingAccount(grant: WithId<PlatformInstructorGrant>): AdminAccount {
  return {
    puid: grant.puid,
    status: 'pending',
    uid: '',
    displayName: grant.puid,
    email: '',
    affiliations: [],
    isAdmin: false,
    platformInstructor: true,
    grantedAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

/**
 * Admin-only directory view. It returns safe persisted identity fields, never
 * the raw SAML assertion/session, and includes PUID grants awaiting first login.
 */
export async function listAdminAccounts(query = ''): Promise<AdminAccount[]> {
  const normalizedQuery = query.trim();
  const userFilter: Filter<User> = normalizedQuery
    ? {
        $or: ['puid', 'uid', 'displayName', 'email'].map((field) => ({
          [field]: { $regex: escapedRegex(normalizedQuery), $options: 'i' },
        })),
      }
    : {};

  const [users, grants] = await Promise.all([
    usersCol().find(userFilter).sort({ lastLoginAt: -1 }).toArray(),
    platformInstructorGrantsCol().find({}).sort({ createdAt: -1 }).toArray(),
  ]);
  const grantByPuid = new Map(grants.map((grant) => [grant.puid, grant]));
  const userPuids = new Set(users.map((user) => user.puid));
  const queryRegex = normalizedQuery
    ? new RegExp(escapedRegex(normalizedQuery), 'i')
    : undefined;

  return [
    ...users.map((user) => accountFromUser(user, grantByPuid.get(user.puid))),
    ...grants
      .filter(
        (grant) =>
          !userPuids.has(grant.puid) &&
          (!queryRegex || queryRegex.test(grant.puid)),
      )
      .map(pendingAccount),
  ];
}

export async function grantPlatformInstructor(
  rawPuid: string,
  actorPuid: string,
): Promise<AdminAccount> {
  const puid = normalizePuid(rawPuid);
  const now = new Date();
  const grant = await platformInstructorGrantsCol().findOneAndUpdate(
    { puid },
    {
      $set: { grantedByPuid: actorPuid, updatedAt: now },
      $setOnInsert: { puid, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!grant) throw new Error('platform-instructor-grant-write-failed');

  const user = await usersCol().findOneAndUpdate(
    { puid },
    { $set: { platformInstructor: true } },
    { returnDocument: 'after' },
  );

  await auditCol().insertOne({
    actorPuid,
    action: 'role.assign',
    targetType: 'platform-instructor-grant',
    targetId: grant._id,
    detail: { puid, accountStatus: user ? 'active' : 'pending' },
    createdAt: now,
  });

  return user ? accountFromUser(user, grant) : pendingAccount(grant);
}

export async function revokePlatformInstructor(
  rawPuid: string,
  actorPuid: string,
): Promise<PlatformInstructorRevokeResult> {
  const puid = normalizePuid(rawPuid);
  const grant = await platformInstructorGrantsCol().findOneAndDelete({ puid });
  const userUpdate = await usersCol().updateOne(
    { puid },
    { $unset: { platformInstructor: '' } },
  );
  const revoked = Boolean(grant) || userUpdate.modifiedCount > 0;

  if (revoked) {
    await auditCol().insertOne({
      actorPuid,
      action: 'role.revoke',
      targetType: 'platform-instructor-grant',
      targetId: grant?._id ?? new ObjectId('000000000000000000000001'),
      detail: { puid },
      createdAt: new Date(),
    });
  }

  return { puid, granted: false, revoked };
}

export interface AdminUserDirectoryFilters {
  q?: string;
  role?: CourseRole;
  courseId?: ObjectId;
}

export async function listUsers(filters: AdminUserDirectoryFilters = {}): Promise<Array<WithId<User>>> {
  const query: Filter<User> = {};
  if (filters.q?.trim()) {
    const value = escapedRegex(filters.q.trim());
    query.$or = ['puid', 'uid', 'displayName', 'email'].map((field) => ({
      [field]: { $regex: value, $options: 'i' },
    }));
  }
  if (filters.role || filters.courseId) {
    query.courseRoles = { $elemMatch: {
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
      ...(filters.role ? { role: filters.role } : {}),
    } };
  }
  return usersCol().find(query).sort({ lastLoginAt: -1 }).limit(200).toArray();
}

async function auditUserMutation(
  actorPuid: string,
  action: string,
  user: WithId<User>,
  detail?: Record<string, unknown>,
  courseId?: ObjectId,
): Promise<void> {
  await auditCol().insertOne({
    actorPuid,
    action,
    targetType: 'user',
    targetId: user._id,
    ...(courseId ? { courseId } : {}),
    ...(detail ? { detail } : {}),
    createdAt: new Date(),
  });
}

export async function assignRole(
  puid: string,
  courseId: ObjectId,
  role: CourseRole,
  actorPuid: string,
): Promise<void> {
  const user = await usersCol().findOne({ puid });
  if (!user) throw new Error('admin-user-not-found');
  await usersCol().updateOne(
    { _id: user._id },
    { $addToSet: { courseRoles: { courseId, role } } },
  );
  await auditUserMutation(actorPuid, 'role.assign', user, { puid, role }, courseId);
}

export async function removeRole(
  puid: string,
  courseId: ObjectId,
  role: CourseRole,
  actorPuid: string,
  confirm = false,
): Promise<{ removed: boolean; warning?: 'orphans-course'; courseId?: string }> {
  const user = await usersCol().findOne({ puid });
  if (!user) throw new Error('admin-user-not-found');
  const hasRole = user.courseRoles.some((entry) => entry.courseId.equals(courseId) && entry.role === role);
  if (!hasRole) return { removed: false };
  if (role === 'instructor') {
    const instructorCount = await usersCol().countDocuments({
      courseRoles: { $elemMatch: { courseId, role: 'instructor' } },
    });
    if (instructorCount <= 1 && !confirm) {
      return { removed: false, warning: 'orphans-course', courseId: courseId.toHexString() };
    }
  }
  await usersCol().updateOne(
    { _id: user._id },
    { $pull: { courseRoles: { courseId, role } } },
  );
  await auditUserMutation(actorPuid, 'role.revoke', user, { puid, role }, courseId);
  return { removed: true };
}

export async function deactivateUser(puid: string, actorPuid: string): Promise<void> {
  const user = await usersCol().findOne({ puid });
  if (!user) throw new Error('admin-user-not-found');
  if (user.puid === actorPuid) throw new Error('admin-cannot-deactivate-self');
  if (!user.deactivatedAt) {
    await usersCol().updateOne({ _id: user._id }, { $set: { deactivatedAt: new Date() } });
    await auditUserMutation(actorPuid, 'user.deactivate', user, { puid });
  }
}

export async function reactivateUser(puid: string, actorPuid: string): Promise<void> {
  const user = await usersCol().findOne({ puid });
  if (!user) throw new Error('admin-user-not-found');
  if (user.deactivatedAt) {
    await usersCol().updateOne({ _id: user._id }, { $unset: { deactivatedAt: '' } });
    await auditUserMutation(actorPuid, 'user.reactivate', user, { puid });
  }
}

export async function capabilityMatrix(courseId?: ObjectId): Promise<Record<string, unknown>> {
  const scope = courseId ? { scope: 'course' as const, courseId } : { scope: 'platform' as const };
  const settings = await capabilitySettingsCol().findOne(scope);
  const roles: CapabilityRole[] = ['student', 'instructor', 'ta', 'admin'];
  const matrix = await Promise.all(CAPABILITIES.map(async (capability) => ({
    capability,
    roles: Object.fromEntries(await Promise.all(roles.map(async (role) => [
      role,
      courseId
        ? await effectivePermission(courseId, role, capability)
        : {
            value: settings?.assignments[capability]?.[role] ?? PLATFORM_DEFAULTS[capability][role],
            source: settings?.assignments[capability]?.[role] === undefined ? 'default' : 'admin-override',
          },
    ]))),
  })));
  return { scope: courseId ? 'course' : 'platform', courseId, assignments: settings?.assignments ?? {}, matrix };
}

export async function updateCapabilityMatrix(
  assignments: CapabilitySettings['assignments'],
  actorPuid: string,
  courseId?: ObjectId,
): Promise<void> {
  await saveCapabilitySettings(courseId ? { scope: 'course', courseId } : { scope: 'platform' }, assignments, actorPuid);
  await auditCol().insertOne({
    actorPuid,
    action: 'capabilities.update',
    targetType: courseId ? 'course-capabilities' : 'platform-capabilities',
    targetId: courseId ?? new ObjectId('000000000000000000000002'),
    ...(courseId ? { courseId } : {}),
    detail: { assignments },
    createdAt: new Date(),
  });
}

export function defaultPlatformSettings(): PlatformSettings {
  return {
    _id: 'platform',
    models: {
      generator: { model: env.llmModelGenerator },
      validator: { model: env.llmModelValidator },
      reviewer: { model: env.llmModelReviewer },
      masteryEvaluator: { model: env.llmModelMasteryEvaluator },
      utility: { model: env.llmDefaultModel },
    },
    customModels: [],
    costControls: { maxGenerationsPerDay: 1000 },
    featureFlags: { reviewerAgent: true, layer2Evaluator: true, retryOnReject: true },
    updatedBy: 'environment-default',
    updatedAt: new Date(0),
  };
}

/**
 * Bring a stored document up to the current shape.
 *
 * Two migrations happen on READ rather than as a script, so a database written
 * by an older deploy keeps working and a rollback stays safe:
 *
 * 1. **A step used to be a bare model-id `string`.** Documents saved before
 *    per-step parameters existed hold `models.generator: 'gpt-5.4-nano'`.
 * 2. **`utility` did not exist.** Classification, import and RAG ran on
 *    `LLM_DEFAULT_MODEL` with no admin control, so that is what it inherits.
 */
export function normalizePlatformSettings(stored: PlatformSettings): PlatformSettings {
  const fallback = defaultPlatformSettings();
  const models = {} as PlatformSettings['models'];
  for (const step of PIPELINE_STEPS) {
    const value = (stored.models as Record<string, StepModelConfig | string | undefined>)[step];
    if (typeof value === 'string') models[step] = { model: value };
    else if (value?.model) models[step] = value;
    else models[step] = fallback.models[step];
  }
  return {
    ...stored,
    models,
    customModels: stored.customModels ?? [],
    // Flags added after a document was written default ON — retryOnReject
    // landed 2026-08-17, and the cost-saving direction is an explicit opt-out.
    featureFlags: { ...fallback.featureFlags, ...stored.featureFlags },
  };
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const stored = await platformSettingsCol().findOne({ _id: 'platform' });
  return stored ? normalizePlatformSettings(stored) : defaultPlatformSettings();
}

/**
 * The model + parameters for everything that is not one of the three question
 * agents: material classification, hierarchy suggestion, and import conversion.
 * These ran on `LLM_DEFAULT_MODEL` with no admin control at all until the
 * `utility` step existed.
 */
export async function utilityStepConfig(): Promise<StepModelConfig> {
  return (await getPlatformSettings()).models.utility;
}

/**
 * Reject a step whose parameters the chosen model will not accept.
 *
 * The console will not offer an illegal combination, but the console is not the
 * only way in — this endpoint takes JSON — and an incoherent save is a hard 400
 * on the first generation call, discovered inside a background job with nothing
 * pointing back at the settings change. So the rule is enforced here too.
 */
function assertStepConfigValid(step: PipelineStep, config: StepModelConfig, customModels: PlatformSettings['customModels']): void {
  if (!config.model?.trim()) throw new Error('invalid-model-selector');
  const caps = capabilitiesForConfigured(config.model, customModels);
  if (config.reasoningEffort && !caps.reasoningEffort?.includes(config.reasoningEffort)) {
    throw new Error(`step-rejects-reasoning-effort:${step}`);
  }
  if (config.temperature !== undefined) {
    if (!temperatureAllowed(caps, config.reasoningEffort)) throw new Error(`step-rejects-temperature:${step}`);
    const { min, max } = caps.temperature!;
    if (!Number.isFinite(config.temperature) || config.temperature < min || config.temperature > max) {
      throw new Error(`temperature-out-of-range:${step}`);
    }
  }
}

export async function updatePlatformSettings(
  patch: Pick<PlatformSettings, 'models' | 'costControls' | 'featureFlags'>
    & Partial<Pick<PlatformSettings, 'customModels'>>
    & { confirmQualityImpact?: boolean },
  actorPuid: string,
): Promise<PlatformSettings> {
  if (!Number.isInteger(patch.costControls.maxGenerationsPerDay) || patch.costControls.maxGenerationsPerDay <= 0) {
    throw new Error('invalid-cost-controls');
  }
  const customModels = patch.customModels ?? [];
  for (const custom of customModels) {
    if (!custom.id?.trim()) throw new Error('invalid-model-selector');
    if (!(custom.profile in CAPABILITY_PROFILES)) throw new Error(`unknown-capability-profile:${custom.profile}`);
  }
  for (const step of PIPELINE_STEPS) {
    assertStepConfigValid(step, patch.models[step], customModels);
  }
  const current = await getPlatformSettings();
  if (current.featureFlags.reviewerAgent && !patch.featureFlags.reviewerAgent && !patch.confirmQualityImpact) {
    throw new Error('reviewer-disable-confirmation-required');
  }
  const updated: PlatformSettings = {
    _id: 'platform',
    models: patch.models,
    customModels,
    costControls: patch.costControls,
    featureFlags: patch.featureFlags,
    updatedBy: actorPuid,
    updatedAt: new Date(),
  };
  await platformSettingsCol().replaceOne({ _id: 'platform' }, updated, { upsert: true });
  await auditCol().insertOne({
    actorPuid,
    action: 'platform-settings.update',
    targetType: 'platform-settings',
    targetId: new ObjectId('000000000000000000000003'),
    detail: { models: updated.models, costControls: updated.costControls, featureFlags: updated.featureFlags },
    createdAt: updated.updatedAt,
  });
  return updated;
}
