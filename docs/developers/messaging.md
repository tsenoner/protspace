# Messaging Conventions

ProtSpace separates user messaging by ownership instead of forcing every message through one UI channel.

## Layers

### Host-owned transient notifications

Use transient notifications for recoverable warnings and errors that affect the application shell but do not block the current workflow.

- Example: automatic dataset persistence is unavailable
- Example: a dataset import failed
- Example: selection mode was auto-disabled after the filtered dataset became too small

In `apps/web`, the deployed web application, `apps/web/src/lib/notify.ts` is the only supported transient notification
entry point. It wraps the toast layer, applies per-severity durations, and de-duplicates repeat
messages within a 5-second window via `dedupeKey`. `apps/web/src/explore/notifications.ts` maps
normalized component events onto those `notify` calls.

### Blocking and progress UI

Use dedicated progress UI for long-running or stateful operations.

- Example: the `/explore` dataset loading overlay (`apps/web/src/explore/loading-overlay.ts`)

Do not replace this layer with toasts.

### Component-owned workflow UI

Keep dialogs and focused workflow surfaces inside the component that owns the workflow.

- Example: legend settings dialog
- Example: legend "Other" extraction dialog

### Component-owned inline states

Keep empty, loading, and error states inline when the message is part of the component itself.

- Example: structure viewer empty state
- Example: structure viewer loading and error states

### Accessibility-only announcements

Use `aria-live` and related accessibility primitives for assistive feedback without requiring a visible global notification.

- Example: legend status announcements

## Event Contract

Host-consumed warning and error events share the `HostMessageEventDetail` shape defined in
`packages/core/src/events/index.ts`:

- `message`: user-facing summary
- `severity`: `info`, `warning`, `error`, or `success` (`HostMessageSeverity`)
- `source`: emitter identifier
- `context`: optional structured metadata
- `originalError`: optional underlying error (typed `unknown`)

Each event narrows the generic parameters to the source, severity, and context it actually emits.
Current normalized host-facing events:

| Event                             | Source                                                                   | Severity  | Emitted by         |
| --------------------------------- | ------------------------------------------------------------------------ | --------- | ------------------ |
| `selection-disabled-notification` | `control-bar`                                                            | `warning` | `control-bar`      |
| `data-error`                      | `data-loader`                                                            | `error`   | `data-loader`      |
| `legend-error`                    | one of `data-processing`, `persistence`, `scatterplot-sync`, `rendering` | `error`   | `legend`           |
| `structure-error`                 | `structure-viewer`                                                       | `error`   | `structure-viewer` |

## Host Responsibilities

Hosts should decide how to surface normalized events.

- Use transient notifications for recoverable app-level issues.
- Keep structure viewer inline errors inside the structure viewer.
- Preserve component dialogs as component-owned workflow UI.
- Update tests and docs whenever a user-facing message or event contract changes.
