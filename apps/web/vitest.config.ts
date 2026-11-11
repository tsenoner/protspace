import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Vitest blanks CSS it does not process, `?raw` imports included: theme-boot.test.ts reads
    // core's tokens.css as text.
    css: { include: [/tokens\.css/] },
  },
});
