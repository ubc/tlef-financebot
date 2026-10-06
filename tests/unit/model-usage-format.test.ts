import { tokenCount, usageCoverageLabel, usageCoverageNote } from '../../client/src/model-usage-format';

describe('model usage display', () => {
  it('preserves reported zero and treats missing or invalid counts as unknown', () => {
    expect(tokenCount(0)).toBe('0');
    for (const value of [null, undefined, -1, NaN, Infinity, 0.5]) expect(tokenCount(value)).toBe('Unknown');
  });

  it('identifies partial subtotals and pending/unknown call coverage', () => {
    const summary = { status: 'partial' as const, observedCalls: 4, reportedCalls: 2, unknownCalls: 1, pendingCalls: 1 };
    expect(usageCoverageLabel(summary)).toBe('Partial usage · known subtotal');
    expect(usageCoverageNote(summary)).toContain('2 of 4 observed calls');
    expect(usageCoverageNote(summary)).toContain('1 pending · 1 unknown');
    expect(usageCoverageLabel({ ...summary, status: 'unavailable' })).toBe('Usage unavailable');
  });
});
