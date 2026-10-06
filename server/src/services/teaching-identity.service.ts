import type { WithId } from 'mongodb';
import { usersCol } from '../components/mongodb/collections';
import type { User } from '../types/domain';

type IdentityFailure = (reason: string, status: number) => never;
const UBC_EMAIL = /^[^\s@]+@(?:[^\s@.]+\.)*ubc\.ca$/i;

/** Shared TA/Instructor input contract: UBC email or an existing CWL username.
 * Canonical PUID/email comes from persisted SAML identity, never an email guess. */
export async function resolveTeachingIdentity(raw: string, fail: IdentityFailure): Promise<{ email: string; user?: WithId<User> }> {
  const identifier = raw.trim().toLowerCase();
  const isEmail = identifier.includes('@');
  if (isEmail ? identifier.length > 254 || !UBC_EMAIL.test(identifier) : !/^[a-z0-9._-]{2,64}$/i.test(identifier)) {
    fail(isEmail ? 'invalid-email' : 'invalid-identifier', 400);
  }
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = await usersCol().find({ [isEmail ? 'email' : 'uid']: { $regex: `^${escaped}$`, $options: 'i' } }).limit(2).toArray();
  if (matches.length > 1) fail(isEmail ? 'ambiguous-email' : 'ambiguous-cwl', 409);
  const user = matches[0];
  if (!isEmail && !user) fail('cwl-not-found', 404);
  if (user?.deactivatedAt) fail('user-deactivated', 409);
  const email = isEmail ? identifier : user?.email.trim().toLowerCase() ?? '';
  if (!UBC_EMAIL.test(email)) fail('invalid-email', 400);
  return { email, ...(user ? { user } : {}) };
}
