import {
  CHECKER_PROMPT, parseCheckerOutput, uncheckedDecision, REVIEW_VERDICT_POLICY,
} from '../../server/src/services/question-generation/checker-prompt';

const question = { stem: 'Beta 1.2, Rf 3%, Rm 8%. E(R)?', options: [
  { key: 'A', text: '9%', role: 'correct', explanation: '3 + 1.2*5' },
  { key: 'B', text: '8%', role: 'common-misconception', explanation: 'ignores beta' },
  { key: 'C', text: '6%', role: 'partially-correct', explanation: 'uses premium only' },
  { key: 'D', text: '12%', role: 'clearly-wrong', explanation: 'adds' },
] } as never;
const base = { loName: 'Apply CAPM', type: 'mcq' as const, question, chunks: [{ text: 'CAPM formula.' }], findings: [] as string[] };

describe('CHECKER_PROMPT', () => {
  it('requires a per-option role check including swaps on sound questions', () => {
    const text = CHECKER_PROMPT(base);
    expect(text).toMatch(/for EACH option key/i);
    expect(text).toMatch(/swapped/i);
  });
  it('embeds the verdict policy and the LO', () => {
    const text = CHECKER_PROMPT(base);
    expect(text).toContain(REVIEW_VERDICT_POLICY);
    expect(text).toContain('Apply CAPM');
  });
  it('passes deterministic findings through as facts', () => {
    expect(CHECKER_PROMPT({ ...base, findings: ['Options B and C display the same value.'] }))
      .toContain('Options B and C display the same value.');
  });
  it('asks for suggestions in the output shape', () => {
    expect(CHECKER_PROMPT(base)).toContain('"suggestions"');
  });
});

describe('parseCheckerOutput', () => {
  it('normalizes a well-formed response', () => {
    expect(parseCheckerOutput({ decision: 'FLAG', reasoning: 'Role swap.', roleAssessment: 'D mislabeled', suggestions: ['Relabel D'], suggestedDifficulty: 'easy' }))
      .toEqual({ decision: 'flag', reasoning: 'Role swap.', roleAssessment: 'D mislabeled', suggestions: ['Relabel D'], suggestedDifficulty: 'easy' });
  });
  it('degrades malformed fields instead of throwing', () => {
    expect(parseCheckerOutput({ decision: 'maybe', suggestions: 'x', suggestedDifficulty: 'extreme' }))
      .toEqual({ decision: 'flag', reasoning: '', roleAssessment: '', suggestions: [] });
  });
  it('normalises decision and suggestedDifficulty case and whitespace', () => {
    expect(parseCheckerOutput({ decision: ' PASS ' }).decision).toBe('pass');
    expect(parseCheckerOutput({ decision: 'pass', suggestedDifficulty: ' Hard ' }).suggestedDifficulty).toBe('hard');
  });
  it('caps suggestions at 8 strings', () => {
    expect(parseCheckerOutput({ decision: 'pass', suggestions: Array.from({ length: 12 }, (_, i) => `s${i}`) }).suggestions).toHaveLength(8);
  });
});

describe('uncheckedDecision', () => {
  it('flags with the error message', () => {
    expect(uncheckedDecision(new Error('timeout'))).toEqual({
      decision: 'flag', reasoning: 'Automatic check unavailable: timeout', roleAssessment: '', suggestions: [],
    });
  });
});
