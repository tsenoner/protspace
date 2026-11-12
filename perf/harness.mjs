// What the .mjs perf CLIs (perf.mjs, scale.mjs) share: the usage text, dataset specs,
// child processes that die with the CLI, and building and serving this checkout.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perfDatasetFile } from './datasets.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP = path.join(ROOT, 'apps/web');

/**
 * `usage(message?)` for the CLI `name` at `scriptUrl`: prints the message, then the script's
 * header comment (everything above its first import), and exits 2 (0 without a message).
 */
export function createUsage(name, scriptUrl) {
  return (message) => {
    if (message) console.error(`${name}: ${message}\n`);
    console.error(fs.readFileSync(fileURLToPath(scriptUrl), 'utf8').split('\nimport ')[0]);
    process.exit(message ? 2 : 0);
  };
}

/**
 * `{ name, file }` of a dataset spec: `default` (the app's demo bundle), a path, or a dataset id
 * of perf/datasets.manifest.json, each optionally prefixed `name=` to label it. Calls `usage`
 * when the file is missing or the id unknown.
 */
export function resolveDataset(spec, usage) {
  const eq = spec.indexOf('=');
  const named = eq > 0 ? spec.slice(eq + 1) : spec;
  let file;
  let name;
  if (named === 'default') {
    file = path.join(APP, 'public/data.parquetbundle');
    name = 'default';
  } else if (named.includes('/') || named.endsWith('.parquetbundle')) {
    file = path.resolve(named);
    if (!fs.existsSync(file)) usage(`no dataset file ${file}`);
    name = path.basename(file).replace(/\.parquetbundle$/, '');
  } else {
    const found = perfDatasetFile(named);
    if (found.error) usage(found.error);
    file = found.file;
    name = named;
  }
  return { name: eq > 0 ? spec.slice(0, eq) : name, file };
}

/** The running child processes; `stopChildren` ends them. */
export const children = new Set();

/** Runs `cmd` with inherited stdio; resolves to its exit code (1 when a signal ended it). */
export function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...options });
    children.add(child);
    child.on('exit', (code, signal) => {
      children.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

export function stopChildren() {
  for (const child of children) child.kill('SIGTERM');
}

/** On SIGINT or SIGTERM, stops the children and exits 130. */
export function stopChildrenOnSignals() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopChildren();
      process.exit(130);
    });
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const up = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

/**
 * Builds the app (unless `build` is false) and serves it with `vite preview` on `port`;
 * returns its URL. The server is one of `children`, so `stopChildren` ends it.
 */
export async function serve({ port, build = true }) {
  if (build) {
    const code = await run('pnpm', ['turbo', 'run', 'build', '--filter=@protspace/app'], {
      cwd: ROOT,
    });
    if (code !== 0) throw new Error(`build failed (${code})`);
  }
  const url = `http://localhost:${port}`;
  // Something already answering on the port would be measured instead of this build.
  const taken = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
    () => true,
    () => false,
  );
  if (taken) throw new Error(`port ${port} is in use; stop it or pass --url`);
  const preview = spawn(
    path.join(APP, 'node_modules/.bin/vite'),
    ['preview', '--port', String(port), '--strictPort'],
    { cwd: APP, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  children.add(preview);
  const exited = new Promise((_, reject) =>
    preview.on('exit', (code, signal) => {
      children.delete(preview);
      reject(new Error(`vite preview exited early (${signal ?? code})`));
    }),
  );
  exited.catch(() => {}); // only matters while racing below
  await Promise.race([waitForServer(url, 30_000), exited]);
  return url;
}
