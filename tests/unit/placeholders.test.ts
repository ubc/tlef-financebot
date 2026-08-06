// Placeholder display round-trip. Pure client logic exercised under the node
// env, the same way tests/unit/duplicate-name.test.ts does.
import {
  declaredVariableNames,
  toDisplayPlaceholders,
  toStoredPlaceholders,
} from '../../client/src/placeholders';

const known = ['CASH_IN', 'CASH_OUT', 'NET_CASH_FLOW'];

describe('toDisplayPlaceholders', () => {
  it('renders stored placeholders in bracket form', () => {
    expect(toDisplayPlaceholders('cash in is {{CASH_IN}} and out is {{CASH_OUT}}'))
      .toBe('cash in is [CASH_IN] and out is [CASH_OUT]');
  });

  it('tolerates internal whitespace', () => {
    expect(toDisplayPlaceholders('{{  PV  }}')).toBe('[PV]');
  });

  it('leaves ordinary text alone', () => {
    expect(toDisplayPlaceholders('no variables here')).toBe('no variables here');
  });
});

describe('toStoredPlaceholders', () => {
  it('converts declared variables back', () => {
    expect(toStoredPlaceholders('cash in is [CASH_IN]', known)).toBe('cash in is {{CASH_IN}}');
  });

  it('leaves brackets that are NOT declared variables untouched', () => {
    // The whole safety argument: square brackets appear in ordinary prose, and
    // converting them blindly would turn real text into a placeholder that
    // never substitutes.
    expect(toStoredPlaceholders('see [Note] and [sic] and [1]', known))
      .toBe('see [Note] and [sic] and [1]');
  });

  it('converts only the declared name in mixed text', () => {
    expect(toStoredPlaceholders('[Note]: value is [CASH_IN]', known))
      .toBe('[Note]: value is {{CASH_IN}}');
  });
});

describe('round trip', () => {
  it('is lossless for stored text', () => {
    const stored = 'in {{CASH_IN}} out {{CASH_OUT}} net {{NET_CASH_FLOW}}';
    expect(toStoredPlaceholders(toDisplayPlaceholders(stored), known)).toBe(stored);
  });

  it('is lossless for text containing unrelated brackets', () => {
    const stored = 'per [Note] the value is {{CASH_IN}}';
    expect(toStoredPlaceholders(toDisplayPlaceholders(stored), known)).toBe(stored);
  });
});

describe('declaredVariableNames', () => {
  it('collects slot and derived names', () => {
    expect(declaredVariableNames({
      paramSlots: [{ name: 'CASH_IN' }],
      derivedValues: [{ name: 'NET_CASH_FLOW' }],
    })).toEqual(['CASH_IN', 'NET_CASH_FLOW']);
  });

  it('returns an empty list for a conceptual question', () => {
    expect(declaredVariableNames({})).toEqual([]);
  });
});
