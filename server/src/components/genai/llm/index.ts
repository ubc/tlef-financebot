import { LLMModule, type LLMConfig, type ProviderType } from 'ubc-genai-toolkit-llm';
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
