import fs from 'node:fs';
import path from 'node:path';
import passport from 'passport';
import { Strategy as UBCShibStrategy } from 'passport-ubcshib';
import { env } from '../../../config/env';
import { upsertUserFromSaml } from '../../../services/users.service';
import { describeSamlAttributes, resolveSamlAttributes } from '../saml-attributes';

/**
 * The authenticated user we store in the session. In this boilerplate we keep
 * the whole (small) SAML profile in the session, which avoids needing a users
 * collection. A real app would upsert a user record in MongoDB here and store
 * only its id — see AGENTS.md.
 */
export interface AppUser {
  nameId: string;
  puid: string;
  attributes: Record<string, unknown>;
}

/**
 * Attributes we ask the IdP for (friendly names; mapped by passport-ubcshib).
 * The library's mapping is incomplete, so the verify callback re-resolves them
 * with `resolveSamlAttributes()` — see `../saml-attributes.ts`.
 */
const ATTRIBUTES = [
  'uid',
  'ubcEduCwlPuid',
  'mail',
  'eduPersonAffiliation',
  'givenName',
  'sn',
  'eduPersonPrincipalName',
];

/** Absolute path to the configured IdP certificate. */
export function resolveIdpCertPath(): string {
  return path.isAbsolute(env.samlIdpCertPath)
    ? env.samlIdpCertPath
    : path.resolve(process.cwd(), env.samlIdpCertPath);
}

/** Guidance shown when the IdP certificate is missing. */
function missingCertMessage(certPath: string): string {
  const hint =
    env.samlEnvironment === 'LOCAL'
      ? 'With docker-simple-saml running, run "npm run saml:fetch-cert" (or copy docker-simple-saml/cert/server.crt there).'
      : 'Provide the staging/production IdP signing certificate at that path.';
  return (
    `SAML IdP certificate not found at "${certPath}" (SAML_ENVIRONMENT=${env.samlEnvironment}). ` +
    `passport-ubcshib requires the IdP's public signing certificate. ${hint} ` +
    `See server/src/components/auth/AGENTS.md.`
  );
}

/**
 * Startup preflight: confirm the IdP certificate exists (and is non-empty) so
 * the app fails fast with clear guidance instead of only erroring when the
 * strategy is first constructed. Logs a success line when present.
 */
export function verifyIdpCertificatePresent(): void {
  const certPath = resolveIdpCertPath();
  let ok: boolean;
  try {
    ok = fs.statSync(certPath).size > 0;
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(missingCertMessage(certPath));
  }
  console.log(
    `[server] SAML: IdP certificate found at ${certPath} (SAML_ENVIRONMENT=${env.samlEnvironment})`,
  );
}

/**
 * Read the IdP's signing certificate. passport-ubcshib's Strategy throws if no
 * `cert` is provided, so we surface a clear, actionable error when it is
 * missing rather than the library's generic one.
 */
function loadIdpCert(): string {
  const certPath = resolveIdpCertPath();
  try {
    return fs.readFileSync(certPath, 'utf8');
  } catch {
    throw new Error(missingCertMessage(certPath));
  }
}

/**
 * Log what the IdP actually asserted about the user, every login.
 *
 * When login fails because an attribute is missing, the only question that
 * matters is whether the IdP released it at all — and against an IdP you do not
 * control (UBC IAM's), you cannot answer that by reading your own code. So we
 * log the assertion's attribute NAMES (not values: those are personal data)
 * plus what we resolved them to. Three outcomes are then distinguishable:
 *
 *   - no names at all      -> the IdP released nothing; an IAM-side change.
 *   - names, but not ours  -> released under a name we do not recognise; add it
 *                             to SAML_ATTRIBUTE_ALIASES in ../saml-attributes.ts.
 *   - names resolved       -> our side is fine.
 *
 * Set SAML_DEBUG_ATTRIBUTES=true to also log the values. That is personal data
 * (names, email, PUID) going into the server log, so keep it off except for a
 * short, deliberate diagnostic window.
 */
function logSamlAttributes(
  profile: Record<string, unknown>,
  attributes: Record<string, unknown>,
): void {
  const { rawNames, resolvedNames, missingNames } = describeSamlAttributes(profile, attributes);
  console.log(
    `[server] SAML: assertion attribute names: ${rawNames.join(', ') || '(none released)'}`,
  );
  console.log(`[server] SAML: resolved as: ${resolvedNames.join(', ') || '(none)'}`);
  if (missingNames.length > 0) {
    console.warn(
      `[server] SAML: required attribute(s) not resolved: ${missingNames.join(', ')}. ` +
        `Either the IdP did not release them (ask UBC IAM), or they arrived under an ` +
        `unrecognised name — compare against the assertion attribute names logged above.`,
    );
  }
  if (env.samlDebugAttributes) {
    console.warn(
      `[server] SAML: attribute values (SAML_DEBUG_ATTRIBUTES=true — personal data): ` +
        JSON.stringify(attributes),
    );
  }
}

/** Register the "ubcshib" strategy on the shared passport instance. */
export function registerShibbolethStrategy(): void {
  const strategy = new UBCShibStrategy(
    {
      issuer: env.samlIssuer,
      callbackUrl: env.samlCallbackUrl,
      // Explicitly set the IdP endpoints: the library's built-in LOCAL preset
      // points at :8080, but docker-simple-saml actually runs on :6122.
      entryPoint: env.samlEntryPoint,
      logoutUrl: env.samlLogoutUrl,
      metadataUrl: env.samlIdpMetadataUrl,
      cert: loadIdpCert(),
      // SP private key: passport-ubcshib loads this into passport-saml as both
      // `privateKey` (to sign our AuthnRequests) and `decryptionPvk` (to decrypt
      // assertions the IdP encrypts to us). Required on STAGING/PRODUCTION, where
      // the real UBC IdP encrypts assertions and may require signed requests.
      // Blank for LOCAL, where the docker-simple-saml IdP does neither. Pass
      // undefined (not '') so the library's "no key" path is taken when unset.
      privateKeyPath: env.samlPrivateKeyPath || undefined,
      attributeConfig: ATTRIBUTES,
      // The local IdP does not sign our AuthnRequests or use SLO, and skipping
      // InResponseTo validation avoids a request-cache dependency in dev.
      enableSLO: false,
      validateInResponseTo: false,
    },
    (profile, done) => {
      // Re-resolve the attributes rather than using profile.attributes directly:
      // passport-ubcshib's mapping drops some names the real UBC IdP uses.
      const raw = profile as unknown as Record<string, unknown>;
      const attributes = resolveSamlAttributes(raw);
      logSamlAttributes(raw, attributes);
      // ST-E01: PUID -> FinanceBot identity on every login; no profile step.
      upsertUserFromSaml(attributes)
        .then((user) => done(null, { nameId: profile.nameID, puid: user.puid, attributes }))
        .catch((err) => done(err as Error));
    },
  );

  // passport-ubcshib does not forward `forceAuthn` to passport-saml, so set it
  // on the underlying SAML options directly. With ForceAuthn, the IdP re-prompts
  // for credentials even if it still holds an SSO session — so after our local
  // logout, the next login sends the user back to the IdP login page.
  if (env.samlForceAuthn) {
    const withSaml = strategy as unknown as {
      _saml?: { options?: { forceAuthn?: boolean } };
    };
    if (withSaml._saml?.options) {
      withSaml._saml.options.forceAuthn = true;
    }
  }

  passport.use(strategy);
}
