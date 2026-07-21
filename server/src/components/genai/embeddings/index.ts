import {
  EmbeddingsModule,
  FastEmbedModel,
  type EmbeddingsConfig,
} from 'ubc-genai-toolkit-embeddings';
import type { ProviderType } from 'ubc-genai-toolkit-llm';
import { env } from '../../../config/env';
import { createGenaiLogger } from '../logger';

// Text -> vectors via ubc-genai-toolkit-embeddings.
//
// The module is created asynchronously (EmbeddingsModule.create is a static
// async factory that initializes the underlying provider), so we cache the
// promise and expose small async helpers. Two provider shapes are supported:
//   - `fastembed`: a self-contained local model (downloads on first use).
//   - any LLM provider name (ollama | openai | ...): embeddings are produced by
//     the toolkit LLM module using EMBEDDINGS_MODEL, reusing LLM_ENDPOINT /
//     LLM_API_KEY.
const logger = createGenaiLogger('genai:embeddings');

function buildConfig(): Partial<EmbeddingsConfig> {
  if (env.embeddingsProvider === 'fastembed') {
    // Match CREATE's effective local embedding model explicitly. The toolkit
    // currently defaults to this model too, but pinning it here prevents an
    // upstream default change from silently changing vector dimensions.
    return {
      providerType: 'fastembed',
      fastembedConfig: {
        model: FastEmbedModel.BGESmallENV15,
        cacheDir: 'local_cache',
        showDownloadProgress: true,
      },
      logger,
    };
  }
  return {
    providerType: 'ubc-genai-toolkit-llm',
    llmConfig: {
      provider: env.embeddingsProvider as ProviderType,
      endpoint: env.llmEndpoint || undefined,
      apiKey: env.llmApiKey || undefined,
      // defaultModel is required by LLMConfig but unused for embeddings; the
      // embedding model below is what actually drives embed().
      defaultModel: env.llmDefaultModel,
      embeddingModel: env.embeddingsModel,
      logger,
    },
    logger,
  };
}

let modulePromise: Promise<EmbeddingsModule> | undefined;
let dimension: number | undefined;

/** Lazily create (once) and return the configured embeddings module. */
export async function getEmbeddings(): Promise<EmbeddingsModule> {
  if (!modulePromise) {
    modulePromise = EmbeddingsModule.create(buildConfig());
  }
  return modulePromise;
}

/** Embed a batch of strings into vectors (one vector per input). */
export async function embed(texts: string[]): Promise<number[][]> {
  const module = await getEmbeddings();
  const vectors = await module.embed(texts);
  // Shim: the fastembed provider path returns Float32Array instances per
  // vector at runtime (despite the toolkit's number[][] type), which
  // JSON.stringify serializes as {"0":..,"1":..} instead of an array —
  // silently breaking any consumer that sends the vector over JSON (e.g.
  // Qdrant's upsert, which then rejects it with "did not match any variant
  // of untagged enum VectorStruct"). Normalize to plain arrays so embed()
  // actually satisfies its declared return type for every provider.
  return vectors.map((vector) => Array.from(vector));
}

/** Embed a single string into one vector. */
export async function embedOne(text: string): Promise<number[]> {
  const [vector] = await embed([text]);
  return vector;
}

/**
 * The embedding model's output dimensionality, discovered by embedding a tiny
 * probe once and caching the result. The Qdrant collection's vector `size` must
 * equal this, so callers use it to create the collection — guaranteeing the two
 * can never drift apart when the model changes.
 */
export async function getEmbeddingDimension(): Promise<number> {
  if (dimension === undefined) {
    const [vector] = await embed(['dimension probe']);
    dimension = vector.length;
  }
  return dimension;
}
