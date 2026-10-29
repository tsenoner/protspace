## Why

Testing the ready examples in Colab showed three confusing spots. The FASTA example's CSV, left
in the custom-annotations field, applied to the Snake Toxin example with a warning about 13
unmatched IDs, and nothing beside Generate said a CSV was in use. The panel printed the annotation
cache's routine fill-in as a WARNING and a leftover `Missing annotations: set()` line. The EAT
cell's filter placeholders looked like values, so it was unclear what to type where.

## What Changes

- The line beside Generate names the custom-annotations CSV when one is set, and says how to
  leave it out.
- The panel retells the annotation cache's fill-in as an INFO line with the counts
  ("Fetching annotations for 4,456 of 5,015 proteins; the others were fetched by an earlier run
  in this runtime") and leaves out `Missing annotations: set()`.
- The EAT cell gets a **Load example filters: Swiss-Prot → TrEMBL** button: `protein_families`,
  queries `reviewed~TrEMBL`, references `reviewed~Swiss-Prot`. Without a `reviewed` column it
  says why and fills nothing.

## Capabilities

### Modified Capabilities

- `notebook-input-handling`: the Generate line names a custom CSV; routine package lines retold.
- `notebook-annotation-transfer`: example filters in the EAT cell.

## Impact

`ProtSpace_Preparation.ipynb`, `tests/test_notebooks.py`, `docs/guide/data-preparation.md`,
`apps/protspace/CLAUDE.md`. No package change.
