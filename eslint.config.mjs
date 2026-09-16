import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';

// page.waitForFunction(fn, arg, options). Passing the options object as the
// second argument puts it in the `arg` slot, where it is serialized into the page
// and every timeout/polling value is silently ignored — and it type-checks,
// because `arg` is typed `any`.
const waitForFunctionOptionsInArgSlot = {
  selector:
    "CallExpression[callee.property.name='waitForFunction'][arguments.length=2] > ObjectExpression.arguments:has(Property[key.name=/^(timeout|polling)$/])",
  message:
    'waitForFunction(fn, options) passes options as the page-function arg. Use waitForFunction(fn, undefined, { timeout }).',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.d.ts',
      '**/.turbo/**',
      '**/.venv/**',
      '**/.vitepress/cache/**',
    ],
  },
  {
    files: [
      'packages/**/*.{ts,tsx}',
      'apps/web/src/**/*.{ts,tsx}',
      'examples/**/*.{ts,tsx}',
      'docs/**/*.{ts,tsx,mts}',
      'scripts/**/*.ts',
      'apps/web/tests/**/*.ts',
      'perf/**/*.ts',
      'tests/**/*.ts',
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
      'no-restricted-syntax': ['error', waitForFunctionOptionsInArgSlot],
    },
  },
  {
    // A component's stylesheet lives in a *.styles.ts module or a styles/ folder,
    // where packages/core/src/styles/styles-integrity.test.ts finds it by glob. A
    // css`` literal inlined in a component escapes that test, and an illegal
    // escape in it would unstyle the component without failing anything. A later
    // block's no-restricted-syntax replaces the one above, so it is repeated.
    files: ['packages/core/src/**/*.ts'],
    ignores: ['**/*.styles.ts', '**/styles/**', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        waitForFunctionOptionsInArgSlot,
        {
          selector: "TaggedTemplateExpression[tag.name='css']",
          message:
            'Move this stylesheet into a *.styles.ts module so styles-integrity.test.ts covers it.',
        },
      ],
    },
  },
  {
    // Tooling, not shipped code: the docs-screenshot pipeline, the Playwright e2e
    // and perf suites, the bundle contract tests and the docs build scripts. They
    // drive a browser through component internals that carry no public types, and
    // report progress on stdout. Everything else they inherit from the block
    // above. Unused locals and parameters fail only in scripts/, through tsc via
    // scripts/tsconfig.json; elsewhere they are warnings.
    files: [
      'scripts/**/*.ts',
      'apps/web/tests/**/*.ts',
      'perf/**/*.ts',
      'tests/**/*.ts',
      'docs/**/*.{ts,mts}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  prettier,
];
