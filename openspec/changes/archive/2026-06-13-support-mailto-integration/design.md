## Context

ProtSpace is a React SPA (Vite, React Router, Tailwind, shadcn-style UI). User-facing notifications go through `app/src/lib/notify.ts`, a thin wrapper over the `sonner` toast library; the Explore feature builds notification payloads via pure functions in `app/src/explore/notifications.ts` that return `NotifyOptions` objects. Site chrome (`Header`, `Footer`) already follows established external-link patterns, and shared link config lives in root `config/` (`urls.ts`, `navigation.ts`). There is currently no top-level React error boundary — `main.tsx` renders `<App />` bare, so a render crash yields a blank screen. The support inbox `hello@protspace.app` exists but is not referenced anywhere in the UI.

## Goals / Non-Goals

**Goals:**

- One place owning the support address and all link/body construction.
- Reach the inbox for general contact, privacy/legal, and bug reporting.
- Prefill bug reports with enough context (operation, error, page, browser) to be actionable.
- Offer a GitHub-issue fallback for bug reporting (works without a mail client).
- Replace the blank-screen crash with a recovery fallback.

**Non-Goals:**

- A server-backed contact form (email/GitHub links are the channel).
- Header navigation contact entry (footer covers general contact site-wide).
- Data/research inquiry routing.
- Centralizing the GitHub repo URL already hardcoded in `Footer.tsx`/`navigation.ts` (unrelated refactor; the new module defines its own constant).

## Decisions

**Support module in `app/src/lib/support.ts`, not root `config/`.** Only the React app consumes these links; VitePress docs do not. Keeping it app-scoped lets it be unit-tested with the existing Vitest setup. _Alternative considered:_ root `config/` alongside `urls.ts` — rejected because it widens the shared surface for no consumer.

**Pure builders, context injected.** `buildMailto`, `buildIssueUrl`, and `buildBugContext` take all inputs as arguments (including `page` and `userAgent`), so they are deterministic and testable; call sites supply `window.location.href` / `navigator.userAgent`. _Alternative:_ read `window`/`navigator` inside the builders — rejected for testability.

**Extend `NotifyOptions` with an optional `action`, forwarded to sonner.** `emitNotification` maps `action: { label, href }` to sonner's `action: { label, onClick }`. The `onClick` opens `mailto:` via same-window navigation and `http(s)` via a new tab — matching how a `mailto:` is expected to hand off to the mail client while a GitHub link opens a page. The field is optional, so all existing notifications are unchanged. _Alternative:_ a separate toast helper — rejected; it would duplicate dedupe/duration logic.

**Email in toasts, both channels on the crash fallback.** A toast fits one action, so it uses the primary channel (email). The `ErrorBoundary` screen has room for both Email and GitHub. _Alternative:_ GitHub in toasts — rejected; email is the stated primary contact.

**`ErrorBoundary` as a class component wrapping `<App />` in `main.tsx`.** React error boundaries require a class (`getDerivedStateFromError` + `componentDidCatch`). Wrapping at the `main.tsx` root catches everything; route context comes from `window.location` rather than router context, so the boundary needs no router. _Alternative:_ wrap inside `App` under the router — unnecessary; `window.location` suffices.

## Risks / Trade-offs

- **`mailto:` does nothing without a configured mail client** → the GitHub-issue link on the crash fallback covers bug reporting for those users; general/privacy contact accept this limitation as the chosen channel.
- **Long stacks could exceed `mailto` URL limits** → `buildBugContext` truncates error/stack below a cap, keeping links within the practical ~1500-char limit.
- **A bug inside the `ErrorBoundary` fallback would defeat its purpose** → the fallback uses only static markup and link builders that never throw.
- **User context (page URL, user agent) is placed in the report body** → acceptable: it is user-initiated, visible/editable before sending, and contains no secrets.
