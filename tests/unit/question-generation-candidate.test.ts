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
