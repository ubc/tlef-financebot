// Unit test — a PURE function. buildMembersOverview() has no external
// dependencies, so it needs no mocks: give it a domain User, assert the shape.
import { buildMembersOverview } from '../../server/src/services/members.service';
import type { User } from '../../server/src/types/domain';

/** A minimal domain User fixture; the demo only reads identity fields. */
function user(over: Partial<User>): User {
  return {
    puid: 'PUID-0001',
    uid: 'ada',
    displayName: 'Ada Lovelace',
    email: 'ada@ubc.ca',
    affiliations: ['faculty'],
    isAdmin: false,
    courseRoles: [],
    createdAt: new Date(),
    lastLoginAt: new Date(),
    ...over,
  };
}

describe('buildMembersOverview', () => {
  it('exposes the display name and identity from the domain User', () => {
    const overview = buildMembersOverview(user({ displayName: 'Ada Lovelace', puid: 'PUID-ABC' }));
    expect(overview.displayName).toBe('Ada Lovelace');
    expect(overview.puid).toBe('PUID-ABC');
    expect(overview.message).toContain('Ada Lovelace');
    expect(overview.affiliations).toEqual(['faculty']);
    expect(typeof overview.serverTime).toBe('string');
  });

  it('falls back to email, then uid, when displayName is empty', () => {
    expect(buildMembersOverview(user({ displayName: '', email: 'a@b.ca' })).displayName).toBe('a@b.ca');
    expect(buildMembersOverview(user({ displayName: '', email: '', uid: 'only-uid' })).displayName).toBe('only-uid');
  });
});
