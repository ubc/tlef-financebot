import fs from 'node:fs';
import path from 'node:path';
import passport from 'passport';
import { Strategy as UBCShibStrategy } from 'passport-ubcshib';
import { env } from '../../../config/env';

/**
 * The authenticated user we store in the session. In this boilerplate we keep
 * the whole (small) SAML profile in the session, which avoids needing a users
 * collection. A real app would upsert a user record in MongoDB here and store
 * only its id — see AGENTS.md.
 */
export interface AppUser {
  nameId: string;
  attributes: Record<string, unknown>;
}

/** Attributes we ask the IdP for (friendly names; mapped by passport-ubcshib). */
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
  let ok = false;
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
      attributeConfig: ATTRIBUTES,
      // The local IdP does not sign our AuthnRequests or use SLO, and skipping
      // InResponseTo validation avoids a request-cache dependency in dev.
      enableSLO: false,
      validateInResponseTo: false,
    },
    (profile, done) => {
      const user: AppUser = {
        nameId: profile.nameID,
        attributes: profile.attributes ?? {},
      };
      done(null, user);
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
