import { ChunkingModule, type Chunk } from 'ubc-genai-toolkit-chunking';
import { createGenaiLogger } from '../logger';

// Split long text into embeddable chunks via ubc-genai-toolkit-chunking. Sits
// between document-parsing (produces text) and embeddings (consumes chunks).
const logger = createGenaiLogger('genai:chunking');

// recursiveCharacter keeps related text together while capping size. The
// defaults suit prose; tune chunkSize/overlap against your embedding model's
// max input and the LLM's context window.
const chunker = new ChunkingModule({
  strategy: 'recursiveCharacter',
  defaultOptions: { chunkSize: 1000, chunkOverlap: 150 },
  logger,
});

/**
 * Chunk one document's text. `sourceId` identifies the origin (filename, URL,
 * etc.) and is copied onto every chunk's metadata for provenance/citations.
 */
export async function chunkText(text: string, sourceId: string): Promise<Chunk[]> {
  const { chunks } = await chunker.chunkDocuments([
    { content: text, metadata: { sourceId } },
  ]);
  return chunks;
}

export { chunker };
export type { Chunk };
