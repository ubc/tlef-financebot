import { LLMModule, type LLMConfig, type LLMOptions, type ProviderType } from 'ubc-genai-toolkit-llm';
import { env } from '../../../config/env';
import { createGenaiLogger } from '../logger';

// Chat / text generation via ubc-genai-toolkit-llm. A single, process-wide
// module is constructed from `env`; the provider (ollama | openai | anthropic |
// ubc-llm-sandbox) and model are configuration, so switching providers never
// touches this file.
const logger = createGenaiLogger('genai:llm');

function buildConfig(): LLMConfig {
  return {
    provider: env.llmProvider as ProviderType,
    defaultModel: env.llmDefaultModel,
    // endpoint is needed by ollama / ubc-llm-sandbox (and OpenAI-compatible
    // gateways); apiKey by openai / anthropic / ubc-llm-sandbox. Pass undefined
    // rather than '' so the SDK falls back to its own defaults when unused.
    endpoint: env.llmEndpoint || undefined,
    apiKey: env.llmApiKey || undefined,
    logger,
  };
}

/** The configured LLM module. Use `sendMessage` / `createConversation`. */
export const llm = new LLMModule(buildConfig());

export interface CompleteJsonOptions {
  /** Model override (falls back to the module's LLM_DEFAULT_MODEL). */
  model?: string;
  systemPrompt?: string;
  /** Defaults to 0 — classification/suggestion want deterministic JSON. */
  temperature?: number;
  maxTokens?: number;
}

/**
 * Extract a JSON value from a raw LLM reply. Local models frequently wrap JSON
 * in a ```json fence and/or surround it with prose ("Sure, here you go: …"), so
 * a bare `JSON.parse` on `content` is too brittle. Strip a leading/trailing
 * code fence first; if that still doesn't parse, fall back to the first
 * balanced-looking `{…}`/`[…]` slice. Throws if neither yields valid JSON.
 */
function extractJson<T>(content: string): T {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence) as T;
  } catch {
    const match = withoutFence.match(/[[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error('llm-json-parse-failed');
  }
}

/**
 * JSON completion on top of `llm.sendMessage`. The toolkit exposes a
 * Zod-validated `sendStructuredConversation`, but it "requires a model that
 * supports structured JSON (provider-specific)" — which the local Ollama
 * default (`ministral-3`) does not — so this helper takes the portable route:
 * ask for JSON (`responseFormat: 'json'`, `temperature: 0`), parse tolerantly,
 * and retry EXACTLY ONCE with a corrective nudge if the first reply isn't
 * JSON. Throws `llm-json-parse-failed` if even the retry fails to parse, so
 * callers can decide whether that is fatal (a route → 5xx) or best-effort (the
 * ingest tail's classification, which swallows it and leaves the material
 * "Unclassified").
 */
export async function completeJson<T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> {
  const sendOptions: LLMOptions = {
    temperature: options.temperature ?? 0,
    responseFormat: 'json',
    ...(options.model ? { model: options.model } : {}),
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
  };

  const first = await llm.sendMessage(prompt, sendOptions);
  try {
    return extractJson<T>(first.content);
  } catch {
    const retry = await llm.sendMessage(
      `${prompt}\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.`,
      sendOptions,
    );
    return extractJson<T>(retry.content);
  }
}

/**
 * Best-effort reachability check for GET /api/health. Lists the provider's
 * models (a cheap call for local Ollama; a real API call for hosted providers).
 * Never throws.
 */
export async function pingLlm(): Promise<boolean> {
  try {
    await llm.getAvailableModels();
    return true;
  } catch {
    return false;
  }
}
