#!/usr/bin/env tsx
/**
 * `pnpm docs:videos [--keep] [name…]`: encodes the recordings `pnpm docs:animations` left in
 * temp-videos/ (`<stem>.webm` with its `<stem>.json` sidecar, one per entry and theme: `zoom`,
 * `zoom-dark`) into the docs' looping videos: docs/explore/images/<stem>.webm (VP9), <stem>.mp4
 * (H.264, for browsers without VP9) and <stem>.jpg (the poster, the scene's first frame).
 *
 * Each recording is cut where its scene starts (the sidecar's measured `trimStartMs`), stripped
 * of audio and encoded at a fixed quality. A WebM or MP4 over the entry's budget fails the run:
 * its recording is kept and the files already in the docs are left as they were. An encoded
 * recording is deleted unless `--keep` is given. With names, only those encode: an entry's name
 * encodes both themes, a `-dark` stem only the dark one.
 *
 * Needs ffmpeg on PATH with libvpx-vp9 and libx264 (`brew install ffmpeg`).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VIDEO_FILES, type VideoSidecar } from './capture-plan';
import { IMAGES_DIR, TEMP_VIDEOS_DIR } from './paths';

/**
 * The encoders' settings. Screen recordings are mostly flat colour and still between actions, so
 * constant-quality encoding keeps text sharp at a few hundred kilobytes; `yuv420p` is what every
 * browser decodes, `+faststart` lets the MP4 start before it has fully downloaded.
 */
const ENCODINGS: Record<(typeof VIDEO_FILES)[number], string[]> = {
  webm: [
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '0',
    '-crf',
    '40',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-an',
  ],
  mp4: [
    '-c:v',
    'libx264',
    '-crf',
    '28',
    '-preset',
    'slow',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
  ],
  jpg: ['-frames:v', '1', '-q:v', '3'],
};

function ffmpeg(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.toString().trim();
    throw new Error(`ffmpeg failed: ${reason}`);
  }
}

function hasEncoders(): boolean {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return (
    !result.error &&
    result.status === 0 &&
    result.stdout.includes('libvpx-vp9') &&
    result.stdout.includes('libx264')
  );
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/** Encodes one recording; returns why it failed, or null once its files are in the docs. */
function encodeRecording(stem: string, keep: boolean): string | null {
  const recording = path.join(TEMP_VIDEOS_DIR, `${stem}.webm`);
  const sidecarFile = path.join(TEMP_VIDEOS_DIR, `${stem}.json`);
  if (!fs.existsSync(recording) || !fs.existsSync(sidecarFile)) {
    return `${stem}: no recording; run \`pnpm docs:animations -g "${stem}.webm"\``;
  }
  const sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')) as VideoSidecar;
  const trim = `trim=start=${(sidecar.trimStartMs / 1000).toFixed(3)},setpts=PTS-STARTPTS`;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-video-'));
  console.log(`${stem} (budget ${megabytes(sidecar.budgetBytes)} per encoding)`);
  try {
    const encoded = VIDEO_FILES.map((extension) => {
      const out = path.join(scratch, `out.${extension}`);
      ffmpeg(['-i', recording, '-vf', trim, ...ENCODINGS[extension], out]);
      const bytes = fs.statSync(out).size;
      const over = extension !== 'jpg' && bytes > sidecar.budgetBytes;
      console.log(`  ${extension}: ${megabytes(bytes)}${over ? ' (over)' : ''}`);
      return { extension, out, over };
    });
    if (encoded.some(({ over }) => over)) {
      return `${stem}: over its ${megabytes(sidecar.budgetBytes)} budget; shorten the scene or raise its budgetBytes`;
    }
    for (const { extension, out } of encoded) {
      const target = path.join(IMAGES_DIR, `${stem}.${extension}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(out, target);
    }
    if (!keep) {
      fs.rmSync(recording);
      fs.rmSync(sidecarFile);
    }
    return null;
  } catch (error) {
    return `${stem}: ${(error as Error).message}`;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const named = args.filter((arg) => !arg.startsWith('--'));
  if (!hasEncoders()) {
    console.error('ffmpeg with libvpx-vp9 and libx264 is not on PATH: `brew install ffmpeg`.');
    return 1;
  }
  const recorded = fs.existsSync(TEMP_VIDEOS_DIR)
    ? fs
        .readdirSync(TEMP_VIDEOS_DIR, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.webm'))
        .map((file) => file.slice(0, -'.webm'.length).split(path.sep).join('/'))
    : [];
  const stems =
    named.length > 0
      ? recorded.filter((stem) => named.some((name) => stem === name || stem === `${name}-dark`))
      : recorded;
  const missing = named.filter(
    (name) => !stems.some((stem) => stem === name || stem === `${name}-dark`),
  );
  if (missing.length > 0) {
    console.error(
      `No recording for ${missing.join(', ')}: run \`pnpm docs:animations -g "<name>"\` first.`,
    );
    return 1;
  }
  if (stems.length === 0) {
    console.log('No recordings in temp-videos/: run `pnpm docs:animations` first.');
    return 0;
  }
  const failures = stems.flatMap((stem) => encodeRecording(stem, keep) ?? []);
  if (failures.length > 0) {
    console.error(`\n${failures.length} video(s) not written:\n${failures.join('\n')}`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
