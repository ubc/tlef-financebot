# AGENTS.md — server/src/config

Configuration and environment handling.

## `env.ts`

The single source of truth for environment variables. It calls `dotenv.config()`
once and exposes a typed, frozen `env` object plus an `isProduction` flag.

Rules:

- Every `process.env` read happens here — nowhere else in the codebase.
- When a component needs a new variable:
  1. Add it to `/.env.example` with an explanatory comment, grouped by component.
  2. Add a typed field to the `env` object here (with a sensible default or an
     explicit "required" check).
- Keep secrets out of source control; only `.env.example` (no real values) is
  committed.

Currently read: core (`nodeEnv`, `port`), MongoDB (`mongodbUri`,
`mongodbDbName`), session (`sessionSecret`), SAML/auth (`samlEnvironment`,
`samlIssuer`, `samlCallbackUrl`, `samlEntryPoint`, `samlLogoutUrl`,
`samlIdpMetadataUrl`, `samlIdpCertPath`, `samlForceAuthn`, `postLoginRedirect`,
`postLogoutRedirect`), Qdrant (`qdrantUrl`, `qdrantApiKey`, `qdrantCollection`),
GenAI LLM (`llmProvider`, `llmDefaultModel`, `llmEndpoint`, `llmApiKey`), GenAI
embeddings (`embeddingsProvider`, `embeddingsModel`), and GenAI logging
(`genaiDebug`).
