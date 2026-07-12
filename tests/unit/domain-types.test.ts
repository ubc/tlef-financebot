import { canTransition, PUBLICATION_TRANSITIONS } from '../../server/src/types/domain';

describe('publication state machine (PRD §6.2)', () => {
  it('allows the forward pipeline path', () => {
    expect(canTransition('draft', 'pending-review')).toBe(true);
    expect(canTransition('pending-review', 'reviewed')).toBe(true);
    expect(canTransition('reviewed', 'approved')).toBe(true);
    expect(canTransition('pending-review', 'approved')).toBe(true); // instructor approves directly
  });

  it('allows pause and resolution paths', () => {
    expect(canTransition('approved', 'paused')).toBe(true);
    expect(canTransition('paused', 'approved')).toBe(true); // flag resolved "correct"
    expect(canTransition('paused', 'archived')).toBe(true); // flag resolved "archive"
  });

  it('reject returns a reviewed question to draft', () => {
    expect(canTransition('pending-review', 'draft')).toBe(true);
    expect(canTransition('reviewed', 'draft')).toBe(true);
  });

  it('archived is reachable from every state (IN-Q07)', () => {
    for (const from of Object.keys(PUBLICATION_TRANSITIONS)) {
      if (from === 'archived') continue;
      expect(canTransition(from as never, 'archived')).toBe(true);
    }
  });

  it('restore from archived goes to draft only, and forbids nonsense moves', () => {
    expect(canTransition('archived', 'draft')).toBe(true);
    expect(canTransition('archived', 'approved')).toBe(false);
    expect(canTransition('draft', 'approved')).toBe(false); // must be reviewed first
    expect(canTransition('draft', 'paused')).toBe(false);
  });
});
