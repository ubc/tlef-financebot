import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Node.js runtime globals used by scripts and config files. Declared inline so
// the lint setup needs no extra dependency beyond eslint + typescript-eslint.
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  module: 'writable',
  require: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'client/public/js/**',
      'client/public/vendor/**',
      'coverage/**',
      'coverage-reports/**',
      'playwright-report*/**',
      'test-results/**',
      'artifacts/**', // Archived prototypes, screenshots and local acceptance reports.
      '.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Node scripts (ESM .mjs) and CommonJS config files need Node globals.
  {
    files: ['**/*.mjs', 'scripts/**/*.js', '*.config.js', '*.config.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    files: ['**/*.config.js', 'jest.*.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: nodeGlobals },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Design verification scripts run in Node and pass callbacks into a browser
  // page, so both sets of globals are intentional in the same CommonJS file.
  {
    files: ['docs/design/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...nodeGlobals,
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        innerWidth: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Standalone HTML prototypes execute in the browser, like the compiled client.
  {
    files: ['docs/design/assessment-workspace/*.js', 'docs/design/canvas-integration/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly', window: 'readonly', localStorage: 'readonly',
        sessionStorage: 'readonly', navigator: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        URL: 'readonly', Blob: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
      },
    },
  },
  // Local acceptance scripts use Node with callbacks evaluated by Playwright.
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...nodeGlobals, document: 'readonly', window: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly',
        innerWidth: 'readonly', getComputedStyle: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Ambient declaration files legitimately declaration-merge empty interfaces.
  {
    files: ['**/*.d.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
  // Tests re-require modules with a fresh registry (jest.resetModules), which
  // needs runtime require() and import() type annotations.
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
