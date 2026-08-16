// The generator's numerical contract: it emits formulas, never numbers, and
// the reviewer no longer judges arithmetic. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
import { readFileSync } from 'node:fs';

// These tests exercise generation.service's PURE prompt builders, but importing
// the module pulls in its whole component graph — and components/qdrant
// constructs a QdrantClient at module load (`export const qdrant = new
// QdrantClient(...)`), which fires an async server-version check. With no
// Qdrant reachable that check resolves AFTER the test file finishes, and jest
// fails the run with "Cannot log after tests are done" even though every test
// passed. That is exactly how this file broke CI while passing locally, where
// the connection refuses fast enough to land inside the run.
//
// generation.routes.test.ts avoids this by mocking generation.service outright;
// this file needs the real prompts, so it mocks the side-effectful components
// instead. None of them are reachable from a prompt builder.
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));

import {
  GENERATOR_PROMPT,
  REVIEWER_PROMPT,
  verifyGeneratedNumerics,
} from '../../server/src/services/generation.service';

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

// Both blocks below pin a rule the prompt ALREADY implied and the model still
// broke, measured 2026-08-16 (docs/prompt-engineering-tests.md). In each case
// what was missing was specific, so the assertions target that specific thing —
// a vaguer prompt would satisfy a vaguer test and change nothing.
describe('GENERATOR_PROMPT — degenerate slot draws', () => {
  it('names the identity-element collision, not just overlapping ranges', () => {
    // 5 of 6 numeric questions in one batch died on BETA=1.0 making the
    // "ignored beta" distractor identical to the correct answer. The existing
    // examples covered overlaps, doubling and a zero exponent — every family
    // EXCEPT the one that kept happening.
    expect(generatorPrompt).toMatch(/MULTIPLIER that can draw exactly 1/i);
    expect(generatorPrompt).toMatch(/BETA = 1/);
  });

  it('tells the generator to EXCLUDE the degenerate value from the range', () => {
    // Detecting the collision is useless without the remedy: shift the range so
    // the identity value is never drawn.
    expect(generatorPrompt).toMatch(/EXCLUDE that value from the range/i);
    expect(generatorPrompt).toMatch(/gives 1.1, 1.4, 1.7, 2.0/i);
  });

  it('covers the additive twin of the same trap', () => {
    expect(generatorPrompt).toMatch(/ADDEND or a rate that can draw exactly 0/i);
  });
});

describe('GENERATOR_PROMPT — difficulty self-assessment', () => {
  it('asks the generator to label what it WROTE, not the target it was given', () => {
    // 12 of 12 questions returned `medium` while the reviewer called every one a
    // one-step substitution. The standard was already in the prompt; the model
    // was echoing the requested label rather than grading its own output, so the
    // fix is the instruction to self-assess.
    expect(generatorPrompt).toMatch(/must describe the question you actually wrote/i);
    expect(generatorPrompt).toMatch(/not the/i);
  });

  it('states the one-step rule in the terms the reviewer already applies', () => {
    // The reviewer's criterion 5 rejects a one-step substitution labelled medium.
    // The generator was being graded against a standard it was never shown.
    expect(generatorPrompt).toMatch(/one substitution, that is "easy"/i);
  });

  it('prefers making the question harder over relabelling it', () => {
    expect(generatorPrompt).toMatch(/genuinely harder/i);
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

  it('demands a pairwise collision check rather than listing shapes to avoid', () => {
    // Two consecutive live generations were rejected for colliding options, each
    // a DIFFERENT shape (A-B vs B-A, then A vs B with overlapping ranges).
    // Enumerating shapes is whack-a-mole; the prompt asks the model to solve
    // each pair for equality instead.
    expect(generatorPrompt).toMatch(/PAIRWISE COLLISION CHECK/);
    expect(generatorPrompt).toMatch(/set them\nequal, and solve/);
  });

  it('names the collision shapes seen in real generations', () => {
    expect(generatorPrompt).toMatch(/two bare slot values.*OVERLAP/s);
    expect(generatorPrompt).toMatch(/"A - B" and "B" are equal when A = 2\*B/);
    expect(generatorPrompt).toMatch(/"A - B" and "B - A" are equal when A = B/);
  });

  it('prescribes disjoint slot ranges as the preferred remedy', () => {
    // One tactic kills most collisions at once: if A is always far larger than
    // B then A != B, A-B != B, and A+B differs from both.
    expect(generatorPrompt).toMatch(/DISJOINT, WELL-SEPARATED ranges/);
  });

  it('still describes conceptual questions as a first-class option', () => {
    expect(generatorPrompt).toMatch(/conceptual/);
  });

  // The rules below were added on 2026-08-13, after a live run produced THREE
  // questions in a row that all failed verification at the same first check —
  // no option displayed a computed value. The cause was this prompt: it never
  // stated the rule optionValueNamesForVerification enforces, and the same
  // day's FORMATTING block told the model to "show its working" in every
  // option, which turns each one into a formula carrying input slots.

  it('states the option contract the verifier actually enforces', () => {
    expect(generatorPrompt).toMatch(/THE OPTION CONTRACT/);
    expect(generatorPrompt).toMatch(/EXACTLY ONE \{\{NAME\}\} from "derivedValues"/);
    expect(generatorPrompt).toMatch(/an INPUT slot is not an answer/);
  });

  it('keeps the worked solution in the explanation, never in an option', () => {
    expect(generatorPrompt).toMatch(/Show the working in the EXPLANATION/);
    expect(generatorPrompt).toMatch(/an option states an ANSWER, never the formula/);
  });

  it('sends decision-shaped questions down the conceptual path', () => {
    // "Accept the project" / "Reject the project" options can never satisfy the
    // option contract, so declaring them numeric guarantees an unservable
    // question.
    expect(generatorPrompt).toMatch(/ALSO conceptual, even though arithmetic is involved/);
    expect(generatorPrompt).toMatch(/Do not try to have both in one question/);
  });

  // Added 2026-08-14 after the first post-fix live run. The option contract
  // landed — questions stopped dying at step 1 — but the model satisfied it by
  // APPENDING a derived value to a decision sentence ("Coffee shop: PI accepts
  // …; Apparel store: … rejects. 7.36"). That earned a verification proof,
  // because the four appended values were pairwise distinct, while being
  // nonsense to a student. Structure passed; meaning did not.
  it('requires an option to BE a value, closing the stapled-on loophole', () => {
    expect(generatorPrompt).toMatch(/An option text IS a value/);
    expect(generatorPrompt).toMatch(/a sentence with a value stapled/);
    expect(generatorPrompt).toMatch(/the question is CONCEPTUAL/);
  });

  // Added 2026-08-14 after the Aerotech batch. All 12 options came back as bare
  // values (the option contract held), but two of three questions failed to
  // PARSE: ~400-character WACC formulas, six levels deep, with PV(...) repeated
  // six times and a dropped parenthesis. resolveSlotsAndDerived has always
  // evaluated derivedValues in declaration order so a later formula can name an
  // earlier one — the prompt simply never said so, and the verifier already
  // exempts undisplayed helper values from the option contract.
  // Added 2026-08-14 after the VanCorp batch — the first 3/3 to earn proofs,
  // and the first where every failure was a JUDGEMENT problem the verifier
  // cannot see. Distractors were operator mutations (SALES+MULT, MULT^2), one
  // question's errorModels just restated the role, and one carried no
  // common-misconception at all.
  it('demands distractors be wrong methods rather than mutated operators', () => {
    expect(generatorPrompt).toMatch(/DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC/);
    expect(generatorPrompt).toMatch(/squaring a multiple is not a mistake anyone makes/);
    expect(generatorPrompt).toMatch(/If you cannot name the student who would make the mistake/);
  });

  it('tells the generator an errorModel names the mistake, not the role', () => {
    expect(generatorPrompt).toMatch(/Name the MISTAKE, never the role/);
  });

  it('requires an MCQ to carry a common-misconception, and says why', () => {
    // The reason is load-bearing: decideStrategy gates Strategy A's retry on it.
    expect(generatorPrompt).toMatch(/AT LEAST ONE option MUST be "common-misconception"/);
    expect(generatorPrompt).toMatch(/offers its retry only when a student picks one/);
  });

  it('tells the generator it can chain derived values into short named steps', () => {
    expect(generatorPrompt).toMatch(/BUILD THE ANSWER IN STEPS/);
    expect(generatorPrompt).toMatch(/evaluated IN ORDER/);
    expect(generatorPrompt).toMatch(/may use any earlier one BY NAME/);
    expect(generatorPrompt).toMatch(/SPLIT IT/);
  });

  it('forbids stand-in sub-expressions when a quantity is hard to express', () => {
    // `(PV(1,1,1) - PV(1,1,1))` is identically zero and divided a real
    // question's answer by zero on every draw.
    expect(generatorPrompt).toMatch(/Never fill/);
    expect(generatorPrompt).toMatch(/PV\(1,1,1\) - PV\(1,1,1\)/);
  });

  it('rules out comparisons and conditionals, which the grammar cannot parse', () => {
    // A live formula used `(PI_X>0?1:0)`; the evaluator has no comparison or
    // ternary operators, so it failed at the tokenizer.
    expect(generatorPrompt).toMatch(/That list is the WHOLE grammar/);
    expect(generatorPrompt).toMatch(/no ternary/);
  });

  it('warns about ratio-valued distractors, where wider ranges do not separate', () => {
    // Collisions became the dominant failure once step 1 was fixed, and all
    // three were percentage/ratio answers where the input sizes cancel.
    expect(generatorPrompt).toMatch(/RATIOS or PERCENTAGES rather than amounts/);
  });

  it('keeps slot names out of \\text{} so an escaped underscore cannot corrupt a span', () => {
    // A live generation stored `\text{DISC<U+0002>PCT}` — the model fumbled the
    // escaped underscore and emitted a control character, killing the span.
    expect(generatorPrompt).toMatch(/Never write a slot or derived-value NAME inside/);
  });
});

describe('generated numerics are verified before persisting', () => {
  // verifyGeneratedNumerics is module-private; these assert the observable
  // contract through the source, the same way numeric-gate.test.ts guards its
  // two integration points. The behavioural coverage of the verifier itself
  // lives in numeric-verification.test.ts.
  const source = readFileSync('server/src/services/generation.service.ts', 'utf8');

  it('does not prove a numerical question with any literal/uncomputed option', () => {
    const result = verifyGeneratedNumerics({
      stem: 'Choose the present value.',
      difficulty: 'medium',
      numericKind: 'numeric',
      paramSlots: [{ name: 'CF', min: 100, max: 100 }],
      derivedValues: [
        { name: 'PV', formula: 'CF / 1.05' },
        { name: 'WRONG', formula: 'CF * 1.05' },
      ],
      options: [
        { key: 'A', text: '${{PV}}', role: 'correct', explanation: '' },
        { key: 'B', text: '$105.00', role: 'common-misconception', explanation: '' },
        { key: 'C', text: '${{WRONG}}', role: 'partially-correct', explanation: '' },
        { key: 'D', text: '$0.00', role: 'clearly-wrong', explanation: '' },
      ],
    });
    expect(result.fields.verification).toBeUndefined();
    expect(result.failure).toMatch(/option 2 must display exactly one computed value/);
  });

  it('does not prove two options that reuse the same computed value', () => {
    const result = verifyGeneratedNumerics({
      stem: 'Choose the result.',
      numericKind: 'numeric',
      paramSlots: [{ name: 'X', min: 10, max: 10 }],
      derivedValues: [
        { name: 'A', formula: 'X' },
        { name: 'B', formula: 'X + 1' },
      ],
      options: [
        { key: 'A', text: '{{A}}', role: 'correct', explanation: '' },
        { key: 'B', text: '{{A}}', role: 'common-misconception', explanation: '' },
        { key: 'C', text: '{{B}}', role: 'partially-correct', explanation: '' },
        { key: 'D', text: '{{B}}', role: 'clearly-wrong', explanation: '' },
      ],
    });
    expect(result.fields.verification).toBeUndefined();
    expect(result.failure).toMatch(/identical/);
  });

  it('verifies at BOTH createQuestion call sites', () => {
    // The second is the regeneration path — the one the 2026-08-05 tester used
    // when they reported that regenerating still produced a wrong answer.
    const calls = source.match(/verifyGeneratedNumerics\(/g) ?? [];
    // one definition + first-pass, durable-run, and side-by-side regeneration
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('verifyGeneratedNumerics(generated)');
    expect(source).toContain('verifyGeneratedNumerics(candidate.generated)');
  });

  it('spreads the verified parameterization into both persisted questions', () => {
    const spreads = source.match(/\.\.\.numerics\.fields,/g) ?? [];
    expect(spreads.length).toBeGreaterThanOrEqual(3);
  });

  it('records the failure reason in the reviewer reasoning both times', () => {
    const notes = source.match(/withVerificationNote\(/g) ?? [];
    expect(notes.length).toBeGreaterThanOrEqual(3); // definition + two call sites
  });
});
