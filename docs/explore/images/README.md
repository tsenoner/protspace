# Documentation Images

This folder contains screenshots and animations for the ProtSpace Explore documentation.

## Generating Images

Run `pnpm docs:images` to automatically generate all images. This command:

1. Captures static screenshots (PNG) via `docs:screenshots`
2. Records animations (WebM) via `docs:animations`
3. Converts videos to GIFs via `docs:gifs`

You can also run these commands individually if needed.

## Where each image comes from

Every file here is generated, so the capture specs in `scripts/docs-screenshots/` are the
inventory — no list is maintained in this README, because a hand-copied one goes stale the
first time someone adds a capture without updating it.

- Screenshots: the entries in `manifest.ts` (grouped in `scenes/`), captured by `runner.ts` and
  named by the entry (`-dark` for the dark variant)
- Animated GIFs: `capture-gif.spec.ts` (scenes in `scenes/*.ts`), converted by `gif.ts`

To find which pages use an image, grep the docs for its filename.

## The EAT captures

The EAT captures are the only ones that do not use the app's built-in demo dataset, which carries no
`*__pred_*` columns. They open the Import menu's EAT example,
[three-finger toxins](../example-datasets.md#three-finger-toxins), by its `?dataset=` link and colour it
by `toxin_class`. Its bundle is a release asset, so fetch it first:

```bash
pnpm examples:fetch
```

EAT captures move to `scenes/eat.ts` in Task 7.14.

## The capture server

The captures start their own dev server on `:8096` (`DOCS_CAPTURE_PORT` moves it), with this
checkout's packages built and without the E2E startup fixture, and stop it afterwards. To capture
from a server that is already running, point them at it; a server started for the E2E suite, which
pins the startup demo to a test fixture, is refused:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:8095 pnpm docs:screenshots
```

## The example thumbnails

`examples/<id>.png` are the [Example Datasets](../example-datasets.md) page's thumbnails, one per
catalog example (`scenes/examples.ts`). Each opens the example by its `?dataset=` link from the file
the product serves and shoots the workbench body on its curated view, light, in a 1280×720 window. The
release-hosted bundles must be fetched first:

```bash
pnpm examples:fetch
pnpm docs:screenshots -g "examples/"
```

`pnpm docs:examples:check` fails when a card's thumbnail is missing. The opt-in `examples-live` E2E
project still checks that every example lands on its curated view; it writes no images.
