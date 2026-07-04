const baseConfig = require('./jest.config');

/**
 * Same tests as jest.config.js, but routed through jest-monocart-coverage for an
 * interactive HTML coverage report (open coverage-reports/unit-monocart/index.html).
 * Run with: npm run test:unit:monocart. See tests/AGENTS.md.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  ...baseConfig,
  collectCoverage: true,
  coverageProvider: 'v8',
  // Let monocart own the reports; suppress Jest's built-in coverage output.
  coverageReporters: ['none'],
  reporters: [
    'default',
    [
      'jest-monocart-coverage',
      {
        name: 'TLEF Starter — Unit Coverage',
        outputDir: './coverage-reports/unit-monocart',
        reports: [['v8'], ['console-summary'], ['lcovonly']],
      },
    ],
  ],
};
