#!/usr/bin/env tsx
/**
 * `pnpm docs:gifs [--keep] [name…]`: converts the GIF captures `pnpm docs:animations` recorded in
 * temp-videos/ (`<name>.webm` with its `<name>.json` sidecar) into docs/explore/images/<name>.gif.
 *
 * Each video is cut where its scene starts (the sidecar's measured `trimStartMs`) and converted
 * with ffmpeg's two-pass palette, first at the entry's starting fps and width, then down the
 * ladder (`gifLadder`) until the file fits the entry's budget. A GIF still over budget at the last
 * rung fails the run: its recording is kept and the GIF already in the docs is left as it was.
 * A converted recording is deleted unless `--keep` is given. With names, only those convert.
 *
 * Needs ffmpeg on PATH (`brew install ffmpeg`).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { gifLadder, type GifSettings, type GifSidecar } from './capture-plan';
import { IMAGES_DIR, TEMP_VIDEOS_DIR } from './paths';

function ffmpeg(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.toString().trim();
    throw new Error(`ffmpeg failed: ${reason}`);
  }
}

function hasFfmpeg(): boolean {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

/** Converts at one rung, two-pass (palette, then the GIF); returns the GIF's size in bytes. */
function convert(video: string, out: string, trimStartMs: number, rung: GifSettings): number {
  const palette = `${out}.palette.png`;
  const frames =
    `trim=start=${(trimStartMs / 1000).toFixed(3)},setpts=PTS-STARTPTS,` +
    `fps=${rung.fps},scale=${rung.width}:-1:flags=lanczos`;
  try {
    ffmpeg(['-i', video, '-vf', `${frames},palettegen=stats_mode=diff`, palette]);
    ffmpeg([
      '-i',
      video,
      '-i',
      palette,
      '-lavfi',
      `[0:v]${frames}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-loop',
      '0',
      out,
    ]);
  } finally {
    fs.rmSync(palette, { force: true });
  }
  return fs.statSync(out).size;
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/**
 * Converts one recording; returns why it failed, or null once its GIF is in the docs within
 * budget.
 */
function convertRecording(name: string, keep: boolean): string | null {
  const video = path.join(TEMP_VIDEOS_DIR, `${name}.webm`);
  const sidecarFile = path.join(TEMP_VIDEOS_DIR, `${name}.json`);
  if (!fs.existsSync(video) || !fs.existsSync(sidecarFile)) {
    return `${name}: no recording; run \`pnpm docs:animations -g "${name}.gif"\``;
  }
  const sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')) as GifSidecar;
  const scratch = path.join(TEMP_VIDEOS_DIR, `${name}.gif`);
  const out = path.join(IMAGES_DIR, `${name}.gif`);
  console.log(`${name} (budget ${megabytes(sidecar.budgetBytes)})`);
  try {
    for (const rung of gifLadder(sidecar.start)) {
      const bytes = convert(video, scratch, sidecar.trimStartMs, rung);
      const fits = bytes <= sidecar.budgetBytes;
      console.log(
        `  ${rung.fps} fps, ${rung.width} px: ${megabytes(bytes)}${fits ? '' : ' (over)'}`,
      );
      if (!fits) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(scratch, out);
      if (!keep) {
        fs.rmSync(video);
        fs.rmSync(sidecarFile);
      }
      return null;
    }
    return `${name}: over its ${megabytes(sidecar.budgetBytes)} budget at the last rung; shorten the scene or raise its budgetBytes`;
  } catch (error) {
    return `${name}: ${(error as Error).message}`;
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const named = args.filter((arg) => !arg.startsWith('--'));
  if (!hasFfmpeg()) {
    console.error('ffmpeg is not on PATH: install it (`brew install ffmpeg`).');
    return 1;
  }
  const recorded = fs.existsSync(TEMP_VIDEOS_DIR)
    ? fs
        .readdirSync(TEMP_VIDEOS_DIR)
        .filter((file) => file.endsWith('.webm'))
        .map((file) => file.slice(0, -'.webm'.length))
    : [];
  const names = named.length > 0 ? named : recorded;
  if (names.length === 0) {
    console.log('No recordings in temp-videos/: run `pnpm docs:animations` first.');
    return 0;
  }
  const failures = names.flatMap((name) => convertRecording(name, keep) ?? []);
  if (failures.length > 0) {
    console.error(`\n${failures.length} GIF(s) not written:\n${failures.join('\n')}`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
