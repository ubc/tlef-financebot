// Shared display-only formatting. Arithmetic remains in the closed formula evaluator.
/** Significant figures kept for a non-currency value below 1 in magnitude. */
const SMALL_VALUE_SIGNIFICANT_FIGURES = 3;

/**
 * R3 (design spec 2026-08-05): the ONE place a computed value becomes display
 * text. Integers print bare. A currency amount, and any value of magnitude 1
 * or more, rounds to 2 decimals — dollars and cents. A non-currency value
 * below 1 keeps 3 significant figures (at least 2 decimals, trailing zeros
 * trimmed back to 2): 2 decimals turned a monthly rate of 0.004868 into "0.00"
 * and a profitability index of -0.0756 into "-0.08" (2026-09-14). The formula
 * evaluator itself never rounds — all arithmetic upstream of here runs at
 * full double precision, so intermediate rounding can never compound into the
 * answer. That compounding is exactly the `190.48 + 272.11` class of error
 * this work exists to eliminate.
 *
 * Input-display verification separately refuses a draw when this formatting
 * would make the displayed premises produce a different displayed answer.
 */
export function formatParamValue(value: number, options: { currency?: boolean } = {}): string {
  if (Number.isInteger(value)) return String(value);
  if (options.currency || Math.abs(value) >= 1) return (Math.round(value * 100) / 100).toFixed(2);
  const decimals = Math.max(2, SMALL_VALUE_SIGNIFICANT_FIGURES - 1 - Math.floor(Math.log10(Math.abs(value))));
  const fixed = value.toFixed(decimals);
  return fixed.replace(/(\.\d{2}\d*?)0+$/, '$1');
}

/** A placeholder written as a dollar amount — `${{X}}`, or `\${{X}}` inside math. */
export function isCurrencyPlaceholder(textBefore: string): boolean {
  return /\$\s*$/.test(textBefore);
}

/** A LaTeX token that takes the NEXT group as its argument: a super/subscript,
 * `\frac`/`\dfrac`/`\tfrac`/`\sqrt`, or the `}` that closes a `\frac`'s first
 * argument. Generated LaTeX routinely writes `(1+r)^{{PERIODS}}` meaning
 * `^{ {{PERIODS}} }`: the slot's braces double as the LaTeX group, so a bare
 * substitution leaves `^24`, which superscripts only the `2` (seen 2026-09-14,
 * "(1 + 8/100)^2 4"). Matched against the text BEFORE substitution. */
const TAKES_GROUP_ARGUMENT = /(?:[\^_]|\\[dt]?frac|\\sqrt|\})\s*$/;

/** Replaces every `{{name}}` placeholder in `text` with its resolved value
 * from `values`; a placeholder with no matching key is left untouched
 * (verbatim `{{name}}`) rather than substituted with `undefined`/blank, so a
 * stale/missing slot is visibly obvious instead of silently disappearing.
 * Where the placeholder is a LaTeX argument (see TAKES_GROUP_ARGUMENT) the
 * value keeps a brace group — `^{24}` — so multi-digit values render whole.
 * Callers apply this to stem, option text, AND option explanations
 * individually (there is no options-array overload — one string in, one
 * string out). */
export function substituteParams(text: string, values: Record<string, number>): string {
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name: string, offset: number) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) return match;
    const before = text.slice(0, offset);
    const value = formatParamValue(values[name], { currency: isCurrencyPlaceholder(before) });
    return TAKES_GROUP_ARGUMENT.test(before) ? `{${value}}` : value;
  });
}

