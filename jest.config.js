/**
 * Jest config for unit + integration tests (TypeScript via ts-jest).
 *
 * These tests are fast and deterministic: they exercise pure functions,
 * services with their components mocked, and routers via supertest — no real
 * MongoDB / Qdrant / Ollama / IdP. Browser flows live in the Playwright suites
 * (playwright.config.ts, playwright.a11y.config.ts). See tests/AGENTS.md.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  // Serial: keeps supertest listeners and shared module state deterministic.
  maxWorkers: 1,
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // client/src/*.ts imports sibling modules with an explicit `.js` extension
  // (see client/AGENTS.md's ".js import rule" — tsc's "Bundler"/"NodeNext"
  // resolution rewrites these to the compiled .js at browser-load time, but
  // there is no compiled output alongside the .ts sources for Jest to find).
  // Strip the extension so Jest's own resolver falls back through
  // moduleFileExtensions and lands on the sibling .ts file. Only affects
  // relative imports ending in `.js`; nothing else in the test suite uses
  // that pattern.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  clearMocks: true,
  // V8 provider maps cleanly through ts-jest's source maps back to the .ts files.
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'server/src/**/*.ts',
    '!server/src/server.ts', // entry point (bootstraps real connections)
    '!server/src/types/**', // ambient type declarations
  ],
  coverageDirectory: 'coverage-reports/unit',
  coverageReporters: ['text-summary', 'lcovonly'],
};
