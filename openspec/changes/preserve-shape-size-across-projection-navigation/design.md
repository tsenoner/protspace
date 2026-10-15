## Context

Legend display settings are persisted per dataset hash: one record per annotation under
`protspace:legend:<hash>:<annotation>`, and the picked Shape size once per dataset under
`protspace:shape-size:<hash>` (`scatterplot-point-size`). An in-place projection change keeps the
same explore controller and dataset alive, so it retains both.

Every load of the demo or an example is a `default` load. The dataset controller cleared all
`protspace:*:<hash>` keys for every `default` load and then applied the bundle's settings with
replacement semantics. Reloads, projection deep links and Back/Forward therefore all reset the
dataset to its bundle, and the picked Shape size fell back to the default computed from the protein
count. The same `default` kind also covers the explicit reset: choosing the demo or an example from
**Import → Examples**.

## Goals / Non-Goals

**Goals:**

- Keep a dataset's saved settings across loads the user did not ask to reset.
- Keep the menu choice as the way to reset an example to its bundle's settings.
- Preserve the precedence of settings embedded in imported dataset bundles.

**Non-Goals:**

- Making Shape size projection-specific or global across datasets.
- Introducing a new persistence schema or migrating existing local-storage records.
- Changing other legend controls, projection URL semantics, or dataset import behavior.

## Decisions

### Key the reset on the load's intent

Clear and replace only for a menu choice (`loadMeta.example.source === 'menu'`, which a Retry of a
menu choice repeats) and for a user import that carries settings. Every other `default` load keeps
what is saved: the startup load, the recovery banner's "Load default", a `?dataset=` deep link and
Back/Forward (`'startup'` or `'url'`). The same function already keys the curated-view reset on the
menu source, so the two stay in step.

**Alternative considered:** treat the first load in a controller as startup and any later `default`
load as a reset (`currentDatasetHash !== null`). Rejected: Back/Forward to an example after another
dataset is shown would still wipe its settings, and a menu choice made before anything rendered
would keep them while the view reset to the curated one.

### Keep imported bundle precedence unchanged

A user load with embedded settings continues to clear persisted state before applying the bundle's
settings. OPFS restores continue to use the persisted dataset and legend state as before.

### Seed missing settings without overwriting saved ones

On a keeping load, a bundle's per-annotation settings are seeded only for annotations with no saved
record, and only those enter the in-memory file-precedence map, so the normal local-storage restore
path stays authoritative for the rest. First-time visitors still get the bundle's curated legend.
A bundle's top-level `shapeSize` is applied the same way: only when no size is saved for the dataset
(`applyShapeSize(…, replaceExisting = false)`). The legend reloads its settings after
`setFileSettings` only when the file's settings won for the selected annotation.

### Use one complete dataset identity at every persistence boundary

The dataset controller and legend must hash the same fields. EAT prediction cells are part of the
dataset fingerprint, so the legend's hash input includes `annotation_predicted`. Otherwise the controller probes and seeds one storage key while the legend loads and saves
another.

## Risks / Trade-offs

- **A keeping load restores the complete legend record, not only Shape size.** → This is the
  existing dataset-scoped persistence unit; retaining it avoids partial-record semantics. A menu
  choice still clears the record.
- **Other hash-scoped preferences also survive automatic loads.** → The cleanup removes every
  `protspace:*:<dataset-hash>` key, so skipping it also restores the saved tooltip selection when
  the URL names none. A menu choice still clears all keys.
- **A re-curated example bundle does not replace saved records for returning users.** → The bundle
  settings table is not part of the dataset hash, and stored records do not distinguish seeded
  defaults from user edits. This covers a bundle's top-level `shapeSize` too, which is stored once
  applied. Changing the example's data changes the hash and seeds the new settings; choosing the
  example from the menu also applies them.
- **Reset does not outlast a reload for a bundle with a top-level `shapeSize`.** → Reset removes the
  dataset's stored size, so the next automatic load finds none and applies the bundle's size again.
  Per-annotation sizes do not have this gap, because Reset rewrites their records instead of
  removing them. Keeping Reset would need a stored marker, which `scatterplot-point-size` rules out
  ("SHALL NOT store that default").
- **The recovery banner's "Load default" keeps saved settings.** → It follows startup semantics; the
  menu choice is the reset.

## Migration Plan

No data migration is required. Existing persisted records become restorable on reload, deep links
and Back/Forward. EAT-backed legend records previously saved under the legend's
prediction-omitting hash are not migrated; the corrected shared hash is seeded on the next load.
Non-EAT dataset keys are unchanged. Rollback is a source revert; the storage schema is unchanged.

## Open Questions

None.
