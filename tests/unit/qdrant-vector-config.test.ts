// Pure configuration tests for the Qdrant collection dimension guard. The
// network client is mocked so importing the component never opens a connection.
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn(() => ({})),
}));
jest.mock('../../server/src/config/env', () => ({
  env: { qdrantUrl: 'http://qdrant.test', qdrantApiKey: '' },
}));

import { collectionVectorSize } from '../../server/src/components/qdrant';

describe('collectionVectorSize', () => {
  it('reads the anonymous vector size used by FinanceBot collections', () => {
    expect(collectionVectorSize({ size: 1536, distance: 'Cosine' })).toBe(1536);
  });

  it('reads a single named vector configuration', () => {
    expect(collectionVectorSize({
      content: { size: 384, distance: 'Cosine' },
    })).toBe(384);
  });

  it('does not guess when a collection contains multiple named vector sizes', () => {
    expect(collectionVectorSize({
      content: { size: 384, distance: 'Cosine' },
      title: { size: 1536, distance: 'Cosine' },
    })).toBeUndefined();
  });
});
