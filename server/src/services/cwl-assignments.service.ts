import { coursePeopleAccessCol, platformAdminGrantsCol, platformInstructorGrantsCol, usersCol } from '../components/mongodb/collections';
import type { User } from '../types/domain';

export const CWL_USERNAME = /^[A-Za-z0-9._-]{2,64}$/;
export function cwlAssignmentKey(username: string): string {
  return `cwl:${username.trim().toLowerCase()}`;
}

function duplicateKey(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 11000;
}

/** Called only with identity from the current verified SAML assertion. */
export async function activateCwlAssignments(user: User, assertedCwl: string): Promise<void> {
  if (user.deactivatedAt || !CWL_USERNAME.test(assertedCwl.trim()) || user.puid.startsWith('cwl:')) return;
  const key = cwlAssignmentKey(assertedCwl);
  const platform = [platformAdminGrantsCol(), platformInstructorGrantsCol()];
  const courseAccess = coursePeopleAccessCol();
  const [admin, instructor, invitations] = await Promise.all([
    platform[0].findOne({ puid: key }), platform[1].findOne({ puid: key }),
    courseAccess.find({ subject: key, status: 'pending', puid: { $exists: false } }).toArray(),
  ]);
  if (!admin && !instructor && !invitations.length) return;

  const escaped = assertedCwl.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identities = await usersCol().find({ uid: { $regex: `^${escaped}$`, $options: 'i' } }).limit(2).toArray();
  if (identities.length !== 1 || identities[0].puid !== user.puid) return;

  for (const [index, grant] of [admin, instructor].entries()) {
    if (!grant) continue;
    const source = { _id: grant._id, puid: key };
    try {
      // Cancellation and binding compete for the same pending document.
      await platform[index].updateOne(source, { $set: { puid: user.puid, updatedAt: new Date() } });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      // The destination already has this role. Consume the redundant pending grant.
      await platform[index].deleteOne(source);
    }
  }
  for (const invitation of invitations) {
    const source = { _id: invitation._id, subject: key, status: 'pending' as const, revision: invitation.revision };
    try {
      await courseAccess.updateOne(source, {
        $set: { subject: `puid:${user.puid}`, puid: user.puid, status: 'active', updatedAt: new Date() },
        $inc: { revision: 1 },
      });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      // An existing PUID decision takes precedence, including bans or revocations.
      await courseAccess.updateOne(source, {
        $set: { status: 'revoked', updatedAt: new Date() }, $inc: { revision: 1 },
      });
    }
  }
}
