import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { componentTagger } from 'lovable-tagger';
import { THEME_BOOT_SCRIPT } from '../../config/theme';
import { PORTS } from '../../config/urls';

/**
 * Sets <html data-theme> before first paint (design decision 16): config/theme.ts's boot script,
 * which the docs run in their head too, inlined at the end of index.html's <head>, so after the
 * GitHub Pages redirect script.
 */
function themeBoot(): Plugin {
  return {
    name: 'protspace-theme-boot',
    transformIndexHtml: () => [
      {
        tag: 'script',
        attrs: { 'data-theme-boot': true },
        children: THEME_BOOT_SCRIPT,
        injectTo: 'head',
      },
    ],
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Set base path for custom domain deployment
  base: '/',
  server: {
    host: '::',
    port: PORTS.app,
    proxy: {
      '/docs': {
        target: `http://localhost:${PORTS.docs}`,
        changeOrigin: true,
      },
      '/api': {
        target: `http://localhost:${PORTS.prep}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), themeBoot(), mode === 'development' && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));
