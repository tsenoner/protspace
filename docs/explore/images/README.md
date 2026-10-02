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

The EAT captures are the only ones that do not use the app's built-in demo dataset. They load
`apps/web/public/data/venom_eat_stats.parquetbundle` through the real file input, because the demo
dataset carries no `*__pred_*` columns. They live in `capture-eat-static.spec.ts` and
`capture-eat-animations.spec.ts` with shared setup in `eat-helpers.ts`.
