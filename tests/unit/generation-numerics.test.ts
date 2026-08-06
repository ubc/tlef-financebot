// The generator's numerical contract: it emits formulas, never numbers, and
// the reviewer no longer judges arithmetic. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
import { readFileSync } from 'node:fs';
import { GENERATOR_PROMPT, REVIEWER_PROMPT } from '../../server/src/services/generation.service';

const reviewerPrompt = REVIEWER_PROMPT({
  loName: 'Compute present value',
  question: { stem: 'A firm has $10 million of debt…', options: [] },
});

const generatorPrompt = GENERATOR_PROMPT({
  type: 'mcq',
  loName: 'Compute present value',
  chunks: [],
});

describe('REVIEWER_PROMPT', () => {
  it('no longer asks the LLM to check calculations', () => {
    // This criterion passed BOTH production bugs, and passed the contingent-
    // claims question on 2026-08-05 as well. Arithmetic is the evaluator's job
    // now; asking for it here only manufactures false confidence.
    expect(reviewerPrompt).not.toMatch(/Calculation correctness/i);
    expect(reviewerPrompt).not.toMatch(/numbers\/formulas check out/i);
  });

  it('tells the reviewer explicitly not to evaluate arithmetic', () => {
    expect(reviewerPrompt).toMatch(/do not attempt to evaluate any arithmetic/i);
  });

  it('asks whether the formula models the question instead', () => {
    expect(reviewerPrompt).toMatch(/formula modelling/i);
    expect(reviewerPrompt).toMatch(/judge the model, not the arithmetic/i);
  });

  it('keeps the judgement criteria an LLM is actually good at', () => {
    expect(reviewerPrompt).toMatch(/Factual accuracy/i);
    expect(reviewerPrompt).toMatch(/alignment/i);
    expect(reviewerPrompt).toMatch(/Distractor quality/i);
    expect(reviewerPrompt).toMatch(/Clarity/i);
    expect(reviewerPrompt).toMatch(/Difficulty calibration/i);
  });
});

describe('GENERATOR_PROMPT', () => {
  it('instructs the generator to emit slots and formulas, not numbers', () => {
    expect(generatorPrompt).toMatch(/paramSlots/);
    expect(generatorPrompt).toMatch(/derivedValues/);
    expect(generatorPrompt).toMatch(/numericKind/);
  });

  it('forbids stating a computed number literally', () => {
    expect(generatorPrompt).toMatch(/never write a computed number/i);
  });

  it('requires every distractor to name the mistake it represents', () => {
    expect(generatorPrompt).toMatch(/errorModel/);
  });

  it('documents the formula syntax and the available functions', () => {
    expect(generatorPrompt).toMatch(/SUM\(/);
    for (const fn of ['PV', 'FV', 'PMT', 'NPV', 'IRR', 'sqrt']) {
      expect(generatorPrompt).toContain(fn);
    }
  });

  it('warns about the two failure modes verification actually rejects', () => {
    // Ranges that break the formula, and distractors that coincide with the
    // correct answer for some draw. Both are verification failures, so a
    // generator that ignores them produces unservable questions.
    expect(generatorPrompt).toMatch(/must not include 0|divides by/i);
    expect(generatorPrompt).toMatch(/never coincide|must differ/i);
  });

  it('forbids an errorModel on the correct value', () => {
    // A real generation on 2026-08-05 put "Correct value measure is benefits
    // minus costs" in the correct value's errorModel, polluting the field that
    // is supposed to mean "this is the mistake".
    expect(generatorPrompt).toMatch(/CORRECT value MUST NOT carry an "errorModel"/);
  });

  it('warns specifically about reversed subtraction', () => {
    // The first real generation failed verification exactly this way:
    // VALUE_MEASURE = A - B against INCORRECT_DIFFERENCE_REVERSED = B - A,
    // which are both 0 wherever A equals B.
    expect(generatorPrompt).toMatch(/REVERSED SUBTRACTION/);
    expect(generatorPrompt).toMatch(/do NOT use "B - A" as a distractor/);
  });

  it('still describes conceptual questions as a first-class option', () => {
    expect(generatorPrompt).toMatch(/conceptual/);
  });
});

describe('generated numerics are verified before persisting', () => {
  // verifyGeneratedNumerics is module-private; these assert the observable
  // contract through the source, the same way numeric-gate.test.ts guards its
  // two integration points. The behavioural coverage of the verifier itself
  // lives in numeric-verification.test.ts.
  const source = readFileSync('server/src/services/generation.service.ts', 'utf8');

  it('verifies at BOTH createQuestion call sites', () => {
    // The second is the regeneration path — the one the 2026-08-05 tester used
    // when they reported that regenerating still produced a wrong answer.
    const calls = source.match(/verifyGeneratedNumerics\(/g) ?? [];
    // one definition + two call sites
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('verifyGeneratedNumerics(generated)');
    expect(source).toContain('verifyGeneratedNumerics(candidate.generated)');
  });

  it('spreads the verified parameterization into both persisted questions', () => {
    const spreads = source.match(/\.\.\.numerics\.fields,/g) ?? [];
    expect(spreads).toHaveLength(2);
  });

  it('records the failure reason in the reviewer reasoning both times', () => {
    const notes = source.match(/withVerificationNote\(/g) ?? [];
    expect(notes.length).toBeGreaterThanOrEqual(3); // definition + two call sites
  });
});
