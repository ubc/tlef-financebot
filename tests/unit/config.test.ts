// Config loading is module-level, so each case re-imports env.ts with a fresh
// module registry and a controlled process.env.
const ORIGINAL_ENV = process.env;

function loadEnv(overrides: Record<string, string>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...overrides };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

describe('assertConfig (production safety)', () => {
  it('throws in production when SESSION_SECRET is the dev default', () => {
    const { assertConfig } = loadEnv({ NODE_ENV: 'production' });
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
