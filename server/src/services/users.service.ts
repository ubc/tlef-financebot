import {
  platformInstructorGrantsCol,
  usersCol,
} from '../components/mongodb/collections';
import { env } from '../config/env';
import type { User } from '../types/domain';
import { activatePendingTaInvites } from './tas.service';

/** Stephen's explicit staging bootstrap identity. Never grants production Admin. */
export const STAGING_BOOTSTRAP_ADMIN_PUID = 'ESI5CZY7J307';

/** First value of a possibly multi-valued SAML attribute, as a string. */
function attr(attributes: Record<string, unknown>, key: string): string {
  const raw = attributes[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value == null ? '' : String(value);
}

function attrList(attributes: Record<string, unknown>, key: string): string[] {
  const raw = attributes[key];
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values.map((v) => String(v).toLowerCase());
}

export function isPlatformAdminPuid(
  puid: string,
  samlEnvironment = env.samlEnvironment,
): boolean {
  return (
    env.adminCwlAllowlist.includes(puid) ||
    (samlEnvironment === 'STAGING' && puid === STAGING_BOOTSTRAP_ADMIN_PUID)
  );
}

/**
 * ST-E01: map the CWL PUID to a FinanceBot identity with no profile-creation
 * step. First login inserts; later logins refresh identity attributes and
 * lastLoginAt while preserving courseRoles, consent fields, and any existing
 * platformInstructor bit. A PUID grant is applied on login even when the real
 * IdP does not release uid/name attributes; SAML affiliation alone never
 * creates the grant.
 */
export async function upsertUserFromSaml(attributes: Record<string, unknown>): Promise<User> {
  const puid = attr(attributes, 'ubcEduCwlPuid');
  if (!puid) {
    throw new Error('SAML profile is missing ubcEduCwlPuid (PUID); refusing to create a session.');
  }
  const uid = attr(attributes, 'uid') || attr(attributes, 'cwlLoginName');
  const email = attr(attributes, 'mail');
  const displayName =
    attr(attributes, 'displayName') ||
    [attr(attributes, 'givenName'), attr(attributes, 'sn')].filter(Boolean).join(' ') ||
    attr(attributes, 'cn') ||
    email ||
    uid ||
    puid;
  const platformInstructorGrant = await platformInstructorGrantsCol().findOne({ puid });
  const result = await usersCol().findOneAndUpdate(
    { puid },
    {
      $set: {
        uid,
        email,
        displayName,
        affiliations: attrList(attributes, 'eduPersonAffiliation'),
        isAdmin: isPlatformAdminPuid(puid),
        lastLoginAt: new Date(),
        platformInstructor: Boolean(platformInstructorGrant),
      },
      $setOnInsert: { courseRoles: [], createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return activatePendingTaInvites(result as unknown as User);
}

export async function findUserByPuid(puid: string): Promise<User | null> {
  const user = await usersCol().findOne({ puid });
  if (!user || user.deactivatedAt) return null;

  // The grant collection is the authorization source of truth. Recomputing
  // during Passport deserialization makes revoke effective on the next
  // request even if a login/revoke race left the denormalized User bit stale.
  const grant = await platformInstructorGrantsCol().findOne({ puid });
  return { ...user, platformInstructor: Boolean(grant) };
}
