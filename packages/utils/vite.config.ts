import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dts from 'vite-plugin-dts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts'],
      rollupTypes: false, // Faster, don't bundle all types
      copyDtsFiles: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ProtspaceUtils',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'esm.js' : 'js'}`,
    },
    rollupOptions: {
      // hyparquet-writer (and the hyparquet modules it deep-imports) stay bare imports, as
      // hyparquet does in @protspace/core, so the app bundles one copy of hyparquet for both
      // the bundle reader and the bundle writer instead of one inlined into each package.
      external: ['lit', 'd3', 'html2canvas-pro', 'jspdf', /^hyparquet(-writer)?(\/|$)/],
      output: {
        globals: {
          lit: 'Lit',
          d3: 'D3',
          'html2canvas-pro': 'html2canvas',
          jspdf: 'jspdf',
        },
      },
    },
  },
});
