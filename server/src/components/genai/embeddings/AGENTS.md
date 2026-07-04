# AGENTS.md — components/genai/embeddings

Turn text into vectors via
[`ubc-genai-toolkit-embeddings`](https://github.com/ubc/ubc-genai-toolkit-embeddings).
These vectors are stored and searched in `components/qdrant`.

## Status

Implemented. `index.ts` lazily creates one embeddings module and exposes small
helpers.

## Environment variables

| Variable | Meaning | Example |
| --- | --- | --- |
| `EMBEDDINGS_PROVIDER` | `fastembed` (local, self-contained) **or** an LLM provider name (`ollama` \| `openai` \| ...) | `ollama` |
| `EMBEDDINGS_MODEL` | Embedding model id (ignored for `fastembed`'s default) | `nomic-embed-text` |

When `EMBEDDINGS_PROVIDER` is an LLM provider name, the module routes through
`ubc-genai-toolkit-llm` and reuses `LLM_ENDPOINT` / `LLM_API_KEY` from the `llm`
component's env. Read in `config/env.ts`.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `getEmbeddings(): Promise<EmbeddingsModule>` | Lazily create (once) and return the module. |
| `embed(texts: string[]): Promise<number[][]>` | Embed a batch; one vector per input. |
| `embedOne(text: string): Promise<number[]>` | Embed a single string. |
| `getEmbeddingDimension(): Promise<number>` | The model's output dimension, discovered by embedding a probe once and cached. |

## Init pattern (real, installed API)

The installed version differs from the package README: the module is created via
a **static async factory** and takes a `providerType`, not a plain `{ model }`.

```ts
import { EmbeddingsModule, type EmbeddingsConfig } from 'ubc-genai-toolkit-embeddings';
import { createGenaiLogger } from '../logger';

const logger = createGenaiLogger('genai:embeddings'); // quiet by default

// fastembed (local):
const m1 = await EmbeddingsModule.create({ providerType: 'fastembed', logger });

// via an LLM provider (e.g. Ollama nomic-embed-text):
const m2 = await EmbeddingsModule.create({
  providerType: 'ubc-genai-toolkit-llm',
  llmConfig: { provider: 'ollama', endpoint: '...', embeddingModel: 'nomic-embed-text', defaultModel: '...', logger },
  logger,
});

const vectors = await m2.embed(['hello', 'world']); // number[][]
```

## Dimensions (must match Qdrant)

| Provider / model | Dimension |
| --- | --- |
| `fastembed` bge-small-en-v1.5 (default) | 384 |
| Ollama `nomic-embed-text` | 768 |
| OpenAI `text-embedding-3-small` | 1536 |

The RAG example does **not** hard-code this: it calls `getEmbeddingDimension()`
and creates the Qdrant collection with that size, so the model and collection
can never drift apart.

## Implementation checklist

- [x] Add embeddings provider/model variables to `config/env.ts` (+ `.env.example`).
- [x] Export a configured embeddings module (lazy factory) from `index.ts`.
- [x] Record the embedding dimension — derived at runtime via
      `getEmbeddingDimension()` and used to size the Qdrant collection.
- [x] Expose a helper to embed a single string (`embedOne`) and a batch (`embed`).

## Gotchas

- Model choice fixes the vector dimensionality. If you change the model, the
  Qdrant collection must be recreated with the matching `size` (delete the old
  collection or use a new `QDRANT_COLLECTION` name).
- `EmbeddingsModule.create` is async — do not `new` it. `index.ts` caches the
  creation promise so the provider initializes only once.
- `fastembed` downloads its model on first use (needs network + local disk).
