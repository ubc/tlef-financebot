// Pure-logic tests for the Topic row's progressive-release pill. No DOM
// needed — `themeAvailability` is plain date logic; importing structure.ts
// pulls in dom.ts/api.ts without touching `document`, the same as the other
// client view tests. See client/src/views/instructor/structure.ts.
import { themeAvailability } from '../../client/src/views/instructor/structure';

describe('themeAvailability', () => {
  const now = new Date('2026-09-05T12:00:00Z');

  it('is "Not released" when no date is set or the date is unreadable — the default', () => {
    expect(themeAvailability(undefined, now)).toEqual({ state: 'unreleased', label: 'Not released' });
    expect(themeAvailability('', now).state).toBe('unreleased');
    expect(themeAvailability('not a date', now).state).toBe('unreleased');
  });

  it('is scheduled for a future date', () => {
    const result = themeAvailability('2026-10-01T00:00:00Z', now);
    expect(result.state).toBe('scheduled');
    expect(result.label).toMatch(/^Releases on /);
  });

  it('is released for a past date, including one earlier today', () => {
    expect(themeAvailability('2026-09-01T00:00:00Z', now).state).toBe('released');
    expect(themeAvailability('2026-09-05T08:00:00Z', now).label).toMatch(/^Released on /);
  });
});
