#!/usr/bin/env node
// Timing mode of the perf checks: headed Chromium on the real GPU. See perf/README.md.
//
//   pnpm perf [--datasets default,40K,/abs/x.parquetbundle] [--scenarios annotation,camera]
//             [--runs 5] [--cpu 4] [--url http://localhost:8301] [--compare http://localhost:8302]
//             [--save-baseline] [--baseline [file]] [--trace] [--no-build]
//
// Translates the flags into PERF_* variables and runs the `perf-timing` Playwright project.
// Without --url it builds the app and serves it with `vite preview` on 8301, and stops
// that server when the run ends or is interrupted.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps/web');
const PREVIEW_PORT = 8301;
const SCENARIOS = [
  'annotation-switch',
  'projection-switch',
  'projection-switch-instant',
  'legend-isolate',
  'camera',
  'resize',
  'search-select',
];

function usage(message) {
  if (message) console.error(`perf: ${message}\n`);
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const opts = {
    datasets: ['default'],
    scenarios: [],
    runs: 5,
    cpu: 1,
    url: '',
    compare: '',
    saveBaseline: false,
    baseline: '',
    trace: false,
    build: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage(`${flag} needs a value`);
      return v;
    };
    const list = () => value().split(',').filter(Boolean);
    switch (flag) {
      case '--datasets':
        opts.datasets = list();
        break;
      case '--scenarios':
        opts.scenarios = list();
        break;
      case '--runs':
        opts.runs = Number(value());
        break;
      case '--cpu':
        opts.cpu = Number(value());
        break;
      case '--url':
        opts.url = value();
        break;
      case '--compare':
        opts.compare = value();
        break;
      case '--save-baseline':
        opts.saveBaseline = true;
        break;
      case '--baseline':
        opts.baseline =
          argv[i + 1] && !argv[i + 1].startsWith('--') ? path.resolve(argv[++i]) : 'default';
        break;
      case '--trace':
        opts.trace = true;
        break;
      case '--no-build':
        opts.build = false;
        break;
      case '-h':
      case '--help':
        usage();
        break;
      default:
        usage(`unknown flag ${flag}`);
    }
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 2) usage('--runs must be 2 or more');
  if (!(opts.cpu >= 1)) usage('--cpu must be 1 or more');
  // `annotation` is short for `annotation-switch`, and so on; `projection` also runs
  // `projection-switch-instant`, the glide's reference.
  opts.scenarios = opts.scenarios.flatMap((s) => {
    const matches = SCENARIOS.filter((name) => name === s || name.startsWith(`${s}-`));
    if (!matches.length) usage(`unknown scenario ${s}; one of ${SCENARIOS.join(', ')}`);
    return matches;
  });
  return opts;
}

function resolveDataset(spec) {
  if (spec === 'default') {
    return { name: 'default', file: path.join(APP, 'public/data.parquetbundle') };
  }
  const file =
    spec.includes('/') || spec.endsWith('.parquetbundle')
      ? path.resolve(spec)
      : path.join(APP, 'public/data', `${spec}.parquetbundle`);
  if (!fs.existsSync(file)) {
    const known = fs
      .readdirSync(path.join(APP, 'public/data'))
      .filter((f) => f.endsWith('.parquetbundle'))
      .map((f) => f.replace(/\.parquetbundle$/, ''));
    usage(`no dataset ${spec} (${file}); known: default, ${known.join(', ')}`);
  }
  return { name: path.basename(file).replace(/\.parquetbundle$/, ''), file };
}

const children = new Set();

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...options });
    children.add(child);
    child.on('exit', (code, signal) => {
      children.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function stopChildren() {
  for (const child of children) child.kill('SIGTERM');
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const datasets = opts.datasets.map(resolveDataset);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopChildren();
      process.exit(130);
    });
  }

  let url = opts.url;
  try {
    if (!url) {
      if (opts.build) {
        const code = await run('pnpm', ['turbo', 'run', 'build', '--filter=@protspace/app'], {
          cwd: ROOT,
        });
        if (code !== 0) throw new Error(`build failed (${code})`);
      }
      url = `http://localhost:${PREVIEW_PORT}`;
      // Something already answering on the port would be measured instead of this build.
      const taken = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
        () => true,
        () => false,
      );
      if (taken) throw new Error(`port ${PREVIEW_PORT} is in use; stop it or pass --url`);
      const preview = spawn(
        path.join(APP, 'node_modules/.bin/vite'),
        ['preview', '--port', String(PREVIEW_PORT), '--strictPort'],
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
    }

    const env = {
      ...process.env,
      PERF_TIMING: '1',
      PLAYWRIGHT_BASE_URL: url,
      PERF_URLS: [url, opts.compare].filter(Boolean).join(','),
      PERF_DATASETS: JSON.stringify(datasets),
      PERF_SCENARIOS: opts.scenarios.join(','),
      PERF_RUNS: String(opts.runs),
      PERF_CPU: String(opts.cpu),
      PERF_TRACE: opts.trace ? '1' : '',
      PERF_SAVE_BASELINE: opts.saveBaseline ? '1' : '',
      PERF_BASELINE: opts.baseline,
      PERF_STAMP: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
    };
    const code = await run(
      path.join(ROOT, 'node_modules/.bin/playwright'),
      [
        'test',
        '-c',
        'apps/web/tests/playwright.config.ts',
        '--project=perf-timing',
        '--workers=1',
        '--reporter=list',
      ],
      { cwd: ROOT, env },
    );
    process.exitCode = code;
  } finally {
    stopChildren();
  }
}

main().catch((error) => {
  console.error(`perf: ${error.message}`);
  stopChildren();
  process.exit(1);
});
