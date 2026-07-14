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
  prettier,
];
