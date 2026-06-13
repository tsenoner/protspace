## 1. Support module

- [x] 1.1 Create `app/src/lib/support.ts` exporting `SUPPORT_EMAIL` (`hello@protspace.app`) and `GITHUB_REPO_URL`
- [x] 1.2 Implement `buildMailto({ subject?, body? })` — targets `SUPPORT_EMAIL`, URL-encodes params, omits empty params
- [x] 1.3 Implement `buildIssueUrl({ title?, body? })` — `${GITHUB_REPO_URL}/issues/new` with encoded `title`/`body` and `labels=bug`, omitting empty params
- [x] 1.4 Implement `buildBugContext({ operation, error, page, userAgent })` — free-text prompts + technical block (operation/error/page/browser), tolerating non-`Error` values
- [x] 1.5 Add a `MAX_ERROR_CHARS` cap so error/stack is truncated and links stay under the practical `mailto` limit
- [x] 1.6 Add `app/src/lib/support.test.ts` covering encoding, empty-param omission, bug-context contents, truncation, and non-`Error` input

## 2. Notification action plumbing

- [x] 2.1 Extend `NotifyOptions` in `app/src/lib/notify.ts` with optional `action?: { label: string; href: string }`
- [x] 2.2 In `emitNotification`, forward `action` to sonner as `{ label, onClick }`; `onClick` navigates the current window for `mailto:` and opens a new tab (`noopener,noreferrer`) for `http(s)`
- [x] 2.3 Add/extend notify tests asserting `action` is forwarded to the sonner mock as `{ label, onClick }` and absence leaves behavior unchanged

## 3. Bug-report action on Explore failures

- [x] 3.1 In `app/src/explore/notifications.ts`, attach a "Report this" `action` to `getDataLoadFailureNotification` (operation: dataset import) via `buildMailto` + `buildBugContext`
- [x] 3.2 Attach the same "Report this" action to `getExportFailureNotification` (operation: export)
- [x] 3.3 Update/extend `notifications.test.ts` to assert the failure builders include the report action with a `mailto:` href

## 4. Static contact surfaces

- [x] 4.1 Add a "Contact" `mailto:` link to `app/src/components/Footer.tsx` matching existing footer link styling
- [x] 4.2 Add a "Contact" section to `app/src/pages/Privacy.tsx` with a `mailto:` (subject: privacy request)
- [x] 4.3 Add a "broken link? Email us" line to `app/src/pages/NotFound.tsx` prefilled with the attempted path (`window.location.pathname`)

## 5. Application crash fallback

- [x] 5.1 Create `app/src/components/ErrorBoundary.tsx` (class component, `getDerivedStateFromError` + `componentDidCatch`) with a fallback: heading, Reload, Email us (`buildMailto` + `buildBugContext`), Open a GitHub issue (`buildIssueUrl` + `buildBugContext`)
- [x] 5.2 Wrap `<App />` in `<ErrorBoundary>` in `app/src/main.tsx`
- [x] 5.3 Add an `ErrorBoundary` test verifying the crash report links. _Adapted to the project's Node/no-DOM Vitest harness (no testing-library/jsdom — a non-goal to add): tests `getDerivedStateFromError` (the fallback trigger) plus the exported pure `buildCrashLinks` helper, asserting the "Email us" `mailto:` and GitHub-issue hrefs carry context, instead of a DOM render. Added the `@` alias to `app/vitest.config.ts` so component imports resolve._

## 6. Verification

- [x] 6.1 Run `pnpm test` (or the app's test command) and confirm support, notify, notifications, and ErrorBoundary tests pass
- [x] 6.2 Run `pnpm lint` and `pnpm type-check` clean
