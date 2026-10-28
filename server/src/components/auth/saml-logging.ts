import { env } from '../../config/env';
import { describeSamlAttributes } from './saml-attributes';

/** Attribute names diagnose mapping failures; values are limited to explicit local development. */
export function logSamlAttributes(
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
  if (env.samlDebugAttributes && env.samlEnvironment === 'LOCAL' && env.nodeEnv === 'development') {
    console.warn(
      `[server] SAML: attribute values (SAML_DEBUG_ATTRIBUTES=true — personal data): ` +
        JSON.stringify(attributes),
    );
  }
}
