import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { componentTagger } from 'lovable-tagger';
import { PORTS } from '../../config/urls';

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
  plugins: [react(), mode === 'development' && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));
