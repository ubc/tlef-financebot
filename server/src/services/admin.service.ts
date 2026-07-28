import type { Filter, WithId } from 'mongodb';
import {
  auditCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../components/mongodb/collections';
import type { PlatformInstructorGrant, User } from '../types/domain';

export interface AdminAccount {
  puid: string;
  status: 'active' | 'pending';
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
    status: 'active',
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

  if (grant) {
    await auditCol().insertOne({
      actorPuid,
      action: 'role.revoke',
      targetType: 'platform-instructor-grant',
      targetId: grant._id,
      detail: { puid },
      createdAt: new Date(),
    });
  }

  return { puid, granted: false, revoked };
}
