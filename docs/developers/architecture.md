# Architecture

## Messaging Model

ProtSpace uses a layered messaging model instead of a single catch-all UI primitive.

- Host-owned transient notifications: The host application decides how to surface recoverable warnings and errors. In the demo app, `apps/web/src/lib/notify.ts` is the only transient notification transport and it is backed by Sonner.
- Blocking and progress UI: Long-running operations use dedicated progress UI instead of toasts. The `/explore` app uses a full-screen loading overlay for dataset imports.
- Component-owned workflow UI: Components keep their own dialogs and focused workflow controls. The legend settings and "Other" extraction dialogs stay inside the legend component.
- Component-owned inline states: Components keep inline empty/loading/error states when the message belongs to the component surface itself. The structure viewer keeps its own empty, loading, and error UI.
- Accessibility-only announcements: Components may expose `aria-live` status updates for assistive technologies without mirroring them as global toasts.
- Host-consumed semantic events: Components emit normalized warning and error events such as `selection-disabled-notification`, `data-error`, `legend-error`, and `structure-error`. Hosts decide whether to surface those as toasts, inline UI, or silent recovery.

The shared event contract uses these minimum fields:

- `message`
- `severity`
- `source`
- optional `context`
- optional `originalError`

See [Messaging Conventions](./messaging.md) for the full ownership model and host integration guidance.

## Legend Component

The legend component uses a controller-based architecture for separation of concerns.

### Controllers

**PersistenceController**

- Manages localStorage operations for legend settings
- Scopes settings by dataset hash and annotation name
- Dataset hash is computed from sorted protein IDs using djb2 algorithm

**DragController**

- Handles drag-and-drop reordering
- Supports merging items into "Other" group
- Automatically switches to manual sort mode on reorder

**ScatterplotSyncController**

- Observes scatterplot data and annotation changes
- Dispatches z-order and color mapping events
- Maintains component synchronization

### Data Processing

**LegendDataProcessor**

- Converts annotation values into legend items
- Applies persisted colors and shapes when available
- Handles category grouping and "Other" bucket
- Supports multiple sorting modes

### Storage Layer

Located in `@protspace/utils/storage`:

- Generic localStorage wrapper with type safety
- Key format: `protspace:{component}:{datasetHash}:{context}`
- Graceful error handling for quota exceeded scenarios
- djb2 hash algorithm for deterministic dataset identification

### Reactive Controllers Pattern

Controllers implement Lit's `ReactiveController` interface:

```typescript
interface ReactiveController {
  hostConnected(): void;
  hostDisconnected(): void;
}
```

Communication between controllers and host component happens through callback interfaces, enabling:

- Testability (controllers can be tested in isolation)
- Reusability (controllers can be used by other components)
- Maintainability (concerns are clearly separated)
