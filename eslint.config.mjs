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
      'scripts/**/*.ts',
      'apps/web/tests/**/*.ts',
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
      // page.waitForFunction(fn, arg, options). Passing the options object as
      // the second argument puts it in the `arg` slot, where it is serialized
      // into the page and every timeout/polling value is silently ignored —
      // and it type-checks, because `arg` is typed `any`.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='waitForFunction'][arguments.length=2] > ObjectExpression.arguments:has(Property[key.name=/^(timeout|polling)$/])",
          message:
            'waitForFunction(fn, options) passes options as the page-function arg. Use waitForFunction(fn, undefined, { timeout }).',
        },
      ],
    },
  },
  {
    // The docs-screenshot pipeline is tooling, not shipped code: it drives a
    // browser through component internals that carry no public types, and it
    // reports progress on stdout. Everything else it inherits from the block
    // above; unused locals and parameters are caught by tsc via
    // scripts/tsconfig.json.
    files: ['scripts/**/*.ts', 'apps/web/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  prettier,
];
