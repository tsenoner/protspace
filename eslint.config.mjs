import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.d.ts', '**/.turbo/**'],
  },
  {
    files: [
      'packages/**/*.{ts,tsx}',
      'apps/web/src/**/*.{ts,tsx}',
      'examples/**/*.{ts,tsx}',
      'docs/**/*.{ts,tsx}',
      '*.mjs',
    ],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Code quality rules (not formatting)
      '@typescript-eslint/consistent-type-imports': ['error'],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': ['error'], // Enforce strict typing
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The docs-screenshot pipeline is tooling, not shipped code: it drives a
    // browser, so it reaches into component internals that carry no public
    // types, and it reports progress on stdout. Both rules are errors/warnings
    // worth keeping in packages/ and noise here.
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': ['warn'],
      'no-console': 'off',
    },
  },
  prettier,
];
