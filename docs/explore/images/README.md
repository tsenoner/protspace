# Documentation Images

Every file in this folder is generated: one capture manifest names each screenshot and animation,
and one runner makes it, in light and in dark. Do not edit or add a file by hand;
`pnpm docs:images:check` (in `pnpm precommit`) fails on a file no manifest entry makes, and on a
file without its dark twin.

## Generating images

```bash
pnpm docs:images                                        # everything: screenshots, recordings, videos
pnpm docs:screenshots -g "legend-settings"              # one screenshot, both themes
pnpm docs:screenshots -g "legend-settings-dark"         # its dark twin only
pnpm docs:animations -g "zoom" && pnpm docs:videos zoom # one animation: record both themes, encode
pnpm docs:images:check                                  # the lint, without a browser
```

`-g` matches the test titles, which are each variant's first file (`legend-settings.png`,
`legend-settings-dark.png`, `zoom.webm`, `zoom-dark.webm`, `examples/demo.png`), so an entry's name
captures both themes and `|` captures several entries.

The captures run headless, so nothing takes focus: screenshots in the installed Google Chrome
(`channel: 'chrome'`, which still draws WebGL on the Mac's GPU), recordings in Playwright's own
headless Chromium (Chrome's headless screencast on macOS leaves out the bottom 88 px of the
viewport), started with `--use-angle=metal` so it too draws on the GPU: on its SwiftShader default
Mol\* cannot get a WebGL context beside the plot's, and the structure panel says WebGL is missing. They start their own Vite server on port 8096 (`DOCS_CAPTURE_PORT` to change it), never
reuse one, and serve the product demo as the startup dataset. With `PLAYWRIGHT_BASE_URL` set they
use that server instead; a server that pins the startup load to an E2E fixture is refused. Captures
of the other examples (the thumbnails, and the EAT page's, which open the three-finger toxins
example) need their files first:

```bash
pnpm examples:fetch
```

Structure captures load the real Mol\* and AlphaFold models, so they need network.

Number fields (the figure editor's) follow the capturing Mac's Region setting, whatever locale the
browser is given, so capture under a Region that writes a decimal point (1,234.56).

Headless Chrome draws a native `<select>`'s closed arrow differently from a headed Chrome on macOS.
The kit's `ps-select` and the figure editor's `.publish-select` draw their own, so a capture looks
the same either way; give a new native select that a capture shows its own arrow too.

### How long a full run takes

Measured on the full run of November 2026 (Apple M4 Pro, idle machine): the 82 screenshots take
3.3 minutes, the 24 recordings 3.5 minutes and the encoder about a minute, so `pnpm docs:images`
takes about 9 minutes with the Vite server's build. The largest thumbnail, Swiss-Prot, loads in
under 20 seconds per theme on the GPU.

## Adding an image or an animation

1. Add an entry to `scripts/docs-screenshots/scenes/<area>.ts`, naming the pages that show it.
2. Show it on those pages: a screenshot as a light/dark pair, an animation as a `<DocsVideo>`
   (below).
3. Run `pnpm docs:screenshots -g "<name>"` (or the animation commands above).
4. Commit the files with the page.

## Where each file comes from

`scripts/docs-screenshots/`:

- `scenes/*.ts`: the entries, one module per docs area (`controls.ts`, `legend.ts`,
  `structures.ts`, …), concatenated by `manifest.ts`; `scenes/demo.ts` holds the demo dataset's
  names the scenes share. One entry per screenshot or animation: its name, `png` or `video`,
  viewport (`desktop` 1280×720, `tablet` 800×1280, `phone` a Pixel 7 at 412×839), dataset, layout,
  setup and steps, what to crop (screenshots only), and the docs pages that show it.
- `capture-plan.ts`: the entry types, file naming, the light and dark variants and the manifest's
  own validation (pure; the app's Vitest tests it).
- `runner.ts`: one Playwright test per entry and theme. It opens Explore with the browser in that
  colour scheme and the app's theme on System, waits for the data and for the plot to settle, runs
  the entry, parks the pointer, checks no tooltip is open and takes the picture. Screenshots are
  taken at device scale 2 (example thumbnails at 1) with reduced motion; animations are recorded at
  scale 1.
- `indicators.ts`: the cursor, click and key overlays a video shows, in the page's theme.
- `video.ts`: the encoder. `check.ts` and `docs-lint.ts`: the lint.

The scenes drive the app through the same helpers as the E2E suite (`apps/web/tests/helpers/`),
which find controls by role and name and wait for signals: a dialog visible, a structure loaded,
the plot settled. A scene holds no timer and never evaluates in the page; the only pause in
capture code is `cap.hold(ms)`, which paces a recording. The few timers inside the shared helpers
(such as `dragLegendRow`'s default pause between rows, which a capture replaces with its own) are
counted by `apps/web/src/explore/docs-images.test.ts`, so a new one shows in review.

To find which pages show a file, see its entry's `docs`, or grep the docs for its name.

## File names and dark twins

A file is named after its entry, lowercase kebab-case, optionally under `examples/`; the dark
variant adds `-dark`. A screenshot is `name.png` and `name-dark.png`. An animation is three files
per theme: `name.webm` (VP9), `name.mp4` (H.264, for browsers without VP9) and `name.jpg` (the
poster, its first frame), and the same with `-dark`.

A page shows a screenshot pair as two images on consecutive lines, the light one first; the docs
site hides whichever does not match its appearance, the manual toggle included (a `<style>` rule in
`docs/.vitepress/config.mts`, keyed on VitePress's `html.dark`; a `<picture>` with
`prefers-color-scheme` would follow only the OS):

```md
![Alt text](./images/filter-panel.png){.light-only}
![Alt text](./images/filter-panel-dark.png){.dark-only}
```

As raw HTML, the dark twin also loads lazily, so light readers never fetch it; never give a paired
image an inline `display` style, which would beat that rule:

```html
<img src="./images/x.png" class="light-only" alt="…" width="1280" height="720" />
<img src="./images/x-dark.png" class="dark-only" alt="…" width="1280" height="720" loading="lazy" />
```

## Animations

A page shows an animation with the docs theme's `<DocsVideo>` (`docs/.vitepress/theme/docs-video.ts`),
on a line of its own, its width and height the recording's viewport:

```md
<DocsVideo name="zoom" alt="Zooming in on a cluster, panning, and zooming out" width="1280" height="720" />
```

It renders both themes' videos, muted, looping and inline, as `.light-only` and `.dark-only`, so
the same head rule shows the one matching the docs' mode. Neither loads with the page: a video
takes its poster as it nears the viewport and plays while it is on screen, so the hidden twin is
never fetched. Under `prefers-reduced-motion` it shows the poster with controls and never
autoplays; when the browser refuses to autoplay, the controls show too.

An animation entry is recorded as a `.webm` per theme in `temp-videos/` (git-ignored), with a JSON
sidecar holding where the scene starts (the end of the entry's setup) and the frame size.
`pnpm docs:videos [--keep] [name…]` encodes each recording (only the named ones when names are
given; a name encodes both themes) at a fixed quality: VP9 at CRF 40, H.264 at CRF 28, both
`yuv420p` without audio, and the poster as a JPEG. The WebM and the MP4 must each fit the entry's
budget, 1.25 MiB (1,310,720 bytes) unless the entry sets `budgetBytes`; one over budget fails the
run, keeps its recording and leaves the files in the docs as they were. A typical 7 s scene is
0.15-0.35 MiB as WebM, a little less as MP4, plus a 0.1 MiB poster; the busiest, duplicate-badges,
is 0.96 MiB. The 12 old GIFs took 31 MB. An encoded
recording is deleted unless `--keep` is given. `ffmpeg` with `libvpx-vp9` and `libx264` must be on
your `PATH` (`brew install ffmpeg`).

## The lint

`pnpm docs:images:check` runs in `pnpm precommit` and reads only files. It fails when:

- a manifest output is missing, or a file here has no manifest entry;
- a file has no dark twin, or a `-dark` file no light twin;
- a video is over its budget, or a `<DocsVideo>` lacks its name, alt text or size, or states a
  size other than the recording's;
- a page shows a file that does not exist, a file is shown by no page, or a page an entry names
  does not show it;
- a pair is not written as above, a page shows a GIF, or shows a video's file as an image;
- a link's `#anchor` matches no heading on its page (VitePress checks pages, never anchors);
- the user guide names removed UI (the control bar, the Isolate button and the like).

`apps/web/src/explore/docs-images.test.ts` runs the same rules on small cases and on the real docs
in `pnpm test`.

The one image outside this pipeline is `docs/guide/images/latency-vs-proteins.png`, the performance
page's chart, made by hand from the perf measurements. It is light only by choice (a chart on a
white card reads in dark mode too), and the lint does not see it: it reads only this folder.

## The example thumbnails

`examples/<id>.png` and `examples/<id>-dark.png` are the [Example Datasets](../example-datasets.md)
page's thumbnails, one entry per catalog example, from `scenes/examples.ts`: 1280×720 at scale 1,
each example opened from the files the product serves.

```bash
pnpm examples:fetch
pnpm docs:screenshots -g "examples/"
```

`pnpm docs:examples:check` fails when a card's thumbnail or its dark twin is missing. The opt-in
`examples-live` E2E project still opens every example and checks its curated view, but writes no
image.
