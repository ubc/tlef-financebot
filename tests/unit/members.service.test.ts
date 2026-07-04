// Unit test — a PURE function. buildMembersOverview() has no external
// dependencies, so it needs no mocks: give it an AppUser, assert the shape.
import { buildMembersOverview } from '../../server/src/services/members.service';
import type { AppUser } from '../../server/src/components/auth';

describe('buildMembersOverview', () => {
  it('builds a friendly display name from givenName + sn', () => {
    const user: AppUser = {
      nameId: '_abc123',
      attributes: { givenName: 'Ada', sn: 'Lovelace', mail: 'ada@ubc.ca' },
    };
    const overview = buildMembersOverview(user);
    expect(overview.displayName).toBe('Ada Lovelace');
    expect(overview.nameId).toBe('_abc123');
    expect(overview.message).toContain('Ada Lovelace');
    expect(overview.attributes).toEqual(user.attributes);
    expect(typeof overview.serverTime).toBe('string');
  });

  it('takes the first value of an array-valued SAML attribute', () => {
    const overview = buildMembersOverview({
      nameId: 'x',
      attributes: { givenName: ['Grace'], sn: ['Hopper'] },
    });
    expect(overview.displayName).toBe('Grace Hopper');
  });

  it('falls back to mail, then nameId, when no name attributes are present', () => {
    expect(buildMembersOverview({ nameId: 'x', attributes: { mail: 'a@b.ca' } }).displayName).toBe(
      'a@b.ca',
    );
    expect(buildMembersOverview({ nameId: 'only-id', attributes: {} }).displayName).toBe('only-id');
  });
});
