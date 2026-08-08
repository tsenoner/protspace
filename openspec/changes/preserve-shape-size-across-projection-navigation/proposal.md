## Why

Changing projection through a direct explore URL or reloading after an in-app projection change
remounts the default dataset and replaces its persisted legend settings with the bundle defaults.
The Shape size control then returns to `30` even though projection is view state and point size is a
dataset-scale preference.

## What Changes

- Retain legend settings when the default dataset is loaded automatically into a fresh explore
  controller, including projection deep links and browser reloads.
- Preserve the existing explicit reset-to-demo behavior when a dataset is already active.
- Replace the historical page-reload reset behavior from #178 while retaining that issue's in-app
  reset path after a custom dataset is active.
- Add focused regression coverage for automatic default-load retention and explicit default reset.

## Capabilities

### New Capabilities

- `legend-settings-persistence`: Defines how dataset-scoped legend display settings survive explore
  navigation while explicit dataset reset actions clear them.

### Modified Capabilities

None.

## Impact

- `apps/web/src/explore/dataset-controller.ts` default-load persistence decision.
- `packages/core/src/controllers/base-persistence-controller.ts` file-setting merge semantics.
- `packages/core/src/components/legend/legend.ts` dataset identity used by legend persistence.
- Dataset-controller and legend unit tests plus focused browser regressions for Shape size
  restoration.
- Explore documentation for saved Shape size and reload/reset behavior.
- No API, dependency, or bundle-format changes.
