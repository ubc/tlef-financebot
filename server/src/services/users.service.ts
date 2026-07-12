import { usersCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { User } from '../types/domain';

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

/**
 * ST-E01: map the CWL PUID to a FinanceBot identity with no profile-creation
 * step. First login inserts; later logins refresh identity attributes and
 * lastLoginAt while preserving courseRoles and consent fields.
 */
export async function upsertUserFromSaml(attributes: Record<string, unknown>): Promise<User> {
  const puid = attr(attributes, 'ubcEduCwlPuid');
  if (!puid) {
    throw new Error('SAML profile is missing ubcEduCwlPuid (PUID); refusing to create a session.');
  }
  const givenName = attr(attributes, 'givenName');
  const sn = attr(attributes, 'sn');
  const result = await usersCol().findOneAndUpdate(
    { puid },
    {
      $set: {
        uid: attr(attributes, 'uid'),
        email: attr(attributes, 'mail'),
        displayName: [givenName, sn].filter(Boolean).join(' ') || attr(attributes, 'uid'),
        affiliations: attrList(attributes, 'eduPersonAffiliation'),
        isAdmin: env.adminCwlAllowlist.includes(puid),
        lastLoginAt: new Date(),
      },
      $setOnInsert: { courseRoles: [], createdAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return result as unknown as User;
}

export async function findUserByPuid(puid: string): Promise<User | null> {
  return usersCol().findOne({ puid });
}
