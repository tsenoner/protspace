## Why

Two gaps the batch review of #406, #545 and #546 left open:

- #406 makes InterPro look up UniProt's canonical sequence before the FASTA's, which changes what
  a cached InterPro column means for a protein whose FASTA differs from the canonical sequence,
  but recorded no cache semantics change for it. A resumed run kept the FASTA-based result while
  a fresh run returned the canonical one.
- #546 shares the default numeric palette between Python and the web, but not the categorical
  one: `kellys` stayed a literal in both languages, where a change on one side would drift.

## What Changes

- Cache semantics version 4, not yet released, also covers every InterPro column, so caches
  written before it refetch InterPro once.
- `DEFAULT_CATEGORICAL_PALETTE_ID` joins `contracts/shared-constants.json`, validated to be a
  categorical palette id, and every default-palette literal in both languages reads it.

## Capabilities

### Modified Capabilities

- `annotation-cache-semantics`: InterPro columns cached before the canonical-sequence lookup are
  refreshed.
- `shared-constants`: the default categorical palette is a shared constant, and the generator
  checks it names a categorical palette.

## Impact

- `apps/protspace`: `encoding.py`'s cache table, the template and settings defaults of
  `protspace style`, and the statistics legend defaults.
- `packages/utils` and `packages/core`: the legend, the settings validator and the bundle
  readers' default colouring read the shared default.
- No bundle-layout or dependency change. A v3 cache refetches InterPro once.
