// -----------------------------------------------------------------------------
// The numeric gate (design spec 2026-08-05): decides whether a question
// version may be served to a student. A numerical version without a current
// verification proof never serves. Pure predicates — callers filter their own
// candidate pools. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------
import { EVALUATOR_VERSION } from '../components/formula';
import type { QuestionVersion } from '../types/domain';

export type NumericGateVersion = Pick<QuestionVersion, 'stem' | 'options' | 'numericKind' | 'verification'>
  & Partial<Pick<QuestionVersion, 'paramSlots' | 'derivedValues' | 'generateScript'>>;

/**
 * Evidence that answering requires ARITHMETIC — an amount to operate on, a
 * precision that only a calculation produces, or an explicit operation.
 *
 * These used to include `\b\d{2,}\b` (any two-digit number) and a bare
 * percentage, on the stated grounds that "a false positive costs an instructor
 * one override". **There is no such override** — a version the detector calls
 * numeric needs a verification proof, and a question with no `paramSlots` can
 * never earn one, so it silently never serves. The cost of a false positive was
 * a permanently undeliverable question, not an inconvenience.
 *
 * Measured on 2026-08-16, before this narrowing: of six realistic conceptual
 * stems, FOUR were blocked — by "15%", "2008", "30 stocks" and "a P/E of 40".
 * A year, a count and a ratio are facts a question states, not sums it asks
 * for, and finance prose is full of them.
 */
const COMPUTATION_PATTERNS = [
  /[$€£¥]\s*\d/,
  /\d+\.\d/,
  /\d\s*[-+*/^]\s*\d/,
];

/**
 * A rate on its own is a stated fact ("a 15% hurdle rate"); a rate applied to
 * an amount is a calculation ("$10,000 at 5%"). Requiring the amount is what
 * separates the two, since the rate alone cannot be computed with.
 */
const RATE = /\d\s*%/;
const AMOUNT = /[$€£¥]\s*\d/;

/**
 * Heuristic backstop over stem and option text. Independent of the
 * generator's own declaration on purpose: a mistagged question would
 * otherwise sail through, and the reported bug was exactly a static numeric
 * question that no structural test would have caught.
 *
 * Known and accepted false negative: "What is 10% of 200?" reads as conceptual
 * here — no currency, no decimal, no operator. That shape is only reachable via
 * a MISTAGGED generation (a real numeric question declares itself), and the
 * reviewer and the instructor's own review both still see it. Blocking it was
 * costing four genuine conceptual questions in six, which is the worse trade.
 */
export function detectNumeric(stem: string, optionTexts: string[]): boolean {
  const haystack = [stem, ...optionTexts].join('\n');
  if (COMPUTATION_PATTERNS.some((pattern) => pattern.test(haystack))) return true;
  return RATE.test(haystack) && AMOUNT.test(haystack);
}

/** Two signals, either sufficient: the generator's declaration, or the
 * detector. A `conceptual` declaration still only wins when the detector also
 * finds nothing — the declaration is not trusted alone, because a mistagged
 * computational question is precisely what the detector exists to catch. What
 * changed on 2026-08-16 is what counts as a finding, not who wins. */
export function isNumericQuestion(version: NumericGateVersion): boolean {
  if (version.numericKind === 'numeric') return true;
  return detectNumeric(version.stem, version.options.map((option) => option.text));
}

/**
 * Placeholders in the stem, option texts or explanations that substitution can
 * never fill: a `{{NAME}}` naming no paramSlot or derivedValue, or a broken
 * `{{NAME}` whose braces merged into LaTeX. The student would read either one
 * verbatim. Seen 2026-09-14 on a CONCEPTUAL question — no slots at all — whose
 * stem said "a down payment in {{YEARS_SHORT}} years". A `generateScript`
 * supplies its variables at run time, so those versions are not checked.
 */
export function unresolvablePlaceholders(version: NumericGateVersion): string[] {
  if (version.generateScript) return [];
  const declared = new Set([...(version.paramSlots ?? []), ...(version.derivedValues ?? [])].map((entry) => entry.name));
  const texts = [version.stem, ...version.options.flatMap((option) => [option.text, option.explanation ?? ''])];
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\{\{\s*([A-Za-z_]\w*)\s*\}(\})?/g)) {
      if (!match[2] || !declared.has(match[1]!)) found.add(match[2] ? `{{${match[1]}}}` : `{{${match[1]}}`);
    }
  }
  return [...found];
}

/**
 * The gate. A numerical question serves only with a proof from the CURRENT
 * evaluator — R4's version check means an evaluator change invalidates every
 * stored proof at once rather than silently trusting arithmetic produced by
 * superseded code. Any question, conceptual included, is refused while it
 * carries a placeholder that can never be substituted.
 */
export function isServable(version: NumericGateVersion): boolean {
  if (unresolvablePlaceholders(version).length > 0) return false;
  if (!isNumericQuestion(version)) return true;
  return version.verification?.evaluatorVersion === EVALUATOR_VERSION;
}
