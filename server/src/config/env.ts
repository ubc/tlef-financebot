import dotenv from 'dotenv';

// Load variables from a local .env file into process.env, if present. `quiet`
// suppresses dotenv's "injected env (N) from .env" banner so it doesn't clutter
// the app's own startup logs.
dotenv.config({ quiet: true });

function optional(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * Typed view over the environment variables this skeleton actually reads.
 *
 * As components are built up, add their variables here (rather than reading
 * process.env directly elsewhere) so there is a single, typed source of truth.
 * See .env.example for the full set of variables each component will need.
 */
export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3000')),

  // MongoDB (see server/src/components/mongodb). Defaults match the local
  // tlef-mongodb-docker container (root user, auth enabled -> authSource=admin).
  mongodbUri: optional('MONGODB_URI', 'mongodb://mongoadmin:secret@localhost:27017/?authSource=admin'),
  mongodbDbName: optional('MONGODB_DB_NAME', 'financebot'),

  // Session cookie signing secret (see server/src/components/auth). Change in
  // production; the default is only for local development.
  sessionSecret: optional('SESSION_SECRET', 'dev-insecure-secret-change-me'),

  // SAML / Shibboleth auth (see server/src/components/auth).
  // Defaults target the local docker-simple-saml IdP (which runs on :6122) and
  // the port-3000 Service Provider entry that IdP ships with out of the box.
  // If you run on a different PORT, override samlIssuer/samlCallbackUrl and add
  // a matching SP entry to docker-simple-saml (see README).
  samlEnvironment: optional('SAML_ENVIRONMENT', 'LOCAL'),
  samlIssuer: optional('SAML_ISSUER', 'http://localhost:3000'),
  samlCallbackUrl: optional('SAML_CALLBACK_URL', 'http://localhost:3000/auth/ubcshib/callback'),
  samlEntryPoint: optional('SAML_ENTRY_POINT', 'http://localhost:6122/simplesaml/saml2/idp/SSOService.php'),
  samlLogoutUrl: optional('SAML_LOGOUT_URL', 'http://localhost:6122/simplesaml/saml2/idp/SingleLogoutService.php'),
  samlIdpMetadataUrl: optional('SAML_IDP_METADATA_URL', 'http://localhost:6122/simplesaml/saml2/idp/metadata.php'),
  samlIdpCertPath: optional('SAML_IDP_CERT_PATH', './server/certs/idp.pem'),
  // Force re-authentication at the IdP on every login (ForceAuthn). Keeps dev
  // logout meaningful: after logging out, the next login returns to the IdP
  // login page instead of silently reusing the IdP's SSO session. Consider
  // 'false' in production to preserve cross-app SSO.
  samlForceAuthn: optional('SAML_FORCE_AUTHN', 'true') === 'true',
  postLoginRedirect: optional('POST_LOGIN_REDIRECT', '/'),
  postLogoutRedirect: optional('POST_LOGOUT_REDIRECT', '/'),

  // Qdrant vector DB (see server/src/components/qdrant). Defaults match a local
  // Qdrant container. API key is blank for local dev.
  qdrantUrl: optional('QDRANT_URL', 'http://localhost:6333'),
  qdrantApiKey: optional('QDRANT_API_KEY', ''),
  qdrantCollection: optional('QDRANT_COLLECTION', 'financebot'),

  // GenAI LLM (see server/src/components/genai/llm). Provider is one of
  // ollama | openai | anthropic | ubc-llm-sandbox. `endpoint` is used by ollama
  // and ubc-llm-sandbox (and OpenAI-compatible gateways); `apiKey` by
  // openai / anthropic / ubc-llm-sandbox. Defaults target a local Ollama.
  llmProvider: optional('LLM_PROVIDER', 'ollama'),
  llmDefaultModel: optional('LLM_DEFAULT_MODEL', 'ministral-3:latest'),
  // Only Ollama gets the local-endpoint default. For hosted providers (openai /
  // anthropic) an unset LLM_ENDPOINT must stay empty so it resolves to undefined
  // downstream and the SDK uses its own base URL — otherwise every request would
  // be misrouted to the Ollama port. OpenAI-compatible gateways set it explicitly.
  llmEndpoint: optional(
    'LLM_ENDPOINT',
    optional('LLM_PROVIDER', 'ollama') === 'ollama' ? 'http://localhost:11434' : '',
  ),
  llmApiKey: optional('LLM_API_KEY', ''),

  // GenAI embeddings (see server/src/components/genai/embeddings). Provider is
  // `fastembed` (local, self-contained) or an LLM provider name (ollama |
  // openai | ...) whose embedding model is used. The model fixes the vector
  // dimension, which MUST match the Qdrant collection size — the RAG service
  // derives it at runtime so they can never drift.
  embeddingsProvider: optional('EMBEDDINGS_PROVIDER', 'ollama'),
  embeddingsModel: optional('EMBEDDINGS_MODEL', 'nomic-embed-text'),

  // Academic API (see server/src/components/academic-api). A read-only lookup of
  // the signed-in user's person + course records, keyed on their CWL PUID. All
  // optional: they default to the local FakeAcademicAPI (academic_api_fake, on
  // :3689) with its mock Basic-auth credentials, so the feature works out of the
  // box in dev and points at the real Academic API by overriding these. Auth is
  // HTTP Basic (clientId:secret). Leave the base URL blank to disable the feature.
  academicApiBaseUrl: optional('ACADEMIC_API_BASE_URL', 'http://localhost:3689'),
  academicApiClientId: optional('ACADEMIC_API_CLIENT_ID', 'mock-client'),
  academicApiClientSecret: optional('ACADEMIC_API_CLIENT_SECRET', 'mock-secret'),

  // When true, the genai toolkit modules log their full (verbose) debug/info
  // output. Off by default so only warnings/errors from the toolkit surface,
  // keeping the app's own logs readable. See components/genai/logger.ts.
  genaiDebug: optional('GENAI_DEBUG', 'false') === 'true',
} as const;

export const isProduction = env.nodeEnv === 'production';
