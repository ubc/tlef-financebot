// Unit tests for SAML attribute resolution.
//
// The real UBC IdP names attributes with OID or MACE URNs, while the local
// docker-simple-saml IdP sends friendly names. passport-ubcshib's own mapping
// covers only part of that space (see components/auth/saml-attributes.ts), so
// these tests pin the behaviour the app relies on: whatever naming the IdP
// uses, we end up with friendly-named attributes.
import {
  resolveSamlAttributes,
  describeSamlAttributes,
} from '../../server/src/components/auth/saml-attributes';

describe('resolveSamlAttributes', () => {
  it('keeps the friendly names the local IdP sends (via profile.attributes)', () => {
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      attributes: { uid: 'jsmith', ubcEduCwlPuid: '9876543210' },
    });
    expect(resolved.ubcEduCwlPuid).toBe('9876543210');
    expect(resolved.uid).toBe('jsmith');
  });

  it('resolves the PUID when the IdP uses the OID name', () => {
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      'urn:oid:1.3.6.1.4.1.60.6.1.6': '9876543210',
      attributes: {},
    });
    expect(resolved.ubcEduCwlPuid).toBe('9876543210');
  });

  it('resolves the PUID when the IdP uses the MACE name', () => {
    // passport-ubcshib drops this one: its reverse friendly->OID lookup keeps
    // only the last OID declared for ubcEduCwlPuid, making the MACE key
    // unreachable. This is the failure we hit on staging.
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      'urn:mace:dir:attribute-def:ubcEduCwlPuid': '9876543210',
      attributes: {},
    });
    expect(resolved.ubcEduCwlPuid).toBe('9876543210');
  });

  it('resolves uid and eduPersonPrincipalName from their OIDs', () => {
    // Neither OID appears in passport-ubcshib's mapping table at all.
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      'urn:oid:0.9.2342.19200300.100.1.1': 'jsmith',
      'urn:oid:1.3.6.1.4.1.5923.1.1.1.6': 'jsmith@ubc.ca',
      attributes: {},
    });
    expect(resolved.uid).toBe('jsmith');
    expect(resolved.eduPersonPrincipalName).toBe('jsmith@ubc.ca');
  });

  it('resolves affiliation and name attributes from their OIDs', () => {
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      'urn:oid:1.3.6.1.4.1.5923.1.1.1.1': ['faculty', 'member'],
      'urn:oid:2.5.4.42': 'Jane',
      'urn:oid:2.5.4.4': 'Smith',
      'urn:oid:0.9.2342.19200300.100.1.3': 'jane.smith@ubc.ca',
      attributes: {},
    });
    expect(resolved.eduPersonAffiliation).toEqual(['faculty', 'member']);
    expect(resolved.givenName).toBe('Jane');
    expect(resolved.sn).toBe('Smith');
    expect(resolved.mail).toBe('jane.smith@ubc.ca');
  });

  it('resolves an unlisted MACE attribute by its friendly suffix', () => {
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      'urn:mace:dir:attribute-def:eduPersonScopedAffiliation': 'faculty@ubc.ca',
      attributes: {},
    });
    expect(resolved.eduPersonScopedAffiliation).toBe('faculty@ubc.ca');
  });

  it('prefers an already-mapped value over the raw lookup', () => {
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      'urn:oid:1.3.6.1.4.1.60.6.1.6': 'raw',
      attributes: { ubcEduCwlPuid: 'mapped' },
    });
    expect(resolved.ubcEduCwlPuid).toBe('mapped');
  });

  it('ignores empty values so a blank attribute does not mask a real one', () => {
    const resolved = resolveSamlAttributes({
      nameID: 'abc',
      'urn:oid:1.3.6.1.4.1.60.6.1.6': '9876543210',
      attributes: { ubcEduCwlPuid: '' },
    });
    expect(resolved.ubcEduCwlPuid).toBe('9876543210');
  });

  it('returns nothing extra when the IdP released no attributes', () => {
    expect(resolveSamlAttributes({ nameID: 'abc', attributes: {} })).toEqual({});
  });
});

describe('describeSamlAttributes', () => {
  it('lists the raw attribute names the IdP sent, ignoring SAML plumbing', () => {
    const profile = {
      nameID: 'abc',
      nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
      issuer: 'https://authentication.stg.id.ubc.ca',
      sessionIndex: 'idx',
      getAssertionXml: () => '<xml/>',
      'urn:oid:1.3.6.1.4.1.60.6.1.6': '9876543210',
      attributes: {},
    };
    const diag = describeSamlAttributes(profile, resolveSamlAttributes(profile));
    expect(diag.rawNames).toEqual(['urn:oid:1.3.6.1.4.1.60.6.1.6']);
    expect(diag.resolvedNames).toContain('ubcEduCwlPuid');
  });

  it('reports the attributes the app wanted but did not get', () => {
    const profile = { nameID: 'abc', attributes: {} };
    const diag = describeSamlAttributes(profile, resolveSamlAttributes(profile));
    expect(diag.rawNames).toEqual([]);
    expect(diag.missingNames).toContain('ubcEduCwlPuid');
  });
});
