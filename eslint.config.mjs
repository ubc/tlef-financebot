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
  { ignores: ['**/dist/**', 'client/public/js/**', 'client/public/vendor/**', 'coverage/**', 'coverage-reports/**'] },
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
