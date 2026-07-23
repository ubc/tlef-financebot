/**
 * Resolving SAML attributes to friendly names.
 *
 * A SAML assertion names each attribute with a URN, and different IdPs use
 * different ones for the same thing:
 *
 *   - docker-simple-saml (LOCAL) sends friendly names:  `ubcEduCwlPuid`
 *   - the real UBC IdP sends an OID:                    `urn:oid:1.3.6.1.4.1.60.6.1.6`
 *   - ...or a MACE URN:                                 `urn:mace:dir:attribute-def:ubcEduCwlPuid`
 *
 * `passport-saml` keys the profile by whatever `Name` the assertion carried (it
 * never looks at `FriendlyName`), and `passport-ubcshib` then maps a handful of
 * those to friendly names in `profile.attributes`. Its table has gaps we hit in
 * practice, so a released attribute can arrive and still be dropped:
 *
 *   1. The MACE form of `ubcEduCwlPuid` is unreachable. The library builds a
 *      reverse friendly->OID map from a table where two URNs map to
 *      `ubcEduCwlPuid`; the second (the OID) overwrites the first (MACE), so a
 *      MACE-named PUID matches nothing and is silently discarded.
 *   2. `uid` and `eduPersonPrincipalName` have no OID entries at all, so they
 *      only survive when the IdP happens to send friendly names.
 *
 * Both failures look identical to "the IdP did not release the attribute",
 * which makes them expensive to diagnose against an IdP you do not control.
 * So the app does its own resolution here rather than trusting the library's
 * mapping: we start from what the library mapped and fill the gaps from the
 * raw profile. This is additive — it can only find attributes that are
 * genuinely present in the assertion.
 */

/** Attributes the app asks for, and the assertion `Name`s each can arrive as. */
export const SAML_ATTRIBUTE_ALIASES: Record<string, readonly string[]> = {
  ubcEduCwlPuid: [
    'urn:oid:1.3.6.1.4.1.60.6.1.6',
    'urn:mace:dir:attribute-def:ubcEduCwlPuid',
  ],
  uid: ['urn:oid:0.9.2342.19200300.100.1.1', 'urn:mace:dir:attribute-def:uid'],
  mail: ['urn:oid:0.9.2342.19200300.100.1.3', 'urn:mace:dir:attribute-def:mail'],
  eduPersonAffiliation: [
    'urn:oid:1.3.6.1.4.1.5923.1.1.1.1',
    'urn:mace:dir:attribute-def:eduPersonAffiliation',
  ],
  eduPersonScopedAffiliation: [
    'urn:oid:1.3.6.1.4.1.5923.1.1.1.9',
    'urn:mace:dir:attribute-def:eduPersonScopedAffiliation',
  ],
  eduPersonPrincipalName: [
    'urn:oid:1.3.6.1.4.1.5923.1.1.1.6',
    'urn:mace:dir:attribute-def:eduPersonPrincipalName',
  ],
  givenName: ['urn:oid:2.5.4.42', 'urn:mace:dir:attribute-def:givenName'],
  sn: ['urn:oid:2.5.4.4', 'urn:mace:dir:attribute-def:sn'],
  displayName: [
    'urn:oid:2.16.840.1.113730.3.1.241',
    'urn:mace:dir:attribute-def:displayName',
  ],
  cn: ['urn:oid:2.5.4.3', 'urn:mace:dir:attribute-def:cn'],
};

/**
 * Attributes without which the app cannot build a session. Logged prominently
 * when absent, since that is the one case worth taking to UBC IAM.
 */
export const REQUIRED_SAML_ATTRIBUTES: readonly string[] = ['ubcEduCwlPuid'];

/**
 * Profile keys that are SAML plumbing rather than released attributes. Excluded
 * from the raw attribute listing so the diagnostics show only what the IdP
 * actually asserted about the user.
 */
const NON_ATTRIBUTE_KEYS = new Set([
  'issuer',
  'sessionIndex',
  'nameID',
  'nameIDFormat',
  'nameQualifier',
  'spNameQualifier',
  'ID',
  'inResponseTo',
  'attributes',
  // passport-saml derives `email` from `mail`; listing both is just noise.
  'email',
]);

const MACE_PREFIX = 'urn:mace:dir:attribute-def:';

/** Treat '', null, undefined and [] as "not present". */
function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return typeof value !== 'function';
}

/**
 * The assertion `Name`s present on a profile, in the order passport-saml added
 * them. Names only — the values are personal data (see `describeSamlAttributes`).
 */
export function rawSamlAttributeNames(profile: Record<string, unknown>): string[] {
  return Object.keys(profile).filter(
    (key) =>
      !NON_ATTRIBUTE_KEYS.has(key) &&
      typeof profile[key] !== 'function' &&
      hasValue(profile[key]),
  );
}

/**
 * Friendly-named attributes for the profile: `profile.attributes` (whatever
 * passport-ubcshib managed to map) plus anything else we can identify from the
 * raw assertion names. Already-mapped values win, so this never changes
 * behaviour that already works — it only fills gaps.
 */
export function resolveSamlAttributes(profile: Record<string, unknown>): Record<string, unknown> {
  const mapped = (profile.attributes ?? {}) as Record<string, unknown>;
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (hasValue(value)) resolved[key] = value;
  }

  const rawNames = rawSamlAttributeNames(profile);

  // 1. Known aliases, in preference order.
  for (const [friendly, aliases] of Object.entries(SAML_ATTRIBUTE_ALIASES)) {
    if (hasValue(resolved[friendly])) continue;
    for (const name of [friendly, ...aliases]) {
      if (hasValue(profile[name])) {
        resolved[friendly] = profile[name];
        break;
      }
    }
  }

  // 2. Any other MACE-named attribute: its suffix IS the friendly name, so we
  //    can carry it through without needing an entry in the table above.
  for (const name of rawNames) {
    if (!name.startsWith(MACE_PREFIX)) continue;
    const friendly = name.slice(MACE_PREFIX.length);
    if (friendly && !hasValue(resolved[friendly])) {
      resolved[friendly] = profile[name];
    }
  }

  return resolved;
}

/**
 * A loggable, non-identifying summary of what arrived in the assertion: the raw
 * `Name`s the IdP sent, the friendly names we resolved from them, and the
 * required attributes still missing. Values are deliberately excluded — the
 * names alone answer "did IAM release it, and under what name?", which is the
 * question that matters when login fails.
 */
export function describeSamlAttributes(
  profile: Record<string, unknown>,
  resolved: Record<string, unknown>,
): { rawNames: string[]; resolvedNames: string[]; missingNames: string[] } {
  return {
    rawNames: rawSamlAttributeNames(profile),
    resolvedNames: Object.keys(resolved).sort(),
    missingNames: REQUIRED_SAML_ATTRIBUTES.filter((name) => !hasValue(resolved[name])),
  };
}
