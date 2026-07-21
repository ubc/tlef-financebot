// Config loading is module-level, so each case re-imports env.ts with a fresh
// module registry and a controlled process.env.
const ORIGINAL_ENV = process.env;

function loadEnv(overrides: Record<string, string>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...overrides };
  return require('../../server/src/config/env') as typeof import('../../server/src/config/env');
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('config: per-step model selection (AD-07 groundwork)', () => {
  it('falls back to LLM_DEFAULT_MODEL when a step model is unset', () => {
    const { env } = loadEnv({ LLM_DEFAULT_MODEL: 'base-model', LLM_MODEL_GENERATOR: '' });
    expect(env.llmModelGenerator).toBe('base-model');
    expect(env.llmModelMasteryEvaluator).toBe('base-model');
  });

  it('uses the step-specific model when set', () => {
    const { env } = loadEnv({
      LLM_DEFAULT_MODEL: 'base-model',
      LLM_MODEL_REVIEWER: 'big-model',
      LLM_MODEL_MASTERY_EVALUATOR: 'cheap-model',
    });
    expect(env.llmModelReviewer).toBe('big-model');
    expect(env.llmModelMasteryEvaluator).toBe('cheap-model');
    expect(env.llmModelGenerator).toBe('base-model');
  });
});

describe('config: LLM endpoint selection', () => {
  it('uses local Ollama when its endpoint is blank', () => {
    const { env } = loadEnv({ LLM_PROVIDER: 'ollama', LLM_ENDPOINT: '' });
    expect(env.llmEndpoint).toBe('http://localhost:11434');
  });

  it('leaves a hosted provider endpoint unset so the SDK uses its default', () => {
    const { env } = loadEnv({ LLM_PROVIDER: 'openai', LLM_ENDPOINT: '' });
    expect(env.llmEndpoint).toBe('');
  });

  it('preserves an explicit OpenAI-compatible gateway endpoint', () => {
    const { env } = loadEnv({
      LLM_PROVIDER: 'openai',
      LLM_ENDPOINT: 'https://llm.example.test/v1',
    });
    expect(env.llmEndpoint).toBe('https://llm.example.test/v1');
  });
});

describe('config: admin allowlist and worker limits', () => {
  it('parses ADMIN_CWL_ALLOWLIST as a trimmed, non-empty list', () => {
    const { env } = loadEnv({ ADMIN_CWL_ALLOWLIST: ' PUID-A , PUID-B ,, ' });
    expect(env.adminCwlAllowlist).toEqual(['PUID-A', 'PUID-B']);
  });

  it('defaults worker limits and parses overrides as numbers', () => {
    expect(loadEnv({}).env.paramWorkerTimeoutMs).toBe(2000);
    expect(loadEnv({ PARAM_WORKER_TIMEOUT_MS: '500', PARAM_WORKER_MEMORY_MB: '32' }).env.paramWorkerTimeoutMs).toBe(500);
    expect(loadEnv({ PARAM_WORKER_MEMORY_MB: '32' }).env.paramWorkerMemoryMb).toBe(32);
  });
});

describe('config: Academic API', () => {
  it('defaults to the local FakeAcademicAPI container', () => {
    const { env } = loadEnv({
      ACADEMIC_API_URL: '',
      ACADEMIC_API_CLIENT_ID: '',
      ACADEMIC_API_CLIENT_SECRET: '',
    });
    expect(env.academicApiUrl).toBe('http://localhost:3689');
    expect(env.academicApiClientId).toBe('mock-client');
    expect(env.academicApiClientSecret).toBe('mock-secret');
  });

  it('uses overrides when set (real API on staging/production)', () => {
    const { env } = loadEnv({
      ACADEMIC_API_URL: 'https://api.example.ubc.ca',
      ACADEMIC_API_CLIENT_ID: 'real-id',
      ACADEMIC_API_CLIENT_SECRET: 'real-secret',
    });
    expect(env.academicApiUrl).toBe('https://api.example.ubc.ca');
    expect(env.academicApiClientId).toBe('real-id');
    expect(env.academicApiClientSecret).toBe('real-secret');
  });
});

describe('assertConfig (production safety)', () => {
  it('throws in production when SESSION_SECRET is the dev default', () => {
    // Set the dev-default value explicitly so the case is hermetic even when a
    // developer has a local .env (dotenv would otherwise inject a real secret).
    const { assertConfig } = loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 'dev-insecure-secret-change-me' });
    expect(() => assertConfig()).toThrow(/SESSION_SECRET/);
  });

  it('passes in production with a real secret', () => {
    const { assertConfig } = loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret' });
    expect(() => assertConfig()).not.toThrow();
  });

  it('never throws in development', () => {
    const { assertConfig } = loadEnv({ NODE_ENV: 'development' });
    expect(() => assertConfig()).not.toThrow();
  });
});
