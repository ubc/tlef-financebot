// Pure client helpers from canvas-panel.ts, run under node the way
// duplicate-name.test.ts imports courses.ts.
import { coverageMessage, bucketCounts } from '../../client/src/views/instructor/canvas-panel';

describe('coverageMessage', () => {
  it('is empty at full coverage', () => {
    expect(coverageMessage({ total: 3, integrationId: 3, sisId: 0, email: 0, loginId: 0 })).toBe('');
  });
  it('names the gap', () => {
    expect(coverageMessage({ total: 3, integrationId: 2, sisId: 0, email: 0, loginId: 0 }))
      .toBe('1 student has no student ID visible in Canvas and was not added.');
    expect(coverageMessage({ total: 5, integrationId: 2, sisId: 0, email: 0, loginId: 0 }))
      .toBe('3 students have no student ID visible in Canvas and were not added.');
  });
});

describe('bucketCounts', () => {
  it('reads the three counts an instructor needs', () => {
    expect(bucketCounts({ matched: [{}, {}], rosterOnly: [{}], appOnly: [], ambiguous: [] } as never))
      .toEqual({ matched: 2, rosterOnly: 1, appOnly: 0 });
  });
});
