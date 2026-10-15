## Why

Reloading the explore page, or opening a projection link, loads the demo or an example again, and
every such load cleared everything saved for that dataset before applying the bundle's settings.
A picked Shape size, which `scatterplot-point-size` stores once per dataset and promises to restore
on reload, therefore fell back to the default computed from the protein count (#340). Back/Forward
between examples did the same.

## What Changes

- Keep a dataset's saved legend settings, picked Shape size and tooltip selection when the demo or
  an example loads without a menu choice: on startup, reload, a deep link or Back/Forward.
- A menu choice from **Import → Examples**, and a user import whose bundle carries settings, still
  replace the saved settings with the bundle's.
- On a keeping load, seed a bundle's per-annotation settings only for annotations with no saved
  record, and apply a bundle's top-level `shapeSize` only when no size is saved for the dataset
  (`ProtspaceLegend.applyShapeSize` gains a `replaceExisting` argument).
- Include EAT prediction cells in the legend's dataset hash, so it matches the controller's.
- Replace the page-reload reset of #178; resetting the demo now goes through the Import menu.

## Capabilities

### New Capabilities

- `legend-settings-persistence`: when a dataset's saved display settings survive a load and when
  a load resets them to the bundle's.

### Modified Capabilities

None. `scatterplot-point-size` already requires a picked size to survive a reload; this change makes
the demo and examples meet it.

## Impact

- `apps/web/src/explore/dataset-controller.ts`: the clear/keep decision per load.
- `packages/core/src/controllers/base-persistence-controller.ts`: keep-existing file settings.
- `packages/core/src/components/legend/legend.ts`: the dataset hash input and `applyShapeSize`.
- Controller, persistence and legend unit tests; e2e coverage for reload, deep link and menu reset.
- `docs/explore/legend.md` and `docs/developers/api/index.md`.
- No dependency or bundle-format changes.
