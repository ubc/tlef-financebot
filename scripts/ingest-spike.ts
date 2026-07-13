// Phase-0 integration spike (PRD §11 dependency risk): prove one document
// parses -> chunks -> embeds -> lands in Qdrant -> is retrievable, using the
// exact pinned ubc-genai-toolkit versions. Run: npm run spike:ingest
// Requires: docker compose up (Qdrant) + a reachable embeddings provider
// (e.g. EMBEDDINGS_PROVIDER=fastembed for a fully local model).
import path from 'node:path';
import { parseFile } from '../server/src/components/genai/document-parsing';
import { chunkText } from '../server/src/components/genai/chunking';
import { embed } from '../server/src/components/genai/embeddings';
import { ensureCollection, upsertPoints, search } from '../server/src/components/qdrant';

async function main(): Promise<void> {
  const file = path.resolve(__dirname, '../tests/fixtures/sample-material.md');
  const text = await parseFile(file);
  console.log(`[spike] parsed ${text.length} chars`);

  const chunks = await chunkText(text, 'sample-material.md');
  console.log(`[spike] ${chunks.length} chunks`);

  const vectors = await embed(chunks.map((chunk) => chunk.text));
  console.log(`[spike] embedded, dimension=${vectors[0].length}`);

  const collection = 'spike-course';
  await ensureCollection(collection, vectors[0].length);
  await upsertPoints(
    collection,
    chunks.map((chunk, i) => ({ id: i + 1, vector: vectors[i], payload: { chunk: chunk.text } })),
  );

  const [queryVector] = await embed(['How do I value a perpetuity?']);
  const hits = await search(collection, queryVector, 3);
  console.log('[spike] top hits:');
  for (const hit of hits) {
    console.log(`  score=${hit.score.toFixed(3)} :: ${String(hit.payload?.chunk).slice(0, 80)}`);
  }

  const top = String(hits[0]?.payload?.chunk ?? '');
  if (!top.toLowerCase().includes('perpetuit')) {
    throw new Error('Spike failed: top hit does not mention perpetuities — retrieval path broken.');
  }
  console.log('[spike] OK — ingestion path proven end to end.');
}

main().catch((err) => {
  console.error('[spike] FAILED:', err);
  process.exit(1);
});
