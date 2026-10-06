#!/usr/bin/env node
// Scaling benchmark: how the Explore page behaves as N grows. See perf/README.md.
//
//   pnpm perf:scale --datasets 573K=/abs/a.parquetbundle,5M=/abs/b.parquetbundle
//                   [--cold 10] [--reps 20] [--rounds 1] [--browser chrome|chromium|firefox|webkit]
//                   [--url http://localhost:8520] [--port 8520] [--no-build]
//                   [--out perf/results/scale-<stamp>] [--guard-gb 3] [--timeout-min <auto>]
//
// One browser run per dataset and round (the `perf-scale` Playwright project); rounds
// interleave the datasets. Around each run it logs `pmset -g therm`, samples the memory of
// the browser's renderer and GPU processes (macOS `footprint`, which counts Metal and
// IOSurface memory, every second; RSS every 100 ms), and polls free memory every 200 ms:
// below --guard-gb of free plus inactive memory it kills the browser (status `oom-guard`).
// --timeout-min caps each run; by default 60 min plus 1 min per 10 MB of bundle.
// Writes one JSON per run, then aggregate.json and aggregate.csv (median, IQR and sample
// count per metric, over the runs with status `ok`).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps/web');
const exec = promisify(execFile);
const CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/opt/google/chrome/chrome',
};

function usage(message) {
  if (message) console.error(`perf:scale: ${message}\n`);
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const opts = {
    datasets: [],
    cold: 10,
    reps: 20,
    rounds: 1,
    browser: 'chrome',
    url: '',
    port: 8520,
    build: true,
    out: path.join(ROOT, 'perf/results', `scale-${stamp}`),
    guardGB: 3,
    timeoutMin: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--datasets':
        opts.datasets = value().split(',').filter(Boolean).map(resolveDataset);
        break;
      case '--cold':
      case '--reps':
      case '--rounds':
      case '--port':
        opts[flag.slice(2)] = Number(value());
        break;
      case '--guard-gb':
        opts.guardGB = Number(value());
        break;
      case '--timeout-min':
        opts.timeoutMin = Number(value());
        break;
      case '--browser':
        opts.browser = value();
        break;
      case '--url':
        opts.url = value();
        break;
      case '--out':
        opts.out = path.resolve(value());
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
  if (!opts.datasets.length) usage('--datasets is required');
  if (!['chrome', 'chromium', 'firefox', 'webkit'].includes(opts.browser)) {
    usage(`unknown browser ${opts.browser}`);
  }
  for (const key of ['cold', 'reps', 'rounds', 'port']) {
    if (!Number.isInteger(opts[key]) || opts[key] < (key === 'reps' ? 0 : 1)) {
      usage(`--${key} must be a positive integer (--reps 0: loads only)`);
    }
  }
  if (!(opts.guardGB >= 0) || !(opts.timeoutMin === null || opts.timeoutMin > 0)) {
    usage('bad --guard-gb or --timeout-min');
  }
  if ([8080, 8091].includes(opts.port)) usage(`port ${opts.port} is reserved`);
  if (opts.browser === 'chrome' && !fs.existsSync(CHROME_PATHS[process.platform] ?? '')) {
    console.warn('perf:scale: Chrome stable not found, using the bundled Chromium');
    opts.browser = 'chromium';
  }
  return opts;
}

/** `name=path`, a path, or a name in apps/web/public/data/. */
function resolveDataset(spec) {
  const eq = spec.indexOf('=');
  const named = eq > 0 ? spec.slice(eq + 1) : spec;
  const file =
    named.includes('/') || named.endsWith('.parquetbundle')
      ? path.resolve(named)
      : path.join(APP, 'public/data', `${named}.parquetbundle`);
  if (!fs.existsSync(file)) usage(`no dataset file ${file}`);
  const name = eq > 0 ? spec.slice(0, eq) : path.basename(file).replace(/\.parquetbundle$/, '');
  return { name, file };
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

/** Build (unless --no-build) and serve this checkout with `vite preview`; returns its URL. */
async function serve(opts) {
  if (opts.build) {
    const code = await run('pnpm', ['turbo', 'run', 'build', '--filter=@protspace/app'], {
      cwd: ROOT,
    });
    if (code !== 0) throw new Error(`build failed (${code})`);
  }
  const url = `http://localhost:${opts.port}`;
  const taken = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
    () => true,
    () => false,
  );
  if (taken) throw new Error(`port ${opts.port} is in use; stop it or pass --url`);
  const preview = spawn(
    path.join(APP, 'node_modules/.bin/vite'),
    ['preview', '--port', String(opts.port), '--strictPort'],
    { cwd: APP, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  children.add(preview);
  preview.on('exit', () => children.delete(preview));
  await waitForServer(url, 30_000);
  return url;
}

/** Every process as { pid, ppid, rss (bytes), args }. */
async function processTable() {
  const { stdout } = await exec('ps', ['-A', '-o', 'pid=,ppid=,rss=,args='], {
    maxBuffer: 64 * 2 ** 20,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, rss, args]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      rss: Number(rss) * 1024,
      args,
    }));
}

/** The descendants of `root`, each classed as renderer, gpu, browser (the main one) or other. */
function browserProcesses(table, root) {
  const kids = new Map();
  for (const p of table) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)).push(p);
  const out = [];
  const walk = (pid) => {
    for (const p of kids.get(pid) ?? []) {
      out.push(p);
      walk(p.pid);
    }
  };
  walk(root);
  const isNode = (p) => /(^|\/)node(\s|$)/.test(p.args.split(' --')[0]);
  return out
    .filter((p) => !isNode(p))
    .map((p) => {
      const type = p.args.match(/--type=([\w-]+)/)?.[1];
      const parentIsNode = out.find((q) => q.pid === p.ppid && isNode(q)) || p.ppid === root;
      const kind =
        type === 'renderer'
          ? 'renderer'
          : type === 'gpu-process'
            ? 'gpu'
            : !type && parentIsNode
              ? 'browser'
              : 'other';
      return { ...p, kind };
    });
}

const UNITS = { B: 1, KB: 2 ** 10, MB: 2 ** 20, GB: 2 ** 30 };

/** pid → physical footprint in bytes (macOS `footprint`, which counts GPU memory). */
async function footprints(pids) {
  const { stdout } = await exec(
    'footprint',
    pids.flatMap((pid) => ['-p', String(pid)]),
    {
      maxBuffer: 64 * 2 ** 20,
    },
  );
  const out = new Map();
  for (const [, pid, value, unit] of stdout.matchAll(
    /\[(\d+)\]:.*?Footprint: ([\d.]+) (B|KB|MB|GB)/g,
  )) {
    out.set(Number(pid), Number(value) * UNITS[unit]);
  }
  return out;
}

/** Free plus inactive memory, in bytes, from vm_stat. */
async function availableBytes() {
  const { stdout } = await exec('vm_stat');
  const page = Number(stdout.match(/page size of (\d+)/)?.[1] ?? 4096);
  const pages = (name) => Number(stdout.match(new RegExp(`${name}:\\s+(\\d+)`))?.[1] ?? 0);
  return (pages('Pages free') + pages('Pages inactive')) * page;
}

async function thermal() {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await exec('pmset', ['-g', 'therm']);
    return stdout.trim();
  } catch (error) {
    return `pmset failed: ${error.message}`;
  }
}

function killTree(table, root) {
  for (const p of browserProcesses(table, root)) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** One browser run of one dataset, with the memory sampler, the guard and the time limit. */
async function runDataset(opts, url, dataset, round) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runFile = path.join(opts.out, `${stamp}-r${round}-${dataset.name}.json`);
  const specFile = `${runFile}.spec`;
  const thermalBefore = await thermal();
  const timeoutMin =
    opts.timeoutMin ?? Math.ceil(60 + fs.statSync(dataset.file).size / (10 * 2 ** 20));
  console.log(`\n== ${dataset.name} (round ${round + 1}/${opts.rounds}) ${thermalBefore ?? ''}`);

  const child = spawn(
    path.join(ROOT, 'node_modules/.bin/playwright'),
    [
      'test',
      '-c',
      'apps/web/tests/playwright.config.ts',
      '--project=perf-scale',
      '--workers=1',
      '--reporter=list',
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        PERF_SCALE: '1',
        PERF_SCALE_BROWSER: opts.browser,
        PERF_SCALE_DATASET: JSON.stringify(dataset),
        PERF_SCALE_OUT: specFile,
        PERF_SCALE_COLD: String(opts.cold),
        PERF_SCALE_REPS: String(opts.reps),
        PERF_SCALE_TIMEOUT_MS: String(timeoutMin * 60_000),
        PLAYWRIGHT_BASE_URL: url,
      },
    },
  );
  children.add(child);

  const samples = [];
  const seen = { renderer: 0, gpu: 0, browser: 0 };
  let guard = null;
  let timedOut = false;
  let minAvailable = Infinity;
  let lastTable = [];
  let busy = false;
  const sampler = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      lastTable = await processTable();
      const procs = browserProcesses(lastTable, child.pid);
      const sum = { renderer: 0, gpu: 0, browser: 0, other: 0 };
      for (const p of procs) {
        sum[p.kind] += p.rss;
        if (p.kind in seen)
          seen[p.kind] = Math.max(seen[p.kind], procs.filter((q) => q.kind === p.kind).length);
      }
      if (procs.length) samples.push([Date.now(), sum.renderer, sum.gpu, sum.browser, sum.other]);
    } catch {
      // ps failed once; the next tick samples again
    } finally {
      busy = false;
    }
  }, 100);
  // footprint walks each process's regions; once a second is enough and keeps it cheap.
  const footprintRows = [];
  let footprintBusy = false;
  const footprintSampler =
    process.platform === 'darwin' &&
    setInterval(async () => {
      if (footprintBusy) return;
      footprintBusy = true;
      try {
        const procs = browserProcesses(lastTable, child.pid).filter((p) =>
          ['renderer', 'gpu'].includes(p.kind),
        );
        if (procs.length) {
          const t = Date.now();
          const bytes = await footprints(procs.map((p) => p.pid));
          const sum = { renderer: 0, gpu: 0 };
          for (const p of procs) sum[p.kind] += bytes.get(p.pid) ?? NaN;
          // A process that exited since the last `ps` (a closed context) spoils the row.
          if (sum.renderer > 0 && sum.gpu > 0) footprintRows.push([t, sum.renderer, sum.gpu]);
        }
      } catch {
        // a process exited mid-sample; the next tick samples again
      } finally {
        footprintBusy = false;
      }
    }, 1_000);
  const watchdog = setInterval(async () => {
    try {
      const available = await availableBytes();
      minAvailable = Math.min(minAvailable, available);
      if (available < opts.guardGB * 2 ** 30) {
        // Keeps killing while memory stays low, so a browser still starting cannot slip by.
        if (!guard) {
          guard = { at: Date.now(), availableGB: available / 2 ** 30 };
          console.error(`perf:scale: ${guard.availableGB.toFixed(2)} GB free; killing the browser`);
        }
        killTree(await processTable(), child.pid);
        child.kill('SIGTERM');
      }
    } catch {
      // vm_stat failed once
    }
  }, 200);
  // A crashed page can leave Playwright's teardown hanging: end the run 30 s after the crash.
  let crashedAt = 0;
  const crashWatch = setInterval(async () => {
    try {
      if (!JSON.parse(fs.readFileSync(specFile, 'utf8')).crashed) return;
    } catch {
      return; // not written yet, or mid-write
    }
    crashedAt ||= Date.now();
    if (Date.now() - crashedAt < 30_000) return;
    console.error(`perf:scale: ${dataset.name} page crashed; killing the browser`);
    killTree(await processTable(), child.pid);
    child.kill('SIGTERM');
  }, 5_000);
  const timer = setTimeout(async () => {
    timedOut = true;
    console.error(`perf:scale: ${dataset.name} over ${timeoutMin} min; killing the browser`);
    killTree(await processTable(), child.pid);
    child.kill('SIGTERM');
  }, timeoutMin * 60_000);
  const exitCode = await new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve(code ?? signal)),
  );
  children.delete(child);
  clearInterval(sampler);
  clearInterval(footprintSampler);
  clearInterval(watchdog);
  clearInterval(crashWatch);
  clearTimeout(timer);

  const spec = fs.existsSync(specFile) ? JSON.parse(fs.readFileSync(specFile, 'utf8')) : {};
  fs.rmSync(specFile, { force: true });
  const n = spec.n ?? 0;
  const result = {
    ...spec,
    dataset,
    round,
    url,
    exitCode,
    thermalBefore,
    thermalAfter: await thermal(),
    status: {
      result: guard
        ? 'oom-guard'
        : spec.crashed
          ? 'crash'
          : timedOut
            ? 'timeout'
            : spec.refused
              ? 'refused'
              : spec.loadFailed
                ? 'load-failed'
                : exitCode === 0
                  ? 'ok'
                  : 'error',
      // null for a build without the counters, which cannot say what it drew.
      drawnEqualsN:
        spec.hasCounters === false
          ? null
          : !spec.loadFailed &&
            !spec.refused &&
            n > 0 &&
            (spec.loads ?? []).every((l) => l.drawn === n) &&
            (spec.drawnAtEnd ?? n) === n,
      degradedEvents: (spec.degraded ?? []).length,
      failedInteractions: Object.keys(spec.interactionFailures ?? {}),
      toasts: Math.max(spec.toasts ?? 0, ...(spec.loads ?? []).map((l) => l.toasts ?? 0)),
      refused: spec.refused ?? null,
      loadFailed: spec.loadFailed ?? null,
      guard,
      minAvailableGB: Number.isFinite(minAvailable) ? minAvailable / 2 ** 30 : null,
    },
    timeoutMin,
    // Footprint where macOS has it: RSS leaves out the GPU process's Metal memory.
    memory: {
      source: footprintRows.length ? 'footprint' : 'rss',
      ...memorySummary(footprintRows.length ? footprintRows : samples, spec, n),
    },
    rssMemory: { ...memorySummary(samples, spec, n), processesSeen: seen },
    footprintSamples: { columns: ['t', 'renderer', 'gpu'], rows: footprintRows },
    memorySamples: { columns: ['t', 'renderer', 'gpu', 'browser', 'other'], rows: samples },
  };
  fs.writeFileSync(runFile, JSON.stringify(result));
  console.log(
    `== ${dataset.name}: ${result.status.result}, N ${n}, drawn==N ${result.status.drawnEqualsN}, ` +
      `peak ${result.memory.source} renderer ${mb(result.memory.peak.renderer)} MB, ` +
      `gpu ${mb(result.memory.peak.gpu)} MB` +
      ` -> ${path.relative(ROOT, runFile)}`,
  );
  return result;
}

const mb = (bytes) => (bytes == null ? '-' : Math.round(bytes / 2 ** 20));

/**
 * Peaks over the run and around each load, the value once each load settled (the first
 * sample after its `settled` mark), and bytes per point: settled minus the sample before the
 * file was chosen (the demo dataset), over N.
 */
function memorySummary(samples, { marks = [], loads = [] }, n) {
  const at = (name) => marks.find((m) => m.name === name)?.t;
  const peakOf = (rows) => ({
    renderer: Math.max(0, ...rows.map((r) => r[1])),
    gpu: Math.max(0, ...rows.map((r) => r[2])),
    rendererPlusGpu: Math.max(0, ...rows.map((r) => r[1] + r[2])),
  });
  const pick = (r) => (r ? { renderer: r[1], gpu: r[2], rendererPlusGpu: r[1] + r[2] } : null);
  const perLoad = loads.map((load, i) => {
    const chosen = at(`load${i}:chosen`);
    const settled = at(`load${i}:settled`);
    if (chosen == null || settled == null) return null;
    const before = pick(samples.filter((r) => r[0] <= chosen).at(-1));
    const after = pick(samples.find((r) => r[0] >= settled));
    const window = samples.filter((r) => r[0] >= chosen && r[0] <= settled);
    return {
      peak: peakOf(window),
      settled: after,
      bytesPerPoint:
        before && after && n
          ? {
              renderer: (after.renderer - before.renderer) / n,
              gpu: (after.gpu - before.gpu) / n,
              rendererPlusGpu: (after.rendererPlusGpu - before.rendererPlusGpu) / n,
              heap:
                load.heapAfterMB != null
                  ? ((load.heapAfterMB - load.heapBeforeMB) * 2 ** 20) / n
                  : null,
            }
          : null,
    };
  });
  const start = at('interactions:start');
  return {
    samples: samples.length,
    peak: peakOf(samples),
    peakDuringInteractions: start ? peakOf(samples.filter((r) => r[0] >= start)) : null,
    loads: perLoad,
  };
}

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
};

/** The numbers of one run, flattened to metric → samples. */
function runMetrics(run) {
  const metrics = {};
  const add = (key, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) (metrics[key] ??= []).push(value);
  };
  for (const load of run.loads ?? []) {
    for (const [k, v] of Object.entries(load)) add(`load.${k}`, v);
  }
  for (const load of run.memory?.loads ?? []) {
    if (!load) continue;
    for (const [group, values] of Object.entries(load)) {
      for (const [k, v] of Object.entries(values ?? {})) add(`memory.${group}.${k}`, v);
    }
  }
  for (const [k, v] of Object.entries(run.memory?.peak ?? {})) add(`memory.runPeak.${k}`, v);
  for (const [k, v] of Object.entries(run.rssMemory?.peak ?? {})) add(`rss.runPeak.${k}`, v);
  add('memory.heapAfterInteractionsMB', run.heapAfterInteractionsMB);
  for (const [name, reps] of Object.entries(run.interactions ?? {})) {
    for (const sample of reps) {
      for (const [k, v] of Object.entries(sample)) add(`${name}.${k}`, v);
    }
  }
  return metrics;
}

function aggregate(runs) {
  const byDataset = new Map();
  for (const run of runs) {
    const entry = byDataset.get(run.dataset.name) ?? {
      dataset: run.dataset.name,
      file: run.dataset.file,
      fileBytes: run.fileBytes,
      n: run.n,
      statuses: [],
      okRuns: 0,
      metrics: {},
    };
    entry.n ??= run.n;
    entry.statuses.push({ round: run.round, ...run.status });
    byDataset.set(run.dataset.name, entry);
    // A guarded, timed-out, crashed or failed run stopped part way; its numbers stay in its JSON.
    if (run.status.result !== 'ok') continue;
    entry.okRuns++;
    for (const [key, values] of Object.entries(runMetrics(run))) {
      (entry.metrics[key] ??= []).push(...values);
    }
  }
  return [...byDataset.values()].map((entry) => ({
    ...entry,
    metrics: Object.fromEntries(
      Object.entries(entry.metrics).map(([key, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const [q1, median, q3] = [0.25, 0.5, 0.75].map((q) => quantile(sorted, q));
        return [key, { median, q1, q3, iqr: q3 - q1, samples: sorted.length }];
      }),
    ),
  }));
}

function toCsv(datasets) {
  const lines = ['dataset,N,fileBytes,okRuns,metric,median,q1,q3,iqr,samples'];
  for (const d of datasets) {
    for (const [key, m] of Object.entries(d.metrics)) {
      const r = (v) => Number(v.toPrecision(6));
      lines.push(
        [
          d.dataset,
          d.n ?? '',
          d.fileBytes ?? '',
          d.okRuns,
          key,
          r(m.median),
          r(m.q1),
          r(m.q3),
          r(m.iqr),
          m.samples,
        ].join(','),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      for (const child of children) child.kill('SIGTERM');
      process.exit(130);
    });
  }
  fs.mkdirSync(opts.out, { recursive: true });
  const url = opts.url || (await serve(opts));
  const runs = [];
  try {
    for (let round = 0; round < opts.rounds; round++) {
      for (const dataset of opts.datasets) runs.push(await runDataset(opts, url, dataset, round));
    }
  } finally {
    for (const child of children) child.kill('SIGTERM');
  }
  const datasets = aggregate(runs);
  const meta = {
    recordedAt: new Date().toISOString(),
    host: { platform: process.platform, cpus: os.cpus()[0]?.model, memGB: os.totalmem() / 2 ** 30 },
    options: { ...opts, datasets: opts.datasets },
    url,
  };
  fs.writeFileSync(
    path.join(opts.out, 'aggregate.json'),
    JSON.stringify({ ...meta, datasets }, null, 1),
  );
  fs.writeFileSync(path.join(opts.out, 'aggregate.csv'), toCsv(datasets));
  console.log(`\nperf:scale: ${runs.length} runs -> ${path.relative(ROOT, opts.out)}/`);
  for (const d of datasets) {
    const m = (k) => (d.metrics[k] ? Math.round(d.metrics[k].median) : '-');
    console.log(
      `${d.dataset.padEnd(10)} N ${String(d.n ?? '-').padStart(9)}  load ${m('load.chosenToSettledMs')} ms` +
        `  annotation INP ${m('annotation-switch.inp')} ms  lasso ${m('lasso.upToRenderMs')} ms` +
        `  pan p95 ${m('pan-zoom.p95Frame')} ms, ${m('pan-zoom.drawsPerSec')} draws/s  ` +
        `status ${d.statuses.map((s) => s.result).join(',')}`,
    );
  }
}

main().catch((error) => {
  console.error(`perf:scale: ${error.message}`);
  for (const child of children) child.kill('SIGTERM');
  process.exit(1);
});
