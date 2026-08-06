// -----------------------------------------------------------------------------
// The numeric gate (design spec 2026-08-05): decides whether a question
// version may be served to a student. A numerical version without a current
// verification proof never serves. Pure predicates — callers filter their own
// candidate pools. See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------
import { EVALUATOR_VERSION } from '../components/formula';
import type { QuestionVersion } from '../types/domain';

export type NumericGateVersion = Pick<QuestionVersion, 'stem' | 'options' | 'numericKind' | 'verification'>;

// A currency marker, a decimal, a bare number of two-plus digits, a digit
// adjacent to an arithmetic operator, or a percentage. Deliberately loose: a
// false positive costs an instructor one override, a false negative costs a
// student a wrong answer.
const NUMERIC_PATTERNS = [
  /[$€£¥]\s*\d/,
  /\d+\.\d/,
  /\b\d{2,}\b/,
  /\d\s*[-+*/^]\s*\d/,
  /\d\s*%/,
];

/**
 * Heuristic backstop over stem and option text. Independent of the
 * generator's own declaration on purpose: a mistagged question would
 * otherwise sail through, and the reported bug was exactly a static numeric
 * question that no structural test would have caught.
 */
export function detectNumeric(stem: string, optionTexts: string[]): boolean {
  const haystack = [stem, ...optionTexts].join('\n');
  return NUMERIC_PATTERNS.some((pattern) => pattern.test(haystack));
}

/** Two signals, either sufficient: the generator's declaration, or the
 * detector. An instructor override to 'conceptual' only wins when the
 * detector also finds nothing. */
export function isNumericQuestion(version: NumericGateVersion): boolean {
  if (version.numericKind === 'numeric') return true;
  return detectNumeric(version.stem, version.options.map((option) => option.text));
}

/**
 * The gate. A conceptual question always serves. A numerical one serves only
 * with a proof from the CURRENT evaluator — R4's version check means an
 * evaluator change invalidates every stored proof at once rather than
 * silently trusting arithmetic produced by superseded code.
 */
export function isServable(version: NumericGateVersion): boolean {
  if (!isNumericQuestion(version)) return true;
  return version.verification?.evaluatorVersion === EVALUATOR_VERSION;
}
