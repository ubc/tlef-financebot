// Shared parameterized-question fixtures for the e2e specs.
//
// Since the numeric gate landed (design spec 2026-08-05), a numerical question
// without a verification proof NEVER serves — so every spec that seeds a
// numerical question and then practices it must seed a *parameterized* one.
// This module builds those fixtures so the specs stay consistent and a change
// to the verification contract is a one-file edit rather than a five-file hunt.
//
// Two properties the specs depend on:
//  1. Each variant's stem opens with a distinct, placeholder-free prose lead.
//     Specs locate questions with `stem.slice(0, 30)` and assert visibility
//     with `slice(0, 40)`; a `{{SLOT}}` inside that window would never match
//     the rendered text, since placeholders are substituted before display.
//  2. Specs can no longer hardcode "$90.91" — each serve draws its own numbers
//     — so they read the stem the student is looking at and recompute from it.
//     That is a better test than the constant ever was: it exercises the
//     substitution path end to end.
import {
  verifyQuestionNumerics,
  type VerifyResult,
} from '../../server/src/services/numeric-verification.service';
import type {
  DerivedValue,
  NumericVerification,
  ParamSlot,
  QuestionOption,
} from '../../server/src/types/domain';

const PARAM_SLOTS: ParamSlot[] = [
  { name: 'PAYMENT', min: 100, max: 900, step: 100 },
  { name: 'RATE_PCT', min: 4, max: 12, step: 2 },
  { name: 'PERIODS', min: 1, max: 3, step: 1 },
];

// Every distractor is a specific, named mistake — the errorModel is what makes
// the `common-misconception` role honest rather than decorative.
const DERIVED_VALUES: DerivedValue[] = [
  { name: 'PV', formula: 'PAYMENT/(1+RATE_PCT/100)^PERIODS' },
  {
    name: 'PV_COMPOUNDED',
    formula: 'PAYMENT*(1+RATE_PCT/100)^PERIODS',
    errorModel: 'compounded forward instead of discounting back',
  },
  {
    name: 'PV_ONE_PERIOD',
    formula: 'PAYMENT/(1+RATE_PCT/100)^1',
    errorModel: 'discounted a single period regardless of the stated term',
  },
  {
    name: 'PV_UNDISCOUNTED',
    formula: 'PAYMENT',
    errorModel: 'did not discount at all',
  },
];

const OPTION_VALUE_NAMES = ['PV', 'PV_COMPOUNDED', 'PV_ONE_PERIOD', 'PV_UNDISCOUNTED'];

/** Explanations are shared across variants, so specs asserting on reveal
 * behaviour reference these rather than reaching into a fixture. */
export const CORRECT_EXPLANATION = 'Discount each period: PAYMENT / (1 + r)^n.';
export const MISCONCEPTION_EXPLANATION =
  'This compounds forward. A payment received later is worth less today, not more.';

const OPTIONS: QuestionOption[] = [
  { key: 'A', text: '${{PV}}', role: 'correct', explanation: CORRECT_EXPLANATION },
  {
    key: 'B',
    text: '${{PV_COMPOUNDED}}',
    role: 'common-misconception',
    explanation: MISCONCEPTION_EXPLANATION,
  },
  {
    key: 'C',
    text: '${{PV_ONE_PERIOD}}',
    role: 'partially-correct',
    explanation: 'Right method, wrong term — discount for every period, not just one.',
  },
  {
    key: 'D',
    text: '${{PV_UNDISCOUNTED}}',
    role: 'clearly-wrong',
    explanation: 'This ignores the time value of money entirely.',
  },
];

/** `PV_ONE_PERIOD` collides with `PV` whenever PERIODS draws 1, so variants
 * pin PERIODS to a fixed value >= 2 rather than drawing it. Verification would
 * catch the collision anyway — this is what that check is for — but a fixture
 * that fails its own proof is a confusing way to learn it. */
function slotsForPeriods(periods: number): ParamSlot[] {
  return PARAM_SLOTS.map((slot) => (
    slot.name === 'PERIODS' ? { name: 'PERIODS', min: periods, max: periods, step: 1 } : slot
  ));
}

export interface NumericFixture {
  stem: string;
  options: QuestionOption[];
  paramSlots: ParamSlot[];
  derivedValues: DerivedValue[];
  numericKind: 'numeric';
  verification: NumericVerification;
}

/**
 * One servable parameterized question. `lead` is a distinct placeholder-free
 * prose opener so specs can tell variants apart by stem prefix. Throws rather
 * than returning an unverified fixture: a spec that silently seeded an
 * unservable question would fail far away from the cause.
 */
export function numericFixture(lead: string, periods = 2): NumericFixture {
  const paramSlots = slotsForPeriods(periods);
  // `\$` is escaped because this is a template literal: an unescaped `${` would
  // start an interpolation rather than emitting the currency marker followed by
  // the {{PAYMENT}} placeholder.
  const stem = `${lead} what is the present value of a payment of \${{PAYMENT}}`
    + ' received in {{PERIODS}} years at an annual discount rate of {{RATE_PCT}}%?';

  const result: VerifyResult = verifyQuestionNumerics({
    slots: paramSlots,
    derivedValues: DERIVED_VALUES,
    optionValueNames: OPTION_VALUE_NAMES,
  });
  if (!result.ok) throw new Error(`numeric fixture "${lead}" failed verification: ${result.error}`);

  return {
    stem,
    options: OPTIONS,
    paramSlots,
    derivedValues: DERIVED_VALUES,
    numericKind: 'numeric',
    verification: result.verification,
  };
}

/** The default single-question fixture most specs need. */
export const NUMERIC_LEAD = 'For a zero-coupon corporate bond,';
export const NUMERIC_STEM = numericFixture(NUMERIC_LEAD).stem;
export function numericQuestionFields(): NumericFixture {
  return numericFixture(NUMERIC_LEAD);
}

/** The drawn values behind a rendered stem. */
export function drawnValuesFromStem(renderedStem: string): {
  payment: number;
  ratePct: number;
  periods: number;
} {
  const payment = /payment of \$([\d.]+)/.exec(renderedStem);
  const ratePct = /discount rate of ([\d.]+)%/.exec(renderedStem);
  const periods = /received in ([\d.]+) years/.exec(renderedStem);
  if (!payment || !ratePct || !periods) {
    throw new Error(`could not read drawn values from stem: ${renderedStem}`);
  }
  return { payment: Number(payment[1]), ratePct: Number(ratePct[1]), periods: Number(periods[1]) };
}

/** Mirrors params.service's formatParamValue — if either changes, the specs
 * fail loudly here rather than mismatching silently. */
function formatLikeServer(value: number): string {
  return Number.isInteger(value) ? String(value) : (Math.round(value * 100) / 100).toFixed(2);
}

/** Display text of the CORRECT option for a rendered stem, e.g. `377.36`. */
export function correctOptionText(renderedStem: string): string {
  const { payment, ratePct, periods } = drawnValuesFromStem(renderedStem);
  return formatLikeServer(payment / (1 + ratePct / 100) ** periods);
}

/** Display text of the `common-misconception` option — `PV_COMPOUNDED`. This
 * is the one the Strategy A retry gate keys on, so specs exercising that gate
 * must pick exactly this option and not merely "a wrong one". */
export function misconceptionOptionText(renderedStem: string): string {
  const { payment, ratePct, periods } = drawnValuesFromStem(renderedStem);
  return formatLikeServer(payment * (1 + ratePct / 100) ** periods);
}

/** Display text of a WRONG option — `PV_UNDISCOUNTED`, the payment itself.
 * Chosen because it is trivial to recompute and can never collide with the
 * correct answer for any drawn rate above zero. */
export function wrongOptionText(renderedStem: string): string {
  return formatLikeServer(drawnValuesFromStem(renderedStem).payment);
}

/**
 * Wraps an option's display text as a substring pattern for
 * `getByRole('button', { name })`. Playwright treats a plain string as an
 * EXACT accessible-name match, and an option button's name carries its key and
 * currency marker ("A $377.36"), so the raw text never matches on its own.
 */
export function optionPattern(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
