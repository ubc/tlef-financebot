# AGENTS.md — components/genai/chunking

Split long text into embeddable chunks via
[`ubc-genai-toolkit-chunking`](https://github.com/ubc/ubc-genai-toolkit-chunking).
Sits between `document-parsing` (produces text) and `embeddings` (consumes
chunks).

## Status

Implemented. `index.ts` exports a configured chunker and a `chunkText` helper.

## Environment variables

None. Chunk size/overlap are set in code (see below); change them there.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `chunkText(text, sourceId): Promise<Chunk[]>` | Chunk one document; copies `sourceId` onto each chunk's metadata for provenance. |
| `chunker: ChunkingModule` | The configured module, if you need `chunkDocuments` directly. |
| `Chunk` (type) | Re-exported from the toolkit. |

## Init pattern (real, installed API)

```ts
import { ChunkingModule, type Chunk } from 'ubc-genai-toolkit-chunking';
import { createGenaiLogger } from '../logger';

const chunker = new ChunkingModule({
  strategy: 'recursiveCharacter',
  defaultOptions: { chunkSize: 1000, chunkOverlap: 150 },
  logger: createGenaiLogger('genai:chunking'), // quiet by default
});

// chunkDocuments takes Document[] ({ content, metadata: { sourceId } }) and
// returns { chunks: Chunk[] }. Each Chunk has `.text` and
// `.metadata.chunkNumber` / `.metadata.sourceDocumentMetadata`.
const { chunks } = await chunker.chunkDocuments([
  { content: text, metadata: { sourceId: 'my-doc.pdf' } },
]);
```

Strategies: `simple`, `recursiveCharacter` (default here), `token`.

## Implementation checklist

- [x] Export a configured chunker + a `chunkText(text, sourceId)` helper from
      `index.ts`.
- [x] Pick sensible defaults for chunk size / overlap (1000 / 150 characters).
- [x] Feed the output into `components/genai/embeddings` (see `rag.service.ts`).

## Gotchas

- `chunkDocuments` requires `metadata.sourceId` on every input document — it is
  copied to each chunk so retrieved results can be attributed to a source.
- Chunk size interacts with both the embedding model's max input and the LLM's
  context window — tune it against those limits.
