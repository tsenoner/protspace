## Why

Every HDF5 file without a root `model_name` attribute needs a `:name` suffix on the command line:
`protspace prepare -i seqs_esm2_650m.h5` stops with "HDF5 file has no 'model_name' attribute".
Only files written by `protspace embed`/`prepare` carry the attribute. The ones users actually
bring do not: the ClickThrough embeddings notebook writes none, nor do UniProt downloads or
custom scripts. A user with a single pLM asked why `:esm2_650m` is needed at all, and for one
input there is no good reason: the name only labels the projections.

The error is also wrong for most of the people who see it. Its fix hint always reads
`protspace prepare -i <file>:prot_t5 -o output`, whatever command was run (`project`, `stats`
and `transfer` print the same `prepare` line), and `prot_t5` mislabels an ESM2 file.

The name does matter in one case: with several `-i` inputs, the same name merges them (union of
proteins) and different names intersect them. That choice cannot be guessed from file names.

## What Changes

- Resolve an HDF5 input's embedding name in this order: explicit `file.h5:name` > root attribute
  `model_name` > a known model key in the file name (the keys of the projection display-name
  registry, matched as the whole stem or its trailing `_`-delimited tokens, longest first, so
  `seqs_esm2_650m.h5` and `esm2_650m.h5` are `esm2_650m`) > the file stem, **only when this is the
  command's single input**, with an info line saying so and how to override it.
- When several inputs remain unnamed after the first three rules, keep an error, and make it say
  why the name matters for that command (union vs intersection for `prepare`/`stats`; projection
  labels for `project`) and give an example for the command actually run, with the user's own
  paths and a `<model>` placeholder instead of `prot_t5`.
- `load_h5` itself applies the first three rules; the stem fallback and the multi-input error
  live in one resolver every CLI caller uses (`prepare`, `project`, `stats`, `transfer`).
- `stats` with a single input whose name was taken from the file name adopts the projections'
  source name when they come from exactly one embedding, so the embedding-space statistics are
  labelled like the bundle; it refuses with a message naming the sources when they come from
  several and none matches, instead of scoring every projection against the one embedding.
- `transfer -e` never needed the name (it only reads the vectors); it now works without one.
- Name the ClickThrough notebook's `esm3_open` key in the registry so its files resolve too.
- Docs: `docs/guide/python-cli.md` model-name section, input-flag rows and examples.

## Capabilities

### New Capabilities

- `embedding-name-resolution`: how an HDF5 input's embedding name is decided, when it may be
  inferred, and what a command says when it cannot be.

### Modified Capabilities

None.

## Impact

- Code: `apps/protspace/src/protspace/data/loaders/h5.py` (resolver), `embedding_set.py`
  (registry entry), `cli/prepare.py`, `cli/project.py`, `cli/stats.py`, `cli/transfer.py` (name
  resolution only).
- Behaviour: inputs that used to fail now run. A file that already carries `model_name` or that
  is named with `:name` resolves exactly as before. A file whose stem ends in a known key gets
  that key instead of an error.
- No bundle format, cache layout or dependency change. Projection caches stay keyed by the
  resolved name, so an inferred name is as stable as the file name.
- Release: `feat(cli)` under `apps/protspace/`, a minor version.
