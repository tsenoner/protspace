import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import '@fontsource-variable/inter';
import './index.css';
import { applyTheme } from './explore/theme-state';
import { reloadOnStaleChunk } from './lib/chunk-reload';

reloadOnStaleChunk(window);
// index.html's boot script set it before first paint; the store owns it from here.
applyTheme();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
