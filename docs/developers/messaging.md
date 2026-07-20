# Messaging Conventions

ProtSpace separates user messaging by ownership instead of forcing every message through one UI channel.

## Layers

### Host-owned transient notifications

Use transient notifications for recoverable warnings and errors that affect the application shell but do not block the current workflow.

- Example: automatic dataset persistence is unavailable
- Example: a dataset import failed
- Example: selection mode was auto-disabled after the filtered dataset became too small

In the demo application, `apps/web/src/lib/notify.ts` is the only supported transient notification entry point.

### Blocking and progress UI

Use dedicated progress UI for long-running or stateful operations.

- Example: the `/explore` dataset loading overlay

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

Host-consumed warning and error events should expose:

- `message`: user-facing summary
- `severity`: `info`, `warning`, or `error`
- `source`: emitter identifier
- `context`: optional structured metadata
- `originalError`: optional low-level error object

Current normalized host-facing events:

- `selection-disabled-notification`
- `data-error`
- `legend-error`
- `structure-error`

## Host Responsibilities

Hosts should decide how to surface normalized events.

- Use transient notifications for recoverable app-level issues.
- Keep structure viewer inline errors inside the structure viewer.
- Preserve component dialogs as component-owned workflow UI.
- Update tests and docs whenever a user-facing message or event contract changes.
