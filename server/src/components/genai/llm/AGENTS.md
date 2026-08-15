# AGENTS.md — components/genai/llm

Chat / text generation via
[`ubc-genai-toolkit-llm`](https://github.com/ubc/ubc-genai-toolkit-llm).

## Status

Implemented. A single, env-configured `LLMModule` is exported from `index.ts`.

## Environment variables

| Variable | Meaning | Example |
| --- | --- | --- |
| `LLM_PROVIDER` | `ollama` \| `openai` \| `anthropic` \| `ubc-llm-sandbox` | `ollama` |
| `LLM_DEFAULT_MODEL` | Default model id | `ministral-3:latest` |
| `LLM_ENDPOINT` | Server URL (ollama / ubc-llm-sandbox / OpenAI-compatible) | `http://localhost:11434` |
| `LLM_API_KEY` | API key (openai / anthropic / ubc-llm-sandbox) | |

`endpoint` is passed only when set; `apiKey` likewise. This one generic pair maps
to whatever the chosen provider needs, so switching providers is a config change
only. All four are read in `config/env.ts`.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `llm: LLMModule` | The configured module. `sendMessage`, `sendConversation`, `createConversation`, `getAvailableModels`, ... |
| `pingLlm(): Promise<boolean>` | Best-effort reachability probe (lists models). Never throws. Provided for a live health probe, but **not wired into `/api/health` today** — that endpoint reports the configured LLM/embeddings provider + model (fast, no network call) rather than probing the provider. Call `pingLlm()` there if you want a live check. |

## Init pattern (real, installed API)

```ts
import { LLMModule, type LLMConfig, type ProviderType } from 'ubc-genai-toolkit-llm';
import { env } from '../../../config/env';
import { createGenaiLogger } from '../logger';

const config: LLMConfig = {
  provider: env.llmProvider as ProviderType,
  defaultModel: env.llmDefaultModel,
  endpoint: env.llmEndpoint || undefined,
  apiKey: env.llmApiKey || undefined,
  logger: createGenaiLogger('genai:llm'), // quiet by default; see components/genai/logger.ts
};

export const llm = new LLMModule(config);
```

## Usage

**Always shape options through `modelRequestOptions` — never pass `temperature`
or `maxTokens` literally.** See the first gotcha below for why.

```ts
import { llm } from '.';
import { modelRequestOptions } from './model-capabilities';

// Single message
const response = await llm.sendMessage('What is the UBC GenAI Toolkit?', {
  ...modelRequestOptions({ temperature: 0.5, maxTokens: 400, reasoningEffort: 'none' }),
});
console.log(response.content, response.usage);

// Multi-turn conversation (history is tracked for you)
const conversation = llm.createConversation();
conversation.addMessage('system', 'You are a helpful assistant.');
conversation.addMessage('user', 'What is the capital of France?');
const reply = await conversation.send(modelRequestOptions({ maxTokens: 100, reasoningEffort: 'none' }));
```

`reasoningEffort: 'none'` is what keeps a temperature legal and keeps a small
token budget spendable on visible output rather than on hidden reasoning. Drop
it only when you want the model to think.

Streaming is supported via `streamConversation` / `conversation.stream()`.

## Implementation checklist

- [x] Add the LLM variables to `config/env.ts` (+ `.env.example`).
- [x] Construct and export a configured `LLMModule` in `index.ts`.
- [x] Add a `chat`-style service/route (see `services/rag.service.ts` — the RAG
      example calls `sendMessage` with retrieved context).
- [x] For RAG, retrieve context from `components/qdrant` first, then pass it in
      the system/user messages.

## Gotchas

- **Never pass `temperature` / `maxTokens` to `sendMessage` literally.** Shape
  them through `modelRequestOptions` (`./model-capabilities.ts`) first. Every
  GPT-5 model rejects `max_tokens` outright (`Use 'max_completion_tokens'
  instead`), and rejects any explicit `temperature` while reasoning is active.
  `completeJson` already does this; `rag.service` had been failing a 400 on every
  call because it did not.
- **`max_completion_tokens` is not a renamed `max_tokens`.** It budgets reasoning
  AND visible output together, so a reasoning model can spend the whole cap
  thinking and return `''` with `finish_reason: 'length'`. Measured: luna burned
  all 500 tokens on reasoning. Pair a small cap with `reasoningEffort: 'none'`.
- **An unknown model id that looks like OpenAI's** (`gpt-*`, `o1`/`o3`…) resolves
  to `reasoning-tunable`, not `classic` — dated snapshots like
  `gpt-5.4-nano-2026-08-01` would otherwise get `max_tokens` and 400. Anything
  else (Ollama, local models) still falls back to `classic`.

- **Thinking models return empty content on a small token budget.** Models like
  `qwen3.*`, `gemma3/4`, `gpt-oss`, `glm-*` emit their reasoning into a hidden
  `thinking` channel; with a small `maxTokens` they hit the limit before writing
  any visible `content` (you get `""`). Use a non-thinking model (e.g.
  `ministral-3`) for predictable output, or give thinking models a large
  `maxTokens`.
- The toolkit maps `maxTokens` → Ollama's `num_predict` and `temperature` →
  Ollama `options.temperature`; other keys pass through as provider options.
- `getAvailableModels()` hits the provider (fast for local Ollama; a real API
  call for hosted providers) — that is why `pingLlm` wraps it in try/catch.
- Backend is CommonJS on Node 18+; the toolkit works with the global `fetch`.
