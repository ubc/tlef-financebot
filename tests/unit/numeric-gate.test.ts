// The gate that keeps unverified numerical questions away from students.
// Node env, pure. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
import { readFileSync } from 'node:fs';
import { EVALUATOR_VERSION } from '../../server/src/components/formula';
import { detectNumeric, isNumericQuestion, isServable } from '../../server/src/services/numeric-gate.service';
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

  it('flags a percentage rate', () => {
    expect(detectNumeric('The effective rate per period is 5%.', ['a', 'b'])).toBe(true);
  });

  it('does not flag prose with no numbers', () => {
    expect(detectNumeric('Which statement best describes diversification?', ['Risk falls', 'Risk rises'])).toBe(false);
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
