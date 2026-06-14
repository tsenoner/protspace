## Context

Biocentral is routinely unavailable. The prep pipeline runs `protspace embed` as
a subprocess; when Biocentral is down it exits with
`TimeoutError: No healthy biocentral service became available in time`.

`pipeline.py._classify_failure` re-tags known Biocentral-down failures as
`BIOCENTRAL_UNAVAILABLE` by matching `_BIOCENTRAL_DOWN_PATTERNS` against the
subprocess stderr — but that list only covers connection-refused / DNS / 503, not
the timeout message. So the failure passes through as the generic per-step error
(`The {step} step failed. Please try again…`), the frontend shows a retry toast,
and the user is never pointed at the working Colab notebook.

On the frontend, the `BIOCENTRAL_UNAVAILABLE` code already exists in
`FASTA_PREP_CODE_MESSAGES` but its copy says "wait a moment and try again" and
offers no Colab link. Toasts are emitted through `app/src/lib/notify.ts`, which
wraps Sonner; `NotifyOptions` currently has no way to render an action button.

A separate, **design-only** feature (`feat/contac_link`, support-mailto) plans to
add the same `NotifyOptions.action` field and attach a "Report this" email action
to the same failure builder. That branch has no implementation yet (no commits
beyond main, no `action` field, no `support.ts`).

## Goals / Non-Goals

**Goals:**

- Classify the Biocentral outage timeout as `BIOCENTRAL_UNAVAILABLE`.
- Give the `BIOCENTRAL_UNAVAILABLE` toast Colab-pointing copy and a clickable
  "Open in Colab ↗" action.
- Implement the shared `NotifyOptions.action` primitive in the exact shape the
  support-mailto design specifies, so the two features merge cleanly.

**Non-Goals:**

- Proactively routing users to Colab before they upload (banner / disabled
  embedding). Error-path fix only.
- The support-mailto / contact-link feature itself.
- Broadening classification to bare `TimeoutError`.

## Decisions

**1. Match `"no healthy biocentral"`, not `"timeouterror"`.**
Added to `_BIOCENTRAL_DOWN_PATTERNS`. It is specific to the outage message and
case-insensitive (the haystack is lowercased). _Alternative — match bare
`timeouterror`:_ rejected because it would also catch the legitimate pipeline
wall-clock `asyncio.TimeoutError` (`pipeline.py:172`), misreporting a slow job as
a Biocentral outage.

**2. Reuse, don't redefine, the `action` primitive.**
`NotifyOptions` gains `action?: { label: string; href: string }`;
`emitNotification` passes Sonner `action: { label, onClick }` where `onClick`
opens `href` — `mailto:` via `window.location.href`, `http(s)` via
`window.open(href, '_blank', 'noopener,noreferrer')`. This is the support-mailto
design's exact behavior, implemented here first. _Alternative — inline the URL in
toast text:_ rejected; a raw URL in a 10s auto-dismissing toast is not reliably
clickable.

**3. Colab wins the single action slot for `BIOCENTRAL_UNAVAILABLE`.**
A Sonner toast has one action button. `getDataLoadFailureNotification` branches:
`code === 'BIOCENTRAL_UNAVAILABLE'` → Colab action; otherwise → (support-mailto's)
"Report this". This change owns only the Biocentral arm. _Alternative — keep
"Report this" everywhere:_ rejected; a known, routine outage is not a
user-reportable bug.

**4. Extract `COLAB_NOTEBOOK_URL` to `fasta-prep-limits.ts`.**
The URL is currently hardcoded in `runtime.ts:114`. Both `runtime.ts` and
`notifications.ts` import the shared constant — a small de-dup in files already
being touched.

## Risks / Trade-offs

- [Merge collision with `feat/contac_link` on `notify.ts` / `notifications.ts`]
  → Use the identical `action` shape and `mailto`/`http` handling; whichever
  branch lands first defines the primitive, the other adds only its arm.
- [Biocentral changes its outage wording in a future release, breaking the match]
  → Matching is one of several patterns and falls back to the generic
  retry-with-reference message; covered by a regression test on the exact string.
- [Match string too broad and swallows a real timeout] → Mitigated by choosing
  `"no healthy biocentral"` over `"timeouterror"`; the pass-through test for
  unrelated errors stays green.

## Migration Plan

Pure code change, no data migration. Backend and frontend can deploy
independently: the backend tag is harmless without the frontend copy, and the
frontend copy/action only render when the backend emits the code. Rollback is a
straight revert of either side.
