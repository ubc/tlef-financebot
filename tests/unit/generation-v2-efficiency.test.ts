import { VALIDATOR_PROMPT, REVIEWER_PROMPT, GENERATOR_V2_PROMPT } from '../../server/src/services/generation.service';

jest.mock('../../server/src/config/env', () => ({ env: { llmModelGenerator: 'generator', llmModelValidator: 'validator', llmModelReviewer: 'reviewer' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));

const question = { stem: 'Which risk remains after diversification?', difficulty: 'easy' as const, numericKind: 'conceptual' as const,
  options: [
    { key: 'A', text: 'Market risk', role: 'correct' as const, explanation: 'Common shocks remain.' },
    { key: 'B', text: 'All risk', role: 'common-misconception' as const, explanation: 'Company risk is reduced.' },
    { key: 'C', text: 'Only company risk', role: 'partially-correct' as const, explanation: 'Company risk can be reduced, not market risk.' },
    { key: 'D', text: 'No risk', role: 'clearly-wrong' as const, explanation: 'Market risk remains.' },
  ] };
const chunks = [{ text: 'Diversification reduces company-specific risk. Common market shocks remain.' }];
it('uses original source text once in compact v2 checks while retaining option, source, integration and difficulty checks', () => {
  const validator = VALIDATOR_PROMPT({ loName: 'Diversification', question, chunks, secondaryLoNames: ['Risk scope'], assignedMove: 'two concepts', authoringPolicy: 'grounded-memory-v2' });
  const reviewer = REVIEWER_PROMPT({ loName: 'Diversification', question, chunks, secondaryLoNames: ['Risk scope'], roleAssessment: 'B is a misconception.', authoringPolicy: 'grounded-memory-v2' });
  for (const prompt of [validator, reviewer]) {
    expect(prompt.split(chunks[0].text)).toHaveLength(2);
    expect(prompt).toContain('Risk scope'); expect(prompt).toContain('untrusted data'); expect(prompt).toContain('JSON');
    expect(Buffer.byteLength(prompt)).toBeLessThan(6500);
  }
  expect(validator).toContain('EACH option'); expect(validator).toContain('actual implementation');
  expect(reviewer).toContain('False distractors'); expect(reviewer).toContain('wrong answer');
  expect(reviewer).toContain('suggestedDifficulty'); expect(reviewer).toContain('separate task check');
});
it('does not ask reviewers to invent a collision after a deterministic proof, or waive actual failures', () => {
  const safe = REVIEWER_PROMPT({ loName: 'CAPM', question, chunks, verificationProven: true, authoringPolicy: 'grounded-memory-v2' });
  const unsafe = REVIEWER_PROMPT({ loName: 'CAPM', question, chunks, verificationFailure: 'Displayed Beta changes the keyed answer.', authoringPolicy: 'grounded-memory-v2' });
  expect(safe).toContain('Do not guess collisions'); expect(safe).toContain('financial assumptions still need source support');
  expect(unsafe).toContain('Displayed Beta changes the keyed answer'); expect(unsafe).toContain('Never waive a failure');
});
it('keeps baseline prompts compatible and asks v2 numeric generators for visible precision and actual decimal domains', () => {
  expect(VALIDATOR_PROMPT({ loName: 'Risk', question, chunks })).not.toContain('at most180 words');
  const prompt = GENERATOR_V2_PROMPT({ loName: 'CAPM', type: 'mcq', chunks, kind: 'calculation', qualityContext: 'AUTHORING POLICY: grounded-memory-v2' });
  expect(prompt).toMatch(/exactly (?:representable|drawable).*renderer/);
  expect(prompt).toContain('currency and absolute values >=1 use at most2 decimal places');
  expect(prompt).toContain('smaller noncurrency values use at most3 significant figures');
  expect(prompt).toMatch(/Never (?:round only the answer|hide input precision by rounding only answers)/);
  expect(prompt).toMatch(/Source (?:worked )?examples teach (?:the )?formulas?.*not (?:a )?mandatory hidden[- ]precision/);
});
