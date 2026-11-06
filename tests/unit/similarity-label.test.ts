import { similarityLabel } from '../../client/src/views/instructor/similarity-label';

describe('similarityLabel', () => {
  it('formats both scopes with two decimals', () => {
    expect(similarityLabel({ lo: { questionId: 'a', score: 0.9 }, topic: { questionId: 'b', score: 0.781 }, model: 'm', computedAt: '' }))
      .toBe('LO 0.90 · Topic 0.78');
  });
  it('says none when a scope has no other question', () => {
    expect(similarityLabel({ lo: null, topic: { questionId: 'b', score: 0.5 }, model: 'm', computedAt: '' })).toBe('LO — · Topic 0.50');
  });
  it('is empty when similarity was never computed', () => {
    expect(similarityLabel(undefined)).toBe('');
  });
});
