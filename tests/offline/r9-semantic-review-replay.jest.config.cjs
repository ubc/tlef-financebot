// Explicit retained-artifact replay only; excluded from the default unit suite.
/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Dedicated CommonJS Jest configuration. */
const path = require('node:path');
const base = require('../../jest.config.js');
module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/tests/offline'],
  testMatch: ['**/r9-semantic-review-replay.test.ts'],
  collectCoverage: false,
};
