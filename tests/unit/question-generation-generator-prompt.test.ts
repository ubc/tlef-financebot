import { GENERATOR_PROMPT, renderDistinctnessContext } from '../../server/src/services/question-generation/generator-prompt';

const chunks = [{ materialId: 'm1', chunkIndex: 0, text: 'CAPM: E(R) = Rf + beta (Rm - Rf).' }, { materialId: 'm1', chunkIndex: 1, text: 'Beta measures systematic risk.' }];
const base = { type: 'mcq' as const, loName: 'Apply CAPM', difficulty: 'medium' as const, prompt: undefined, chunks };

describe('GENERATOR_PROMPT', () => {
  it('states the LO as a hard requirement', () => {
    expect(GENERATOR_PROMPT(base)).toMatch(/must assess the learning objective "Apply CAPM"/i);
  });
  it('renders the assigned angle and chunk focus', () => {
    const text = GENERATOR_PROMPT({ ...base, angle: { id: 'reverse-solve', text: 'Give the result and ask for the missing input.' }, focusChunk: 1 });
    expect(text).toContain('Give the result and ask for the missing input.');
    expect(text).toContain('Lean primarily on material [2]');
  });
  it('lists existing and earlier-run stems with the no-duplicate rule', () => {
    const text = GENERATOR_PROMPT({ ...base, existingStems: ['What is beta?'], batchStems: ['Compute E(R) for beta 1.2.'] });
    expect(text).toContain('What is beta?');
    expect(text).toContain('Compute E(R) for beta 1.2.');
    expect(text).toMatch(/changing numbers or names does not make a new question/i);
  });
  it('omits the distinctness block when there is nothing to avoid', () => {
    expect(renderDistinctnessContext([], [])).toBe('');
  });
  it('asks for sourceChunkIndexes in the JSON shape', () => {
    expect(GENERATOR_PROMPT(base)).toContain('"sourceChunkIndexes"');
  });
  it('includes the original, the check findings and the instruction when regenerating', () => {
    const text = GENERATOR_PROMPT({ ...base, regenerate: {
      original: { stem: 'Old stem', options: [] },
      agentDecision: { decision: 'reject', reasoning: 'Answer key is wrong.', suggestions: ['Fix option B'] },
      instruction: 'Use a bond example instead.',
    } });
    expect(text).toContain('Old stem');
    expect(text).toContain('Answer key is wrong.');
    expect(text).toContain('Fix option B');
    expect(text).toContain('Use a bond example instead.');
  });
  it('no longer threatens regeneration', () => {
    expect(GENERATOR_PROMPT({ ...base, kind: 'calculation' })).not.toMatch(/(refused|rejected) and regenerated/i);
  });
  it('puts stable instructions before per-question context', () => {
    const text = GENERATOR_PROMPT({ ...base, existingStems: ['What is beta?'] });
    expect(text.indexOf('Respond with ONLY this JSON shape')).toBeLessThan(text.indexOf('What is beta?'));
  });
});
