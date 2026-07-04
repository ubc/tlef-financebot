# AGENTS.md — components/qdrant

Vector database integration using
[`@qdrant/js-client-rest`](https://github.com/qdrant/qdrant-js). Stores the
embeddings produced by `components/genai/embeddings` and powers similarity
search for RAG.

## Status

Implemented. `index.ts` exports the client plus collection/upsert/search helpers.

## Environment variables

| Variable | Meaning | Example |
| --- | --- | --- |
| `QDRANT_URL` | Qdrant REST endpoint | `http://localhost:6333` |
| `QDRANT_API_KEY` | API key (leave blank only if the server has no key) | |
| `QDRANT_COLLECTION` | Default collection name | `financebot` |

Developers run a local Qdrant. NOTE: if the local instance is started with an
API key (`QDRANT__SERVICE__API_KEY`), the `/collections` API returns
`Unauthorized` without it — the unauthenticated root (`/`) still responds, so a
plain `curl` can look "up" while the client fails. Set `QDRANT_API_KEY` to match.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `qdrant: QdrantClient` | The shared client. |
| `ensureCollection(name, size): Promise<void>` | Create the collection if missing. Idempotent. `size` = embedding dimension. |
| `upsertPoints(name, points): Promise<void>` | Insert/overwrite points (`{ id, vector, payload }`), waits for indexing. |
| `search(name, vector, limit?): Promise<SearchHit[]>` | Nearest points with payloads. |
| `pingQdrant(): Promise<boolean>` | Reachability check for `/api/health`. Never throws. |

## Init pattern (real, installed API)

```ts
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../../config/env';

export const qdrant = new QdrantClient({
  url: env.qdrantUrl,
  apiKey: env.qdrantApiKey || undefined,
});

export async function ensureCollection(name: string, size: number): Promise<void> {
  const { collections } = await qdrant.getCollections();
  if (collections.some((c) => c.name === name)) return;
  await qdrant.createCollection(name, { vectors: { size, distance: 'Cosine' } });
}
```

`upsert` accepts `{ wait: true, points: [{ id, vector, payload }] }`; point `id`
must be an unsigned integer or a UUID (the RAG example uses `crypto.randomUUID`).
`search` accepts `{ vector, limit, with_payload: true }` and returns
`ScoredPoint[]` (`{ id, score, payload }`).

## How it is wired

- `server/src/server.ts` calls `pingQdrant()` at startup and logs a warning
  (non-fatal — Qdrant only backs the deletable RAG example) if unreachable.
- `GET /api/health` reports `{ services: { qdrant: "up" | "down" } }`.
- `services/rag.service.ts` derives the vector size from the embedding model
  (`getEmbeddingDimension()`) and calls `ensureCollection` lazily on first use.

## Implementation checklist

- [x] Add `qdrantUrl` / `qdrantApiKey` / `qdrantCollection` to `config/env.ts`
      (+ `.env.example`).
- [x] Create the client + `ensureCollection` in `index.ts`.
- [x] Add `upsertPoints` and `search` helpers.
- [x] Decide the vector `size` — derived from the embeddings model at runtime.
- [x] Report reachability in `GET /api/health`.

## Gotchas

- The vector `size` and `distance` are fixed at collection creation and must
  match the embeddings model. A mismatch causes upsert/search errors. Changing
  the model means recreating the collection (or using a new name).
- Keep collection creation idempotent (`ensureCollection`) so startup/ingest is
  safe to repeat.
- The client version may warn about a server version mismatch; that is harmless.
  An `Unauthorized` error means `QDRANT_API_KEY` is missing/incorrect.
