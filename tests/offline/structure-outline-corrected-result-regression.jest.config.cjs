// Opt-in retained-artifact replay, deliberately excluded from npm test.
// Requires local ignored audit inputs named in the test and copied candidate.
/* global require, module, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Dedicated CommonJS Jest configuration. */
const path = require('node:path');
const base = require('../../jest.config.js');
module.exports = {
  ...base,
  rootDir: path.resolve(__dirname, '../..'),
  roots: ['<rootDir>/tests/offline'],
  testMatch: ['**/structure-outline-corrected-result-regression.test.ts'],
  collectCoverage: false,
};
