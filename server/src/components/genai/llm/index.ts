import { LLMModule, type LLMConfig, type LLMOptions, type ProviderType } from 'ubc-genai-toolkit-llm';
import { env } from '../../../config/env';
import { modelRequestOptions, type ModelRequestOptions } from './model-capabilities';
import { createGenaiLogger } from '../logger';
import { escapeInvalidJsonBackslashes, restoreLatexEscapes } from './latex-escapes';
import { observeLLMModule, withModelCallContext, type ModelCallObserver, type ModelUsageContext } from './model-call';
import { installOpenAIUsageAdapter } from './openai-usage-adapter';

export { withModelCallObserver } from './model-call';
export type { ModelCallEvent, ModelCallObserver, ModelUsageContext } from './model-call';
export type { ModelUsage } from './provider-usage';

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
const config = buildConfig();
const moduleInstance = new LLMModule(config);
installOpenAIUsageAdapter(moduleInstance, config);
export const llm = observeLLMModule(moduleInstance, config);

export interface CompleteJsonOptions extends ModelRequestOptions {
  systemPrompt?: string;
  /** Recheck durable cancellation before every provider attempt, including JSON retry. */
  beforeRequest?: () => Promise<void>;
  /** Cumulative visible response text; resets to empty before each JSON attempt. */
  onText?: (text: string) => void;
  /** Called with the provider's token usage after each underlying request
   * (including the JSON-retry request, so a caller may see two calls). The
   * pipeline never sets this; it exists for the prompt A/B harness
   * (scripts/prompt-ab), whose cost numbers were previously reconstructed
   * from character counts. Absent usage (provider-dependent) is not
   * reported. */
  onUsage?: (usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => void;
  /** Optional local listener, independent of the current scoped recorder. */
  onAttempt?: ModelCallObserver;
  usageContext?: Omit<ModelUsageContext, 'jsonAttempt'>;
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
  const match = withoutFence.match(/[[{][\s\S]*[\]}]/);
  const attempts = [withoutFence, ...(match ? [match[0]] : [])];
  // Each candidate as sent, then with invalid backslash escapes doubled: a LaTeX
  // `\left`, `\sqrt` or `\ln` written with one backslash is not a JSON escape at
  // all, so the whole reply fails to parse and would cost a retry call.
  for (const text of [...attempts, ...attempts.map(escapeInvalidJsonBackslashes)]) {
    try {
      return restoreLatexEscapes(JSON.parse(text)) as T;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('llm-json-parse-failed');
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
  // Effort `none` unless the caller asks otherwise. Every caller of this helper
  // passes `temperature: 0` (or relies on its default) BECAUSE it wants a
  // reproducible JSON answer — and a temperature is only legal while the
  // effective effort is `none`. Without this, switching the configured model to
  // one that reasons by default would silently drop every caller's temperature
  // and make classification, structure validation and review nondeterministic,
  // with nothing raised and nothing logged. Callers wanting the model to think
  // (a reviewer at `high`, say) pass `reasoningEffort` and knowingly give up the
  // temperature in exchange.
  const sendOptions: LLMOptions = {
    ...modelRequestOptions({ ...options, reasoningEffort: options.reasoningEffort ?? 'none' }),
    responseFormat: 'json',
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
  };

  const send = async (text: string, jsonAttempt: number) => {
    await options.beforeRequest?.();
    return withModelCallContext({ ...options.usageContext, jsonAttempt }, options.onAttempt, async () => {
      if (!options.onText) return llm.sendMessage(text, sendOptions);
      let content = '';
      options.onText('');
      return llm.streamConversation([{ role: 'user', content: text }], chunk => {
        content += chunk;
        options.onText?.(content);
      }, sendOptions);
    });
  };
  const reportUsage = async (usage: typeof first.usage) => {
    // A legacy callback is telemetry too; it must not cause a paid JSON retry.
    if (usage) try { await options.onUsage?.(usage); } catch { /* Keep the paid response. */ }
  };
  const first = await send(prompt, 0);
  await reportUsage(first.usage);
  try {
    return extractJson<T>(first.content);
  } catch {
    const retry = await send(
      `${prompt}\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.`,
      1,
    );
    await reportUsage(retry.usage);
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
