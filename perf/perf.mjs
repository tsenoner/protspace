#!/usr/bin/env node
// Timing mode of the perf checks: headed Chromium on the real GPU. See perf/README.md.
//
//   pnpm perf [--datasets default,40K,/abs/x.parquetbundle] [--scenarios annotation,camera]
//             [--runs 5] [--cpu 4] [--url http://localhost:8301] [--compare http://localhost:8302]
//             [--save-baseline] [--baseline [file]] [--trace] [--no-build]
//
// Translates the flags into PERF_* variables and runs the `perf-timing` Playwright project,
// which resolves --scenarios against the segments in apps/web/tests/helpers/perf/scenarios.ts.
// Without --url it builds the app and serves it with `vite preview` on 8301, and stops
// that server when the run ends or is interrupted.
import path from 'node:path';
import {
  ROOT,
  createUsage,
  resolveDataset,
  run,
  serve,
  stopChildren,
  stopChildrenOnSignals,
} from './harness.mjs';

const PREVIEW_PORT = 8301;
const usage = createUsage('perf', import.meta.url);

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
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const datasets = opts.datasets.map((spec) => resolveDataset(spec, usage));
  stopChildrenOnSignals();

  let url = opts.url;
  try {
    if (!url) url = await serve({ port: PREVIEW_PORT, build: opts.build });

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
