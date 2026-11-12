import { ObjectId } from 'mongodb';
import { inspectCandidate, sourceRefsFor } from '../../server/src/services/question-generation/candidate';

const mcq = {
  stem: 'What does beta measure?', difficulty: 'easy', numericKind: 'conceptual',
  options: [
    { key: 'A', text: 'Systematic risk', role: 'correct', explanation: 'By definition.' },
    { key: 'B', text: 'Total risk', role: 'common-misconception', explanation: 'Confuses with variance.' },
    { key: 'C', text: 'Unsystematic risk', role: 'partially-correct', explanation: 'Diversifiable part.' },
    { key: 'D', text: 'Liquidity', role: 'clearly-wrong', explanation: 'Unrelated.' },
  ],
} as never;

describe('inspectCandidate', () => {
  it('accepts a sound conceptual MCQ with no findings', () => {
    const result = inspectCandidate({ type: 'mcq', kind: 'conceptual', candidate: mcq });
    expect(result.storable).toBe(true);
    expect(result.findings).toEqual([]);
  });
  it('marks a missing candidate unstorable', () => {
    expect(inspectCandidate({ type: 'mcq', candidate: null }).storable).toBe(false);
  });
  it('marks a three-option MCQ unstorable', () => {
    const bad = { ...(mcq as object), options: (mcq as { options: unknown[] }).options.slice(0, 3) } as never;
    expect(inspectCandidate({ type: 'mcq', candidate: bad }).storable).toBe(false);
  });
  it('records a kind mismatch as a finding but keeps it storable', () => {
    const result = inspectCandidate({ type: 'mcq', kind: 'calculation', candidate: mcq });
    expect(result.storable).toBe(true);
    expect(result.findings.join(' ')).toMatch(/calculation/i);
  });
  it('records a missing common-misconception option as a finding', () => {
    const noMisconception = { ...(mcq as object), options: (mcq as { options: Array<Record<string, string>> }).options
      .map(o => (o.role === 'common-misconception' ? { ...o, role: 'clearly-wrong' } : o)) } as never;
    const result = inspectCandidate({ type: 'mcq', candidate: noMisconception });
    expect(result.storable).toBe(true);
    expect(result.findings.join(' ')).toMatch(/common-misconception/);
  });
  it('treats a response with no options as unstorable instead of throwing', () => {
    expect(inspectCandidate({ type: 'mcq', candidate: { stem: 'bad' } as never }).storable).toBe(false);
  });
  it('treats non-array options as unstorable', () => {
    expect(inspectCandidate({ type: 'mcq', candidate: { stem: 'bad', options: 'x' } as never }).storable).toBe(false);
  });
});

describe('sourceRefsFor', () => {
  const id = new ObjectId().toHexString();
  const chunks = [{ materialId: id, text: 'one' }, { materialId: id, text: 'two' }, { text: 'no material' }];
  it('keeps only the cited 1-based chunks', () => {
    expect(sourceRefsFor(chunks, [2]).map(r => r.chunk)).toEqual(['two']);
  });
  it('falls back to every material-backed chunk when the list is empty or invalid', () => {
    expect(sourceRefsFor(chunks, []).map(r => r.chunk)).toEqual(['one', 'two']);
    expect(sourceRefsFor(chunks, [9]).map(r => r.chunk)).toEqual(['one', 'two']);
    expect(sourceRefsFor(chunks, undefined).map(r => r.chunk)).toEqual(['one', 'two']);
  });
});

// Q8 from the 2026-11-12 Sol trial: two distractors could both show $0, and
// PUBLIC_PROFIT is identically zero. The solver prunes the collision; the
// constants become findings for the repair call.
const q8 = {
  stem: 'Early investor buys {{SHARES}} shares at ${{EARLY_PRICE}} and sells at ${{EARLY_CLOSE}}. Another stock was ${{PUBLIC_OLD}} before a clear announcement supporting ${{PUBLIC_VALUE}}; an ordinary investor buys {{SHARES}} shares late and sells at ${{PUBLIC_VALUE}}. By how much does the early profit exceed the public profit?',
  difficulty: 'medium', numericKind: 'numeric',
  paramSlots: [
    { name: 'SHARES', min: 100, max: 500, step: 100 },
    { name: 'EARLY_PRICE', min: 40, max: 50, step: 5 },
    { name: 'EARLY_CLOSE', min: 65, max: 75, step: 5 },
    { name: 'PUBLIC_OLD', min: 80, max: 85, step: 5 },
    { name: 'PUBLIC_VALUE', min: 90, max: 95, step: 5 },
  ],
  derivedValues: [
    { name: 'EARLY_PROFIT', formula: 'SHARES*(EARLY_CLOSE-EARLY_PRICE)' },
    { name: 'PUBLIC_PROFIT', formula: 'SHARES*(PUBLIC_VALUE-PUBLIC_VALUE)' },
    { name: 'PROFIT_DIFFERENCE', formula: 'EARLY_PROFIT-PUBLIC_PROFIT' },
    { name: 'STALE_PUBLIC_PROFIT', formula: 'SHARES*(PUBLIC_VALUE-PUBLIC_OLD)', errorModel: 'bought at the stale pre-announcement price' },
    { name: 'STALE_PRICE_DIFFERENCE', formula: 'EARLY_PROFIT-STALE_PUBLIC_PROFIT', errorModel: 'subtracted the stale-price profit' },
    { name: 'NO_INFORMATION_REWARD', formula: 'PUBLIC_PROFIT', errorModel: 'assumed nobody can profit while prices adjust' },
    { name: 'REVERSED_DIFFERENCE', formula: 'PUBLIC_PROFIT-EARLY_PROFIT', errorModel: 'reversed the subtraction' },
  ],
  options: [
    { key: 'A', text: '${{PROFIT_DIFFERENCE}}', role: 'correct', explanation: 'Early profit minus public profit.' },
    { key: 'B', text: '${{REVERSED_DIFFERENCE}}', role: 'partially-correct', explanation: 'Reversed.' },
    { key: 'C', text: '${{STALE_PRICE_DIFFERENCE}}', role: 'common-misconception', explanation: 'Stale price.' },
    { key: 'D', text: '${{NO_INFORMATION_REWARD}}', role: 'common-misconception', explanation: 'No reward.' },
  ],
} as never;

describe('inspectCandidate with the parameter solver', () => {
  it('stores pruned parameter values and the solver report instead of failing Q8 on a collision', () => {
    const result = inspectCandidate({ type: 'mcq', kind: 'calculation', candidate: q8 });
    expect(result.numerics.failure).toBeUndefined();
    const fields = result.numerics.fields;
    expect(fields.paramSlots?.find((slot) => slot.name === 'EARLY_CLOSE')).toEqual({ name: 'EARLY_CLOSE', values: [70, 75] });
    expect(fields.verification?.parameterSolver).toEqual({ checkedCombinations: 180, removed: [{ slot: 'EARLY_CLOSE', values: [65] }] });
    expect(fields.verification?.parameterCoverage?.mode).toBe('exhaustive');
  });

  it('reports constant derived values as findings for the repair call', () => {
    const result = inspectCandidate({ type: 'mcq', kind: 'calculation', candidate: q8 });
    expect(result.numerics.constants?.map((c) => c.name).sort()).toEqual(['NO_INFORMATION_REWARD', 'PUBLIC_PROFIT']);
    expect(result.findings.join(' ')).toMatch(/PUBLIC_PROFIT always shows 0 although its formula reads/);
  });
});
