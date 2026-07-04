import { randomUUID } from 'node:crypto';
import { chunkText } from '../components/genai/chunking';
import { embed, embedOne, getEmbeddingDimension } from '../components/genai/embeddings';
import { parseFile } from '../components/genai/document-parsing';
import { llm } from '../components/genai/llm';
import { ensureCollection, upsertPoints, search } from '../components/qdrant';
import { env } from '../config/env';

// -----------------------------------------------------------------------------
// EXAMPLE component usage. This "rag" feature exists only to demonstrate how a
// service composes the genai + qdrant components into a Retrieval-Augmented
// Generation pipeline:
//
//   ingest:  document-parsing -> chunking -> embeddings -> qdrant.upsert
//   query:   embeddings -> qdrant.search -> llm (answer with context)
//
// It is safe to delete once you have your own features. See
// server/src/services/AGENTS.md and the genai / qdrant component AGENTS.md.
// -----------------------------------------------------------------------------

// The Qdrant collection is created lazily on first use. Its vector size is taken
// from the embedding model itself (getEmbeddingDimension), so the collection can
// never be created with a size that mismatches the model. Cached so we only hit
// getCollections once per process after it succeeds.
let collectionReady = false;

async function ensureRagCollection(): Promise<void> {
  if (collectionReady) return;
  const size = await getEmbeddingDimension();
  await ensureCollection(env.qdrantCollection, size);
  collectionReady = true;
}

export interface IngestResult {
  sourceId: string;
  chunks: number;
}

/** Ingest raw text: chunk it, embed the chunks, and upsert them into Qdrant. */
export async function ingestText(text: string, sourceId: string): Promise<IngestResult> {
  await ensureRagCollection();

  const chunks = await chunkText(text, sourceId);
  if (chunks.length === 0) return { sourceId, chunks: 0 };

  const vectors = await embed(chunks.map((chunk) => chunk.text));
  const points = chunks.map((chunk, i) => ({
    id: randomUUID(),
    vector: vectors[i],
    payload: {
      text: chunk.text,
      sourceId,
      chunkNumber: chunk.metadata.chunkNumber,
    },
  }));

  await upsertPoints(env.qdrantCollection, points);
  return { sourceId, chunks: chunks.length };
}

/** Ingest a file: parse it to text, then run the same pipeline as ingestText. */
export async function ingestFile(filePath: string, sourceId: string): Promise<IngestResult> {
  const text = await parseFile(filePath, 'text');
  return ingestText(text, sourceId);
}

export interface QuerySource {
  sourceId: string;
  chunkNumber?: number;
  score: number;
  text: string;
}

export interface QueryResult {
  answer: string;
  sources: QuerySource[];
}

/**
 * Answer a question over the ingested documents: embed the question, retrieve
 * the nearest chunks from Qdrant, and ask the LLM to answer using only that
 * context. Returns the answer plus the sources it was grounded on.
 */
export async function query(question: string, topK = 4): Promise<QueryResult> {
  await ensureRagCollection();

  const vector = await embedOne(question);
  const hits = await search(env.qdrantCollection, vector, topK);

  const sources: QuerySource[] = hits.map((hit) => ({
    sourceId: String(hit.payload?.sourceId ?? 'unknown'),
    chunkNumber:
      typeof hit.payload?.chunkNumber === 'number' ? hit.payload.chunkNumber : undefined,
    score: hit.score,
    text: String(hit.payload?.text ?? ''),
  }));

  if (sources.length === 0) {
    return {
      answer: "I don't have any ingested documents to answer from yet.",
      sources,
    };
  }

  const context = sources
    .map((source, i) => `[${i + 1}] (${source.sourceId}) ${source.text}`)
    .join('\n\n');

  const systemPrompt =
    'You are a helpful assistant. Answer the question using ONLY the provided ' +
    'context. If the answer is not in the context, say you do not know. Cite ' +
    'the sources you use with their bracketed number, e.g. [1].';
  const userPrompt = `Context:\n${context}\n\nQuestion: ${question}`;

  const response = await llm.sendMessage(userPrompt, {
    systemPrompt,
    temperature: 0.2,
    maxTokens: 500,
  });

  return { answer: response.content, sources };
}
