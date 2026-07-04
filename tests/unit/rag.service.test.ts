// Unit test — a SERVICE with its components MOCKED. This is the key pattern for
// isolating a service: rag.service composes genai + qdrant, but here we replace
// those modules with fakes so the test is fast and deterministic (no Ollama /
// Qdrant needed) and we can assert exactly how the service orchestrates them.
//
// jest.mock uses factories so the real component modules never load (they build
// toolkit clients at import time).
jest.mock('../../server/src/components/genai/chunking', () => ({ chunkText: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({
  embed: jest.fn(),
  embedOne: jest.fn(),
  getEmbeddingDimension: jest.fn(),
}));
jest.mock('../../server/src/components/genai/document-parsing', () => ({ parseFile: jest.fn() }));
jest.mock('../../server/src/components/genai/llm', () => ({ llm: { sendMessage: jest.fn() } }));
jest.mock('../../server/src/components/qdrant', () => ({
  ensureCollection: jest.fn(),
  upsertPoints: jest.fn(),
  search: jest.fn(),
}));

import { query, ingestText } from '../../server/src/services/rag.service';
import { chunkText } from '../../server/src/components/genai/chunking';
import { embed, embedOne, getEmbeddingDimension } from '../../server/src/components/genai/embeddings';
import { llm } from '../../server/src/components/genai/llm';
import { upsertPoints, search } from '../../server/src/components/qdrant';

beforeEach(() => {
  // The collection is derived from the embedding model; give it a size so
  // ensureRagCollection() is happy in every test.
  jest.mocked(getEmbeddingDimension).mockResolvedValue(3);
});

describe('rag.service query()', () => {
  it('embeds the question, retrieves chunks, and answers with the retrieved context', async () => {
    jest.mocked(embedOne).mockResolvedValue([0.1, 0.2, 0.3]);
    jest.mocked(search).mockResolvedValue([
      { id: '1', score: 0.91, payload: { text: 'UBC was founded in 1908.', sourceId: 'facts', chunkNumber: 0 } },
    ]);
    jest.mocked(llm.sendMessage).mockResolvedValue({ content: 'UBC was founded in 1908 [1].' } as never);

    const result = await query('When was UBC founded?');

    expect(embedOne).toHaveBeenCalledWith('When was UBC founded?');
    expect(result.answer).toContain('1908');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].sourceId).toBe('facts');
    // The retrieved chunk must be passed to the LLM as grounding context.
    const [userPrompt] = jest.mocked(llm.sendMessage).mock.calls[0];
    expect(userPrompt).toContain('UBC was founded in 1908.');
  });

  it('short-circuits (no LLM call) when nothing has been ingested', async () => {
    jest.mocked(embedOne).mockResolvedValue([0, 0, 0]);
    jest.mocked(search).mockResolvedValue([]);

    const result = await query('anything');

    expect(result.sources).toEqual([]);
    expect(result.answer).toMatch(/don't have any ingested/i);
    expect(llm.sendMessage).not.toHaveBeenCalled();
  });
});

describe('rag.service ingestText()', () => {
  it('chunks, embeds, and upserts one point per chunk', async () => {
    jest.mocked(chunkText).mockResolvedValue([
      { text: 'chunk a', metadata: { chunkNumber: 0 } },
      { text: 'chunk b', metadata: { chunkNumber: 1 } },
    ] as never);
    jest.mocked(embed).mockResolvedValue([
      [1, 1, 1],
      [2, 2, 2],
    ]);

    const result = await ingestText('some source text', 'src-1');

    expect(result).toEqual({ sourceId: 'src-1', chunks: 2 });
    // One Qdrant point per chunk, carrying the chunk text + source for citation.
    const [, points] = jest.mocked(upsertPoints).mock.calls[0];
    expect(points).toHaveLength(2);
    expect(points[0].payload).toMatchObject({ text: 'chunk a', sourceId: 'src-1' });
  });
});
