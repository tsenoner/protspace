import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import appConfig from '../vite.config';

/**
 * The app build the e2e suite runs against (the web server in `playwright.config.ts`): the app's
 * own config, built into the gitignored `apps/web/dist-e2e/` and served by `vite preview`. Each web
 * server passes its own `--outDir dist-e2e/<port>` to both commands, so runs on different ports
 * never empty each other's build; `dist-e2e/default` is for a build by hand.
 *
 * Build it with `NODE_ENV=development` and `--mode development`, so `import.meta.env.DEV` holds
 * (the /dev/kit gallery, the example dev fallback, the defaultView drift warning) while the chunks
 * and their load order are a build's.
 */
const OUT_DIR = fileURLToPath(new URL('../dist-e2e/default/', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * Serves `/@fs/<abs path>` for files under `tests/fixtures/` only, the URL the dev server gives
 * them: the startup demo is pinned to one (`STARTUP_DATASET_URL` in helpers/fixtures.ts), and the
 * same URL then works on both servers.
 */
function serveFixtures(): Plugin {
  return {
    name: 'e2e-serve-fixtures',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
        } catch {
          return next(); // A malformed URL is not a fixture's.
        }
        if (!pathname.startsWith('/@fs/')) return next();
        const file = resolve(pathname.slice('/@fs'.length));
        if (!file.startsWith(FIXTURES_DIR)) return next();
        let size: number;
        try {
          const stat = statSync(file);
          if (!stat.isFile()) return next();
          size = stat.size;
        } catch {
          return next();
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', size);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig((env) =>
  mergeConfig(appConfig(env), {
    build: { outDir: OUT_DIR, emptyOutDir: true },
    plugins: [serveFixtures()],
  }),
);
