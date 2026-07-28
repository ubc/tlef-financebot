import type { Filter, WithId } from 'mongodb';
import {
  auditCol,
  platformInstructorGrantsCol,
  usersCol,
} from '../components/mongodb/collections';
import type { PlatformInstructorGrant, User } from '../types/domain';

export interface PlatformInstructorAccount {
  uid: string;
  status: 'active' | 'pending';
  grantedAt: string;
  updatedAt: string;
  user?: {
    displayName: string;
    email: string;
    lastLoginAt: string;
  };
}

export interface PlatformInstructorRevokeResult {
  uid: string;
  granted: false;
  revoked: boolean;
}

/** CWL usernames are case-insensitive; persistence uses one canonical form. */
export function normalizeCwlUid(rawUid: string): string {
  return rawUid.trim().toLowerCase();
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactUid(uid: string): RegExp {
  return new RegExp(`^${escapedRegex(uid)}$`, 'i');
}

function accountFrom(
  grant: WithId<PlatformInstructorGrant>,
  user?: WithId<User>,
): PlatformInstructorAccount {
  return {
    uid: grant.uid,
    status: user ? 'active' : 'pending',
    grantedAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
    ...(user
      ? {
          user: {
            displayName: user.displayName,
            email: user.email,
            lastLoginAt: user.lastLoginAt.toISOString(),
          },
        }
      : {}),
  };
}

export async function listPlatformInstructors(query = ''): Promise<PlatformInstructorAccount[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const filter: Filter<PlatformInstructorGrant> = normalizedQuery
    ? { uid: { $regex: escapedRegex(normalizedQuery), $options: 'i' } }
    : {};
  const grants = await platformInstructorGrantsCol()
    .find(filter)
    .sort({ uid: 1 })
    .limit(100)
    .toArray();
  if (grants.length === 0) return [];

  const users = await usersCol()
    .find({ uid: { $in: grants.map((grant) => exactUid(grant.uid)) } })
    .toArray();
  const userByUid = new Map(users.map((user) => [normalizeCwlUid(user.uid), user]));

  return grants.map((grant) => accountFrom(grant, userByUid.get(grant.uid)));
}

export async function grantPlatformInstructor(
  rawUid: string,
  actorPuid: string,
): Promise<PlatformInstructorAccount> {
  const uid = normalizeCwlUid(rawUid);
  const now = new Date();
  const grant = await platformInstructorGrantsCol().findOneAndUpdate(
    { uid },
    {
      $set: { grantedByPuid: actorPuid, updatedAt: now },
      $setOnInsert: { uid, createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!grant) throw new Error('platform-instructor-grant-write-failed');

  const user = await usersCol().findOneAndUpdate(
    { uid: exactUid(uid) },
    { $set: { platformInstructor: true } },
    { returnDocument: 'after' },
  );

  let linkedGrant = grant;
  if (user) {
    const appliedAt = new Date();
    await platformInstructorGrantsCol().updateOne(
      { _id: grant._id },
      { $set: { appliedToPuid: user.puid, appliedAt } },
    );
    linkedGrant = { ...grant, appliedToPuid: user.puid, appliedAt };
  }

  await auditCol().insertOne({
    actorPuid,
    action: 'role.assign',
    targetType: 'platform-instructor-grant',
    targetId: grant._id,
    detail: { uid, linkedPuid: user?.puid ?? null },
    createdAt: now,
  });

  return accountFrom(linkedGrant, user ?? undefined);
}

export async function revokePlatformInstructor(
  rawUid: string,
  actorPuid: string,
): Promise<PlatformInstructorRevokeResult> {
  const uid = normalizeCwlUid(rawUid);
  const grant = await platformInstructorGrantsCol().findOneAndDelete({ uid });
  const userUpdate = await usersCol().updateMany(
    { uid: exactUid(uid) },
    { $unset: { platformInstructor: '' } },
  );
  const revoked = Boolean(grant) || userUpdate.modifiedCount > 0;

  if (grant) {
    await auditCol().insertOne({
      actorPuid,
      action: 'role.revoke',
      targetType: 'platform-instructor-grant',
      targetId: grant._id,
      detail: { uid, linkedPuid: grant.appliedToPuid ?? null },
      createdAt: new Date(),
    });
  }

  return { uid, granted: false, revoked };
}
