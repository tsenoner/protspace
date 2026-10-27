## Why

Only the Preparation panel's Example tab ran without the user's own data. The `.h5`, FASTA and
custom-annotation fields showed a placeholder path, the UniProt examples were text to copy, the
EAT filters showed a generic `column~text`, and the Embeddings notebook asked for a FASTA upload.
A first-time user had to bring a file before seeing what each field takes.

## What Changes

- The `.h5` and FASTA tabs get a **Use the example** button that puts an example file into the
  runtime and fills the path field with it, so the tab loads it as it would the user's own file.
  The `.h5` example is the Three-Finger Toxin ProtT5 file from the examples release. The FASTA
  example is 20 reviewed UniProt entries from each of three snake-venom families, fetched from
  UniProt.
- The FASTA example also writes a matching custom-annotations CSV (`venom_family`, the family
  each entry was fetched for). The CSV field's **Use the example** button fills it in, and its
  hint shows the format.
- A FASTA that loads shows its first header and the protein ID read from it.
- The UniProt tab's example queries become a picker that fills in the query and sets it.
- The EAT filters' placeholders show filters that work on a UniProt bundle
  (`reviewed~TrEMBL`, `reviewed~Swiss-Prot`).
- The Embeddings notebook runs on the same example FASTA when step 1 has no path, unless the new
  "upload my own FASTA" box is ticked.

## Capabilities

### Modified Capabilities

- `notebook-input-handling`: the Preparation panel offers an example for each input field.
- `notebook-embedding-generation`: the Embeddings notebook runs on an example FASTA by default.

## Impact

`ProtSpace_Preparation.ipynb`, `ClickThrough_GenerateEmbeddings.ipynb`, their tests, the
harness, `docs/guide/data-preparation.md` and `apps/protspace/CLAUDE.md`. No package change.
