import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: {
      // The contract suite runs from the repo root, which carries no @protspace/*
      // node_modules links. Aliasing to source also drops any dependency on a
      // prior `pnpm build` — the suite tests the reader as written, not as built.
      '@protspace/utils': resolve(repoRoot, 'packages/utils/src/index.ts'),
    },
  },
  test: {
    root: repoRoot,
    include: ['tests/contract/**/*.contract.test.ts'],
    // The generator does a cold `uv run` (resolving the Python workspace on a
    // clean CI runner) plus four `protspace bundle` subprocesses.
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
});
