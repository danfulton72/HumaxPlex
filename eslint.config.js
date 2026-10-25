// Lint for the web UI and tests. Mainly catches mistakes that would only show
// up on the TV: syntax errors, misspelt or undefined names, unreachable code.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['web/js/vendor/**', 'android/**', 'node_modules/**'] },
  {
    files: ['web/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, EasyPlexVideo: 'readonly' },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    // Tests match on-screen text, which uses double spaces around separators.
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off', 'no-regex-spaces': 'off' },
  },
];
