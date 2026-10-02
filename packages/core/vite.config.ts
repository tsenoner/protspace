import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.json',
      insertTypesEntry: true,
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts'],
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
