## Why

A support inbox, `hello@protspace.app`, now exists but is unreachable from the interface — users have no in-app way to ask questions, report a bug with useful context, or send a privacy/data request (the Privacy page even names the domain but offers no contact). Surfacing it turns dead-end errors and unanswered questions into actionable reports.

## What Changes

- Add a shared support module (`app/src/lib/support.ts`) holding the support address, the GitHub repo URL, and pure builders for `mailto:` links, prefilled GitHub-issue links, and a bug-report context body (operation, error, page URL, browser; error/stack truncated to stay under the practical `mailto` length limit).
- Add a **Contact** link to the Footer (site-wide general contact).
- Add a **Contact** section to the Privacy page for privacy/data requests.
- Add a **"Report this"** action button to the dataset-import and export failure toasts, opening a prefilled `mailto:`.
- Add an app-level `ErrorBoundary` (new) wrapping `<App />`, with a crash fallback offering Reload, **Email us**, and **Open a GitHub issue** (both prefilled with route + truncated stack).
- Add a "broken link? Email us" line to the NotFound (404) page, prefilled with the attempted path.

## Capabilities

### New Capabilities

- `support-contact`: In-app paths to reach the support inbox for general contact, bug/error reporting (email primary, prefilled GitHub issue as a browser-only fallback), and privacy/legal requests — including prefilled context for bug reports and a catch-all crash fallback.

### Modified Capabilities

<!-- None — no existing spec's requirements change. -->

## Impact

- **New code:** `app/src/lib/support.ts` (+ tests), `app/src/components/ErrorBoundary.tsx` (+ tests).
- **Modified code:** `app/src/lib/notify.ts` (`NotifyOptions` gains an optional `action`; `emitNotification` forwards it to sonner), `app/src/explore/notifications.ts` (failure builders attach the report action), `app/src/components/Footer.tsx`, `app/src/pages/Privacy.tsx`, `app/src/pages/NotFound.tsx`, `app/src/main.tsx` (wraps `<App />`).
- **APIs/contracts:** internal only — `NotifyOptions` extended with an optional, backward-compatible field. No new dependencies. No backend changes; `mailto:`/GitHub links are client-side.
- **Known limitation:** `mailto:` requires a configured mail client; the GitHub-issue path covers users without one for bug reports.
