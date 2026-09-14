// The gate that keeps unverified numerical questions away from students.
// Node env, pure. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
import { readFileSync } from 'node:fs';
import { EVALUATOR_VERSION } from '../../server/src/components/formula';
import {
  detectNumeric,
  isNumericQuestion,
  isServable,
  unresolvablePlaceholders,
} from '../../server/src/services/numeric-gate.service';
import type { QuestionOption } from '../../server/src/types/domain';

function options(...texts: string[]): QuestionOption[] {
  return texts.map((text, i) => ({
    key: String.fromCharCode(65 + i),
    text,
    role: i === 0 ? ('correct' as const) : ('clearly-wrong' as const),
    explanation: '',
  }));
}

const proof = { evaluatorVersion: EVALUATOR_VERSION, sampleSeeds: [1], verifiedAt: new Date() };

describe('detectNumeric', () => {
  it('flags currency amounts', () => {
    expect(detectNumeric('What is the present value?', ['$462.59', '$470.96'])).toBe(true);
  });

  it('flags a stem carrying an arithmetic expression', () => {
    expect(detectNumeric('Compute 200/(1.05)^2 for the stream.', ['a', 'b'])).toBe(true);
  });

  it('flags a rate APPLIED TO an amount', () => {
    expect(detectNumeric('Invest $10,000 at 5% for three years. What is the balance?', ['a', 'b'])).toBe(true);
  });

  // CHANGED 2026-08-16, deliberately. This previously asserted `true` on the
  // grounds that a false positive "costs an instructor one override" — but no
  // such override exists: a question the detector calls numeric needs a proof,
  // and one with no paramSlots can never earn it, so it silently never serves.
  // A rate with nothing to apply it to is a fact the question states.
  it('does NOT flag a rate with no amount to apply it to', () => {
    expect(detectNumeric('The effective rate per period is 5%.', ['a', 'b'])).toBe(false);
  });

  it('does not flag prose with no numbers', () => {
    expect(detectNumeric('Which statement best describes diversification?', ['Risk falls', 'Risk rises'])).toBe(false);
  });

  // The measured false-positive class: four of these six realistic conceptual
  // stems were blocked before the narrowing, by a year, a count, a ratio and a
  // bare rate. Pinned by example so the loose patterns cannot come back.
  describe('realistic conceptual stems must not read as computational', () => {
    it.each([
      ['a bare rate',   'A firm uses a 15% hurdle rate. Which statement describes what it represents?'],
      ['a year',        'Since 2008, regulators have required higher capital ratios. Why does that reduce failure risk?'],
      ['a count',       'A portfolio of 30 stocks is described as well diversified. What does that mean for its beta?'],
      ['a ratio',       'An analyst says a stock is overvalued at a P/E of 40. What assumption underlies that claim?'],
      ['no numbers',    'Why does adding more stocks reduce unsystematic risk but not systematic risk?'],
      ['a rule compare','Which statement best explains why the NPV rule is preferred to the payback rule?'],
    ])('serves a conceptual question containing %s', (_label, stem) => {
      expect(isServable({
        stem,
        options: options('Because it removes firm-specific risk', 'Because it removes market risk'),
        numericKind: 'conceptual',
      })).toBe(true);
    });
  });

  // The backstop the narrowing must NOT weaken.
  it('still catches a computational question that carries an amount', () => {
    expect(detectNumeric('A bond pays $50 annually. What is its price at a 6% yield?', ['a', 'b'])).toBe(true);
  });
});

describe('isNumericQuestion', () => {
  it('trusts the generator declaration', () => {
    expect(isNumericQuestion({ stem: 'no digits here', options: options('a', 'b'), numericKind: 'numeric' })).toBe(true);
  });

  it('catches a mistagged question via the detector backstop', () => {
    // THE REPORTED BUG: static numbers, no paramSlots, declared conceptual.
    // A structural "has paramSlots?" test would pass this straight through.
    expect(isNumericQuestion({
      stem: 'A stream pays $200 at Period 1 and $300 at Period 2.',
      options: options('$470.96', '$462.59'),
      numericKind: 'conceptual',
    })).toBe(true);
  });

  it('honours a conceptual override on genuinely non-numeric prose', () => {
    expect(isNumericQuestion({
      stem: 'Which statement best describes diversification?',
      options: options('Risk falls', 'Risk rises'),
      numericKind: 'conceptual',
    })).toBe(false);
  });
});

describe('isServable', () => {
  it('serves a conceptual question with no proof', () => {
    expect(isServable({ stem: 'Define beta.', options: options('a', 'b') })).toBe(true);
  });

  it('refuses a numerical question with no proof', () => {
    expect(isServable({ stem: 'Compute $200/(1.05)^2.', options: options('$181.41', '$190.48') })).toBe(false);
  });

  it('serves a numerical question carrying a current proof', () => {
    expect(isServable({
      stem: 'Compute $200/(1.05)^2.',
      options: options('$181.41', '$190.48'),
      verification: proof,
    })).toBe(true);
  });

  it('refuses a proof from a superseded evaluator version', () => {
    expect(isServable({
      stem: 'Compute $200/(1.05)^2.',
      options: options('$181.41', '$190.48'),
      verification: { ...proof, evaluatorVersion: EVALUATOR_VERSION - 1 },
    })).toBe(false);
  });

  describe('placeholders that can never be substituted', () => {
    // 2026-09-14: declared conceptual, no slots, and the student read the braces.
    const maya = {
      stem: 'Maya has two financial goals: a down payment in {{YEARS_SHORT}} years and retirement in {{YEARS_LONG}} years.',
      options: options('Cash for the down payment, equities for retirement', 'Equities for both'),
      numericKind: 'conceptual' as const,
    };

    it('refuses a conceptual question whose placeholders name no slot', () => {
      expect(unresolvablePlaceholders(maya)).toEqual(['{{YEARS_SHORT}}', '{{YEARS_LONG}}']);
      expect(isServable(maya)).toBe(false);
    });

    it('serves the same question once the numbers are written in', () => {
      expect(isServable({ ...maya, stem: 'Maya has two financial goals: a down payment in 3 years and retirement in 30 years.' })).toBe(true);
    });

    it('refuses a verified numerical question with an undeclared or broken placeholder in an explanation', () => {
      const numeric = {
        stem: 'Deposit ${{C}} for {{N}} quarters.',
        options: options('${{FV}}', '${{FV_WRONG}}'),
        paramSlots: [{ name: 'C', min: 500, max: 900 }, { name: 'N', min: 4, max: 8 }],
        derivedValues: [{ name: 'FV', formula: 'C*N' }, { name: 'FV_WRONG', formula: 'C' }],
        verification: proof,
      };
      expect(isServable(numeric)).toBe(true);
      const withExplanation = (explanation: string) => ({
        ...numeric,
        options: numeric.options.map((option, i) => (i === 0 ? { ...option, explanation } : option)),
      });
      expect(unresolvablePlaceholders(withExplanation('$FV = {{CONTRIBUTION}} \\times {{N}}$'))).toEqual(['{{CONTRIBUTION}}']);
      expect(unresolvablePlaceholders(withExplanation('$r^{{N}/4}$'))).toEqual(['{{N}']);
      expect(isServable(withExplanation('$r^{{N}/4}$'))).toBe(false);
      // Grouped and triple-braced placeholders are complete.
      expect(isServable(withExplanation('$r^{ {{N}} /4}$ and $\\frac{{{C}}}{4}$'))).toBe(true);
    });

    it('does not check a generateScript version, whose variables exist only at run time', () => {
      expect(isServable({ ...maya, generateScript: 'return { YEARS_SHORT: 3, YEARS_LONG: 30 };' })).toBe(true);
    });
  });
});

describe('gate integration points', () => {
  // Guards against a third serving path being added without the gate.
  // resolveParamValues has six call sites; only these two build the candidate
  // pools students actually draw from.
  it('is applied at both serving chokepoints', () => {
    const serving = readFileSync('server/src/services/serving.service.ts', 'utf8');
    const exams = readFileSync('server/src/services/exam-attempts.service.ts', 'utf8');
    expect(serving).toContain('isServable(version)');
    expect(exams).toContain('isServable(candidate.version)');
  });
});
