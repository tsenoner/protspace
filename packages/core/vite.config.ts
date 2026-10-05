import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    // Declarations mirror src/ under dist/ (tsconfig `rootDir`), which is where package.json's
    // `types` conditions point; if the two drift apart, apps/web's `noImplicitAny` fails
    // `pnpm type-check` with TS7016. No per-entry stubs (dist/core.d.ts, dist/publish.d.ts):
    // nothing references them. Test-only helpers stay out too (one imports vitest); only tests
    // import them, and tsc still type-checks them.
    dts({
      tsconfigPath: './tsconfig.json',
      insertTypesEntry: false,
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts', 'src/**/test-support/**', 'src/**/*.test-support.ts'],
      rollupTypes: false,
      copyDtsFiles: true,
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    lib: {
      entry: {
        core: resolve(__dirname, 'src/index.ts'),
        publish: resolve(__dirname, 'src/components/publish/index.ts'),
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      // hyparquet is shared with @protspace/utils' bundle writer (hyparquet-writer imports its
      // modules), so it is left to the app to bundle once. The inline decode worker is built
      // separately (`worker` above) and still carries its own copy: a blob worker cannot import.
      external: ['lit', 'd3', '@protspace/utils', /^hyparquet(\/|$)/],
      output: {
        globals: {
          lit: 'Lit',
          d3: 'D3',
        },
      },
    },
  },
});
