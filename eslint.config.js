import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.tsx', 'apps/web/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Specs take `test` from the fixture, which sends each test's seed with the rooms it opens.
    files: ['e2e/**/*.ts'],
    ignores: ['e2e/fixtures.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['test'],
              message: "Import `test` from './fixtures.ts', which seeds each test's rooms.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Hand-rolled escapes miss characters (CodeQL blocks them as incomplete
    // escaping), so there is one shared helper.
    ignores: ['packages/game-sdk/src/regex.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^replace(All)?$/][arguments.0.regex]:matches([arguments.1.value='\\\\$&'], [arguments.1.quasis.0.value.cooked='\\\\$&'])",
          message:
            "Don't escape for RegExp by hand: use escapeRegExp from '@vt/game-sdk' (or RegExp.escape in Node scripts).",
        },
      ],
    },
  },
);
