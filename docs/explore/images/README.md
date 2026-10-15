# Documentation Images

Every image in this folder is generated: one capture manifest names each file, and one runner makes
it. Do not edit or add an image by hand; `pnpm docs:images:check` (in `pnpm precommit`) fails on a
file no manifest entry makes.

## Generating images

```bash
pnpm docs:images                                          # everything: screenshots, then animations, then GIFs
pnpm docs:screenshots -g "legend-settings"                # the PNGs whose file name matches
pnpm docs:animations -g "zoom.gif" && pnpm docs:gifs zoom # one GIF: record the video, then convert it
pnpm docs:images:check                                    # the lint, without a browser
```

`-g` matches the test titles, which are the file names (`legend-settings.png`,
`legend-settings-dark.png`, `zoom.gif`, `examples/demo.png`), so a part of a name captures both
variants and `|` captures several images.

The captures start their own Vite server on port 8096 (`DOCS_CAPTURE_PORT` to change it), never
reuse one, and serve the product demo as the startup dataset. With `PLAYWRIGHT_BASE_URL` set they
use that server instead; a server that pins the startup load to an E2E fixture is refused. They run
a headed Chromium on macOS, for GPU WebGL. Captures of the other examples (the thumbnails, and the
EAT page's, which open the three-finger toxins example) need their files first:

```bash
pnpm examples:fetch
```

Structure captures load the real Mol\* and AlphaFold models, so they need network.

Number fields (the figure editor's) follow the capturing Mac's Region setting, whatever locale the
browser is given, so capture under a Region that writes a decimal point (1,234.56).

## Adding an image

1. Add an entry to `scripts/docs-screenshots/scenes/<area>.ts`, naming the pages that show it.
2. Show the file on those pages, as a light/dark pair if the entry has both themes.
3. Run `pnpm docs:screenshots -g "<name>"` (or the GIF commands above).
4. Commit the image with the page.

## Where each image comes from

`scripts/docs-screenshots/`:

- `scenes/*.ts`: the entries, one module per docs area (`controls.ts`, `legend.ts`,
  `structures.ts`, …), concatenated by `manifest.ts`; `scenes/demo.ts` holds the demo dataset's
  names the scenes share. One entry per image: its name, PNG or GIF, viewport (`desktop` 1280×720,
  `tablet` 800×1280, `phone` a Pixel 7 at 412×839), themes, dataset, layout, setup and steps, what
  to crop, and the docs pages that show it.
- `capture-plan.ts`: the entry types, file naming, the light/dark variants, the manifest's own
  validation and the GIF ladder (pure; the app's Vitest tests it).
- `runner.ts`: one Playwright test per image and theme. It opens Explore, waits for the data and
  for the plot to settle, runs the entry, parks the pointer, checks no tooltip is open and takes the
  picture. PNGs are taken at device scale 2 (example thumbnails at 1) with reduced motion; GIFs are
  recorded at scale 1.
- `indicators.ts`: the cursor, click and key overlays a GIF shows, in the page's theme.
- `gif.ts`: the video-to-GIF converter. `check.ts` and `docs-lint.ts`: the lint.

The scenes drive the app through the same helpers as the E2E suite (`apps/web/tests/helpers/`),
which find controls by role and name and wait for signals: a dialog visible, a structure loaded,
the plot settled. A scene holds no timer and never evaluates in the page; the only pause in
capture code is `cap.hold(ms)`, which paces a GIF. The few timers inside the shared helpers (such
as `dragLegendRow`'s default pause between rows, which a capture replaces with its own) are counted
by `apps/web/src/explore/docs-images.test.ts`, so a new one shows in review.

To find which pages show an image, see its entry's `docs`, or grep the docs for its file name.

## File names and dark twins

A file is named after its entry: `name.png` or `name.gif`, lowercase kebab-case, optionally under
`examples/`. A screenshot with a dark variant gets a twin, `name-dark.png`, captured with the
browser in dark mode and the app's theme on System. Only screenshots have twins: GIFs, the example
thumbnails, the menu crops and the EAT crops are light only.

A page shows a pair as two images on consecutive lines, the light one first; the docs site hides
whichever does not match its appearance (a `<style>` rule in `docs/.vitepress/config.mts`):

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

## GIFs and their budget

A GIF entry is recorded as a `.webm` in `temp-videos/` (git-ignored) with a JSON sidecar holding
the time to trim from the start (the end of the entry's setup). `pnpm docs:gifs [--keep] [name…]`
converts each (only the named ones, when names are given) with a two-pass ffmpeg palette and walks
a ladder until the file fits the entry's budget: 25 fps at 1000 px wide (Playwright records at
25 fps), then 20 and 15 fps, then 800 and 640 px at 15 fps. The budget is 3 MiB (3,145,728 bytes)
unless the entry sets `budgetBytes`. A converted recording is deleted unless `--keep` is given. A
GIF still over budget at the last rung fails the run, keeps its `.webm`, and leaves the previous
GIF in place: shorten the entry's steps or its `hold`s. `ffmpeg` must be on your `PATH`.

## The lint

`pnpm docs:images:check` runs in `pnpm precommit` and reads only files. It fails when:

- a manifest output is missing, or a file here has no manifest entry;
- a GIF is over its budget;
- a page shows a file that does not exist, a file is shown by no page, or a page an entry names
  does not show it;
- a `-dark` file has no light twin, or a pair is not written as above;
- a link's `#anchor` matches no heading on its page (VitePress checks pages, never anchors);
- the user guide names removed UI (the control bar, the Isolate button and the like).

`apps/web/src/explore/docs-images.test.ts` runs the same rules on small cases and on the real docs
in `pnpm test`.

## The example thumbnails

`examples/<id>.png` are the [Example Datasets](../example-datasets.md) page's thumbnails, one per
catalog example, from `scenes/examples.ts`: 1280×720 at scale 1, always light, each example opened
from the files the product serves.

```bash
pnpm examples:fetch
pnpm docs:screenshots -g "examples/"
```

`pnpm docs:examples:check` fails when a card's thumbnail is missing. The opt-in `examples-live` E2E
project still opens every example and checks its curated view, but writes no image.
