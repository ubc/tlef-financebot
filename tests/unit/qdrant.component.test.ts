jest.mock('../../server/src/config/env', () => ({
  env: { qdrantUrl: 'http://qdrant.test', qdrantApiKey: '' },
}));
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    search: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { qdrant, search, deletePointsByFilter } from '../../server/src/components/qdrant';

const filter = {
  must: [{ key: 'materialId', match: { any: ['material-a', 'material-b'] } }],
};

describe('qdrant filtered point helpers', () => {
  beforeEach(() => {
    jest.mocked(qdrant.search).mockReset();
    jest.mocked(qdrant.delete).mockReset();
  });

  it('forwards an optional payload filter during similarity search', async () => {
    jest.mocked(qdrant.search).mockResolvedValue([
      { id: 'point-1', score: 0.9, payload: { materialId: 'material-a', chunk: 'grounding' } },
    ] as never);

    const hits = await search('course-1', [0.1, 0.2], 6, filter);

    expect(qdrant.search).toHaveBeenCalledWith('course-1', {
      vector: [0.1, 0.2],
      limit: 6,
      with_payload: true,
      filter,
    });
    expect(hits[0]).toMatchObject({ id: 'point-1', score: 0.9 });
  });

  it('keeps existing unfiltered search calls source-compatible', async () => {
    jest.mocked(qdrant.search).mockResolvedValue([]);

    await search('course-1', [0.1, 0.2]);

    expect(qdrant.search).toHaveBeenCalledWith('course-1', {
      vector: [0.1, 0.2],
      limit: 5,
      with_payload: true,
    });
  });

  it('deletes all points matching a payload filter and waits for completion', async () => {
    jest.mocked(qdrant.delete).mockResolvedValue({ status: 'completed' } as never);

    await deletePointsByFilter('course-1', filter);

    expect(qdrant.delete).toHaveBeenCalledWith('course-1', { filter, wait: true });
  });
});
