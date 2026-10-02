## Context

The structure viewer downloads an AlphaFold mmCIF through `StructureService` and passes a blob URL to a dynamically loaded Mol* 3.44 viewer. Mol* automatically uses AlphaFold quality metadata for pLDDT coloring, but the application neither requests the separate AlphaFold DB TED domains endpoint nor exposes a way to change representation themes. TED responses contain an `annotations` array whose domains each have one or more inclusive `{ af_start, af_end }` residue segments.

The change crosses the shared data service, the Mol\* adapter, and the Lit structure-viewer component. TED is supplementary annotation: a missing or malformed TED response must not prevent the underlying structure from loading.

## Goals / Non-Goals

**Goals:**

- Preserve the current pLDDT view as the default.
- Retrieve and validate TED domain residue ranges for the displayed accession.
- Apply stable categorical colors by TED domain number, including discontinuous ranges.
- Let users switch between pLDDT and TED colors without reloading the structure.
- Degrade gracefully when TED annotations are unavailable.

**Non-Goals:**

- Editing or persisting domain annotations.
- Adding TED annotations to embedding bundle columns or the Python annotation pipeline.
- Replacing Mol*, changing the pinned Mol* version, or adding a Mol\* package dependency.
- Adding a domain legend, selection filters, or new structure representations.

## Decisions

### Treat TED annotations as optional sidecar structure data

Once AlphaFold DB reports a model, `StructureService.loadStructure` will request the AlphaFold DB `/api/domains/{accession}` endpoint alongside the structure file download. It will parse valid domain numbers and inclusive residue intervals into typed data attached to `StructureData`. The optional request has a five-second client timeout backed by an `AbortSignal`; timeout, request, shape, or segment failures produce an empty domain list while structure failures retain their current error behavior.

This keeps the component on one data-loading path and avoids a second UI-owned network lifecycle. The timeout aborts the request's `AbortSignal`, which settles a stalled fetch and its body read; the same signal is aborted when the structure itself fails or the caller cancels the load, so no orphaned sidecar request outlives its load. Making TED a required or unbounded request was rejected because annotation availability must not regress structure viewing.

### Encapsulate Mol\* theme details in the existing adapter

The Mol\* loader will wrap the CDN viewer with a `setColorTheme` method. Each viewer holds exactly one structure, so it receives that structure's TED domains when it is created and will register one custom color-theme provider for them against the viewer's public plugin theme registry and use the structure component manager to update loaded representations. Before the first switch to TED, the adapter records each representation's preset color theme and switching back restores exactly that (Mol\*'s `plddt-confidence` with its params for AlphaFold mmCIF; the preset's fallback, e.g. chain-id, for a model without confidence data, where forcing `plddt-confidence` would render uniform gray). Every structure's representations are updated in one `dataTransaction`, so a failed representation reverts the whole switch; because Mol\* reverts without throwing, the adapter confirms the theme landed and rejects otherwise. Click-to-focus representations are created lazily from the focus behavior's own theme params, so the adapter switches those params too and restores them if a switch fails (the behavior state is outside the reverted transaction). Interaction representations keep Mol\*'s interaction-type theme, since an interaction location has no residue to color.

Using a custom provider was chosen over rewriting mmCIF or applying permanent overpaint because it maps residues at render time, preserves pLDDT data, and supports reversible switching. Adding the npm Mol\* package was rejected because the runtime is already intentionally pinned and dynamically loaded from the CDN.

New AlphaFold structures retain Mol\*'s existing automatic pLDDT preset. The component does not reapply pLDDT after the asynchronous structure load, because a completion from a disposed or replaced viewer must not write a theme to the current viewer. Explicit user-initiated mode changes continue to go through the adapter.

### Map residue sequence numbers to stable categorical colors

The TED theme will read each atomic element's `label_seq_id`, find the containing inclusive interval, and derive a color from the TED domain number using the TED website's palette (Tableau 10, cycled), so a protein looks the same in ProtSpace and on ted.cathdb.info. All segments of the same domain therefore share a color. Residues outside valid TED intervals use TED's light gray (`#EBEBEB`). TED colors by its own API's list order, which is almost always TED01, TED02, …; keying by domain number keeps colors stable, at the cost of rare mismatches when TED's list is out of order.

Domain number, rather than response order or segment index, is the palette key so color assignment remains stable when discontinuous segments are present.

### Keep the component control explicit and conservative

The viewer renders a two-option “Color by” segmented control for `pLDDT` and `TED domains`, disabled until the structure has loaded, so the Mol\* canvas does not resize when loading ends. pLDDT remains selected on every newly loaded protein. The TED option is disabled when the parsed domain list is empty, and the explanatory tip follows the active mode.

The control remains visible when TED is unavailable so users can distinguish unavailable annotation from a missing feature.

The Mol\* adapter serializes theme updates per viewer, so the most recently requested mode is applied last even when a previous update is still in progress. The control reflects the requested mode immediately and rolls back only if that request fails while it is still current. Each structure load owns an `AbortController` that a protein change or cleanup aborts: its signal cancels the load's AlphaFold requests and marks it stale, so a load or theme completion from a replaced viewer cannot update the newly loaded structure's state.

## Risks / Trade-offs

- **[TED endpoint latency delays complete structure data]** → Start the optional request in parallel with existing structure work, cap it at five seconds, abort on timeout, and absorb failures into an empty list.
- **[Mol* global API changes]** → Keep all untyped CDN integration in `molstar-loader.ts`, pin the existing 3.44 version, and cover the adapter contract with focused tests.
- **[Residue numbering mismatch]** → Use `label_seq_id`, which matches AlphaFold model residue numbering and TED segment coordinates; color unmapped residues neutrally.
- **[More domains than palette colors]** → Cycle the fixed palette deterministically by domain number; distinct adjacent domains can repeat only after the palette is exhausted.

## Migration Plan

No data migration is required. Deploy the additive client change normally. Rollback consists of reverting the service field, adapter method, and component control; existing AlphaFold loading remains otherwise unchanged.

## Open Questions

None.
