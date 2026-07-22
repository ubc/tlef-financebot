import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';
import { env } from '../../config/env';

// Vector database integration using @qdrant/js-client-rest. Stores the
// embeddings produced by components/genai/embeddings and powers similarity
// search for RAG. A single client is shared process-wide.
export const qdrant = new QdrantClient({
  url: env.qdrantUrl,
  apiKey: env.qdrantApiKey || undefined,
});

/**
 * Create the collection if it does not already exist. Idempotent, so it is safe
 * to call on every ingest/startup. `size` MUST equal the embedding model's
 * dimensionality (see components/genai/embeddings.getEmbeddingDimension); it is
 * fixed at creation time and cannot change without recreating the collection.
 */
export async function ensureCollection(name: string, size: number): Promise<void> {
  const { collections } = await qdrant.getCollections();
  if (collections.some((c) => c.name === name)) return;
  await qdrant.createCollection(name, {
    vectors: { size, distance: 'Cosine' },
  });
}

/** A single vector point to store: a stable id, its vector, and JSON payload. */
export interface UpsertPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}

/** Insert or overwrite points in a collection (waits for indexing). */
export async function upsertPoints(name: string, points: UpsertPoint[]): Promise<void> {
  await qdrant.upsert(name, { wait: true, points });
}

/** A similarity-search result: the point id, its score, and stored payload. */
export interface SearchHit {
  id: string | number;
  score: number;
  payload: Record<string, unknown> | null;
}

/** Qdrant's payload-filter shape, re-exported so services can request scoped
 * retrieval/deletion without importing the SDK or reaching into `qdrant`. */
export type QdrantFilter = Schemas['Filter'];

/** Return the `limit` nearest points to `vector`, with their payloads. The
 * optional filter restricts results by payload (for example materialId). */
export async function search(
  name: string,
  vector: number[],
  limit = 5,
  filter?: QdrantFilter,
): Promise<SearchHit[]> {
  const results = await qdrant.search(name, {
    vector,
    limit,
    with_payload: true,
    ...(filter ? { filter } : {}),
  });
  return results.map((hit) => ({
    id: hit.id,
    score: hit.score,
    payload: (hit.payload ?? null) as Record<string, unknown> | null,
  }));
}

/** Delete every point matching a payload filter and wait until it is applied. */
export async function deletePointsByFilter(name: string, filter: QdrantFilter): Promise<void> {
  await qdrant.delete(name, { filter, wait: true });
}

/** Lightweight reachability check used by GET /api/health. Never throws. */
export async function pingQdrant(): Promise<boolean> {
  try {
    await qdrant.getCollections();
    return true;
  } catch {
    return false;
  }
}
