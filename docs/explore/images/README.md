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

- Static screenshots: `capture-static.spec.ts`, named by the test title
- Animated GIFs: `capture-animations.spec.ts`, converted by `convert-to-gif.ts`

To find which pages use an image, grep the docs for its filename.

## The EAT captures

The EAT captures are the only ones that do not use the app's built-in demo dataset, which carries no
`*__pred_*` columns. They open the Import menu's EAT example,
[three-finger toxins](../example-datasets.md#three-finger-toxins), by its `?dataset=` link and colour it
by `toxin_class`. Its bundle is a release asset, so fetch it first:

```bash
pnpm examples:fetch
```

They live in `capture-eat-static.spec.ts` and `capture-eat-animations.spec.ts`, with shared setup in
`eat-helpers.ts`.

## Capturing against another port

The captures start no server of their own: they expect `pnpm dev` on `:8080`, serving the product
demo. With `:8080` taken (or held by an E2E dev server, which pins the startup load to a test fixture
and which the captures refuse), start a plain dev server on another port and point the captures at it:

```bash
pnpm --filter @protspace/app exec vite --port 8095 --strictPort  # in one terminal
PLAYWRIGHT_BASE_URL=http://localhost:8095 pnpm docs:images        # in another
```

## The example thumbnails

`examples/<id>.png` are the [Example Datasets](../example-datasets.md) page's thumbnails, one per
catalog example. They come from the opt-in `examples-live` E2E project, which opens every example
from the files the product serves and checks that it lands on its curated view:

```bash
pnpm examples:fetch
RUN_EXAMPLES_E2E=1 pnpm test:e2e --project=examples-live
```

Set `EXAMPLES_THUMBNAIL_DIR` to write them elsewhere, for example to review a candidate curated
view before committing it. `pnpm docs:examples:check` fails when a card's thumbnail is missing.
