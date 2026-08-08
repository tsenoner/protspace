## Context

Legend display settings are persisted under a dataset hash. An in-place projection change keeps the
same explore controller alive and therefore retains Shape size. Projection deep links and browser
reloads create a fresh controller, however, and the automatic demo-dataset load is classified as a
`default` load. The dataset controller currently clears persisted legend and control-bar state for
every `default` load and then applies the demo bundle's embedded settings with replacement semantics.
The fresh controller therefore replaces the saved setting before the legend can restore it.

The same `default` load kind is also used by the explicit reset-to-demo action. The implementation
must distinguish automatic startup from that user-requested reset without changing storage keys,
file formats, or projection state.

## Goals / Non-Goals

**Goals:**

- Preserve the dataset-scoped Shape size when projection navigation remounts the explore view.
- Keep the existing explicit reset-to-demo behavior after a dataset is already active.
- Preserve the precedence of settings embedded in imported dataset bundles.
- Add focused regression coverage for the automatic-load and explicit-reset distinction.

**Non-Goals:**

- Making Shape size projection-specific or global across datasets.
- Introducing a new persistence schema or migrating existing local-storage records.
- Changing other legend controls, projection URL semantics, or dataset import behavior.
- Refactoring the dataset loading or persistence architecture.

## Decisions

### Use controller lifecycle state to distinguish startup from reset

For a `default` load, use replacement semantics only when `currentDatasetHash` is already set. A
fresh controller has no current dataset, so its automatic default load preserves existing
dataset-keyed settings. An explicit reset after a dataset is active continues to clear and replace
those settings. Recovery-banner actions can request the demo before any dataset has loaded; those
requests intentionally follow startup semantics because there is no active dataset to reset.

This uses state the controller already owns and keeps the change local to the persistence decision.

**Alternative considered:** never clear state for a `default` load. Rejected because it would break
the explicit reset-to-demo contract.

**Alternative considered:** persist Shape size in a separate global or per-dataset key. Rejected
because it duplicates the existing legend persistence mechanism, requires precedence rules, and
expands the change beyond the reported bug.

### Keep imported bundle precedence unchanged

A user load with embedded settings continues to clear persisted state before applying the bundle's
settings. OPFS restores continue to use the persisted dataset and legend state as before.

### Seed missing demo settings without overwriting local settings

When file settings are applied without clearing existing storage, retain each annotation key that is
already persisted and seed embedded settings only for missing annotation keys. Exclude retained keys
from the in-memory file-precedence map so the normal local-storage restore path remains authoritative.
This preserves saved Shape size while still giving first-time users the demo bundle's curated legend
defaults.

**Alternative considered:** skip all embedded demo settings on automatic startup. Rejected because
first-time users would lose curated per-annotation defaults when no local record exists.

### Use one complete dataset identity at every persistence boundary

The dataset controller and legend must hash the same fields. In particular, EAT prediction cells are
part of the dataset fingerprint, so the legend includes `annotation_predicted` when it recomputes its
hash after loading data. Otherwise the controller probes and seeds one storage key while the legend
loads and saves another.

## Risks / Trade-offs

- **A fresh automatic load restores the complete legend record, not only Shape size.** → This is the
  existing dataset-scoped persistence unit; retaining it avoids partial-record semantics. Explicit
  reset still clears the record.
- **Other hash-scoped preferences also survive automatic startup.** → The existing storage cleanup
  removes every `protspace:*:<dataset-hash>` key. Skipping it therefore also activates the existing
  silent-URL tooltip restore path. An explicit reset after a dataset is active still clears all keys.
- **A re-curated demo bundle does not replace existing records for returning users.** → The bundle
  settings table is not part of the dataset hash and stored records do not distinguish seeded
  defaults from user edits. Changing this would require new persistence provenance and precedence
  rules; this change favors existing local settings. Changing the demo data changes the hash and
  seeds the new bundle settings.
- **Changing non-clearing file application affects its API semantics.** → There are no existing
  production callers of the non-clearing mode; focused controller tests define replacement and
  preserve-existing behavior explicitly.
- **Lifecycle state could be mistaken for load source.** → Focused tests cover both the first
  automatic default load and a subsequent default load through the same controller.
- **A later loader refactor could introduce another startup path.** → Keep the behavior specified in
  terms of automatic first load versus explicit reset, rather than a particular UI event.

## Migration Plan

No data migration is required. Existing persisted records become restorable on reload and projection
deep links. EAT-backed legend records previously saved under the legend's incomplete,
prediction-omitting hash are not migrated; the corrected shared hash is seeded on the next load.
Non-EAT dataset keys are unchanged. Rollback is a source revert; the storage schema is unchanged.

## Open Questions

None.
