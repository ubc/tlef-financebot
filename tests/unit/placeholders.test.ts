// Placeholder display round-trip. Pure client logic exercised under the node
// env, the same way tests/unit/duplicate-name.test.ts does.
import {
  declaredVariableNames,
  editableVariableNames,
  rowStemText,
  toDisplayPlaceholders,
  toStoredPlaceholders,
  unresolvedPlaceholderWarning,
} from '../../client/src/placeholders';

describe('placeholders a question cannot fill (2026-09-14)', () => {
  const maya = {
    stem: 'Maya has a down payment in {{YEARS_SHORT}} years and retirement in {{YEARS_LONG}} years.',
    options: [{ text: 'Cash, then equities', explanation: '' }],
  };

  it('keeps an undeclared placeholder a placeholder when an unrelated edit is saved', () => {
    const names = editableVariableNames(maya);
    expect(names).toEqual(['YEARS_SHORT', 'YEARS_LONG']);
    const edited = `${toDisplayPlaceholders(maya.stem)} Which plan fits?`;
    expect(toStoredPlaceholders(edited, names)).toBe(`${maya.stem} Which plan fits?`);
    // Before: only declared variables converted back, flattening them to literal brackets.
    expect(toStoredPlaceholders(edited, declaredVariableNames({}))).toContain('[YEARS_SHORT]');
  });

  it('still leaves ordinary bracketed prose alone', () => {
    expect(toStoredPlaceholders('[Note] in [YEARS_SHORT] years', editableVariableNames(maya)))
      .toBe('[Note] in {{YEARS_SHORT}} years');
  });

  it('warns in the editor’s bracket form, naming each placeholder', () => {
    expect(unresolvedPlaceholderWarning([])).toBeUndefined();
    expect(unresolvedPlaceholderWarning(undefined)).toBeUndefined();
    expect(unresolvedPlaceholderWarning(['{{YEARS_SHORT}}', '{{YEARS_LONG}}'])).toEqual({
      title: 'Students are not being served this question',
      body: 'It uses [YEARS_SHORT] and [YEARS_LONG], but no variable has those names, so a student would see the placeholders as written. Type the actual number in its place, or add the variable.',
    });
    expect(unresolvedPlaceholderWarning(['{{YEARS}}'])?.body).toMatch(/^It uses \[YEARS\], but no variable has that name/);
  });

  it('describes a broken placeholder separately', () => {
    expect(unresolvedPlaceholderWarning(['{{A}}', '{{COMPOUNDS}'])?.body)
      .toContain('It contains "{{COMPOUNDS}", a variable with broken braces that is never replaced. Rewrite it as [NAME].');
  });
});

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

// List rows show the STUDENT's view (Saurav, 2026-08-17) — the template with
// its variables belongs on the detail page, where it is being edited.
describe('rowStemText', () => {
  it('prefers the drawn sample, so a row shows real numbers', () => {
    expect(rowStemText({
      current: { stem: 'Discount {{CASH_IN}} at {{RATE}}%.' },
      sample: { stem: 'Discount 4,200 at 6%.' },
    })).toBe('Discount 4,200 at 6%.');
  });

  it('falls back to READABLE placeholders when no sample was drawn', () => {
    // A generateScript question is never sampled for a list (it would cost a
    // worker thread per row), so this path is load-bearing, not decoration —
    // and it must never leak the `{{...}}` storage format the way the bank
    // used to.
    const text = rowStemText({ current: { stem: 'Discount {{CASH_IN}} at {{RATE}}%.' } });
    expect(text).toBe('Discount [CASH_IN] at [RATE]%.');
    expect(text).not.toMatch(/\{\{/);
  });

  it('leaves a conceptual stem alone either way', () => {
    const conceptual = 'Why does diversification reduce unsystematic risk?';
    expect(rowStemText({ current: { stem: conceptual } })).toBe(conceptual);
    expect(rowStemText({ current: { stem: conceptual }, sample: { stem: conceptual } })).toBe(conceptual);
  });
});
