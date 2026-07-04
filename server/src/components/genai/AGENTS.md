# AGENTS.md — components/genai

Integrations with the [UBC GenAI Toolkit](https://github.com/ubc/ubc-genai-toolkit-ts).
As of mid-2025 the toolkit is published as separate, focused npm packages rather
than one monolith. Each follows the same Facade pattern: construct a module with
a config object (plus a logger from `ubc-genai-toolkit-core`) and call its
methods.

## Modules in this folder

| Subfolder | Package | Role |
| --- | --- | --- |
| `llm/` | `ubc-genai-toolkit-llm` | Chat / text generation |
| `embeddings/` | `ubc-genai-toolkit-embeddings` | Text -> vectors (feeds Qdrant) |
| `chunking/` | `ubc-genai-toolkit-chunking` | Split long text into chunks |
| `document-parsing/` | `ubc-genai-toolkit-document-parsing` | Files -> plain text |

`ubc-genai-toolkit-core` provides shared types and a `ConsoleLogger` used by all
of them.

## Status

All four modules are implemented; see each subfolder's `AGENTS.md` for its real
exported API and env vars. They are orchestrated into a RAG pipeline by the
(deletable) `services/rag.service.ts`. Note that the installed package versions
differ from some published READMEs — the subfolder docs describe the **installed**
API (e.g. embeddings uses `EmbeddingsModule.create({ providerType })`, and
document-parsing's `parse` takes a file path, not a Buffer).

## Shared conventions

- Every module takes a `logger`. Use the shared `createGenaiLogger(prefix)` from
  `components/genai/logger.ts` rather than the toolkit's `ConsoleLogger`
  directly:

  ```ts
  import { createGenaiLogger } from '../logger';
  const logger = createGenaiLogger('genai:llm');
  ```

  The toolkit's own `ConsoleLogger` logs debug/info/warn/error at all levels,
  which is very chatty at startup and on every call. `createGenaiLogger` returns
  a quiet logger (warn/error only) by default, or the full `ConsoleLogger` when
  `GENAI_DEBUG=true`. This keeps the app's own `[server]`/route logs readable.

- Read all config (providers, endpoints, API keys) from `config/env.ts`, not
  `process.env`.
- Each subfolder's `index.ts` should export a single ready-configured module
  instance (or a small factory), so services just import and use it.

## Typical RAG pipeline (how these compose)

```
document-parsing (file -> text)
  -> chunking (text -> chunks)
  -> embeddings (chunks -> vectors)
  -> qdrant.upsert (store)         [components/qdrant]

query -> embeddings (query -> vector) -> qdrant.search -> llm (answer with context)
```

Orchestrate this in a `service` (e.g. `services/rag.service.ts`), not inside the
components themselves.

## A note on `fetch` / ESM

The backend is CommonJS on Node 18+, which has a global `fetch`, so `node-fetch`
is generally unnecessary. If a toolkit module or your own code must use
`node-fetch`, note that current `node-fetch` (v3) is ESM-only; prefer the global
`fetch` or a dynamic `import()` to avoid `require()` errors.
