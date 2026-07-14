## Why

Embedding Annotation Transfer (EAT) predictions are already embedded in production
`.parquetbundle` files, but the web application currently exposes their storage columns as
ordinary annotations and cannot distinguish transferred values from curated observations. This
prevents users from evaluating prediction confidence and provenance, and risks presenting inferred
biology as ground truth in figures intended for scientific publication.

## What Changes

- Reserve the `__pred_` companion-column namespace and normalize valid EAT value, confidence, and
  source triples into a lossless per-protein prediction channel.
- Keep raw EAT storage columns out of ordinary annotation selection while exposing a deliberate,
  explicitly identified numeric confidence annotation without consuming a legitimate user column
  that happens to share its preferred suffix.
- Add a persisted EAT overlay mode and confidence threshold beside annotation selection only when
  the loaded dataset contains usable EAT predictions.
- Coalesce transferred values into the active categorical view without changing curated data;
  render observed points filled and transferred points as confidence-weighted hollow markers.
- Add EAT-specific tooltip provenance and an observed-versus-transferred-versus-missing legend
  section with live counts that account for the complete represented population.
- Add bidirectional, capped provenance connectors between transferred proteins and their source
  proteins, including projection/plane recomputation, connected-point emphasis, empty-click and
  keyboard dismissal, and an accessible fan-out summary.
- Preserve the EAT distinction in live WebGL, grayscale, PNG export, filtered/isolation views,
  settings persistence and OPFS reload, dataset hashing, slicing, and lossless v1/v2 bundle
  round-trips, including structural label escaping, evidence/score suffixes, collision-safe runtime
  annotation identity, and format metadata.
- Add focused unit, integration, shader/export, settings, and browser tests using the exact
  phosphatase EAT bundle linked from issue #277 comment 4902936797.

## Capabilities

### New Capabilities

- `eat-annotation-overlay`: Bundle normalization, confidence selection, overlay controls,
  confidence-aware non-colour rendering, provenance tooltip/legend, persistence, and lossless
  export behavior for per-cell EAT predictions.
- `eat-provenance-connectors`: Interactive predicted-to-source and source-to-query connector
  behavior, fan-out limits, projection updates, emphasis, and accessible dismissal/status.

### Modified Capabilities

None.

## Impact

The change spans the shared visualization data model and accessors, bundle conversion/writing and
settings validation, control bar, scatter-plot visibility and WebGL/export shaders, tooltip,
legend, app interaction wiring, dataset loading/export, and their tests. It adds no runtime
dependency and makes no breaking bundle-format change: old bundles remain unchanged, and EAT
bundles retain the backend's three inline companion columns when re-exported.
