## Context

`load_h5(files, name_override=None)` returns an `EmbeddingSet` whose `name` came from the
`:name` suffix or the HDF5 root attribute `model_name`, and raises otherwise. Its consumers:

- **Projection labels and sources** (`pipeline._run_reductions`, `cli/project.py`):
  `format_projection_name(name, …)` maps known keys to display names (`esm2_650m` →
  `ESM2-650M — UMAP 2`) and passes anything else through; `reduction["source"] = name`.
- **Combining inputs** (`merge_same_name_sets`, used by the pipeline and `stats`): equal names
  are unioned, different names are left for `_validate_headers` to intersect.
- **Projection cache** (`_projection_cache_path`): the name is part of the key and the file
  name; the data fingerprint is the rest. A stable name keeps hits stable.
- **`stats`** (`stats/driver._select_embedding`): matches each projection's stored `source` to
  an embedding by name, else uses the only embedding, else picks by id coverage. The
  embedding-space statistics are labelled with the name.
- **`transfer -e`**: builds `{id: vector}` and never reads the name.

## Goals / Non-Goals

**Goals:** a single unnamed input works everywhere; several unnamed inputs fail with the reason
and a correct example; nothing that resolved before resolves differently.

**Non-Goals:** guessing a model from vector dimensions (1024 is ProtT5 _and_ ProstT5 _and_
Ankh-Large); changing the multi-input union/intersection rule; removing or adding projection
methods; `project` merging same-name inputs (it does not today, and this change does not alter
that).

## Decisions

**1. Known keys come from `MODEL_DISPLAY_NAMES`, minus the similarity source.** It already is the
registry of names the projection labels understand, and lives beside the loader
(`loaders/embedding_set.py`); `EMBEDDER_MODELS` sits in `cli/common_options.py` and a loader must
not import the CLI. `MMseqs2` is excluded because it is a similarity matrix, never an HDF5 file.
A test pins every `EMBEDDER_MODELS` entry and every key the ClickThrough notebook writes to a key
the file-name rule recognises, which is why `esm3_open` joins the registry.

**2. File-name match: whole stem or trailing `_` tokens, longest first, case-insensitive.** The
ClickThrough notebook writes `{fasta_stem}_{short_key}.h5`; the prepare/embed cache writes
`{key}.h5`. Keys contain underscores (`esm2_650m`), so the candidates are the stem's trailing
1…n tokens, tried longest first, and the canonical (registry) spelling is returned. Leading or
middle tokens are not tried: `esm2_650m_vs_prot_t5.h5` names the last model, never the first.
A directory input matches when every file in it yields the same key, else by the directory's own
name.

**3. The stem fallback needs the command's whole input to be one HDF5 input.** Counting `-i`
items (FASTA included, for `prepare`) is exact: a FASTA input produces a named set, and an
unnamed HDF5 beside it would be unioned or intersected by a guess. `-f`/`-s` do not count; the
similarity set is always `MMseqs2`. `transfer -e` is always one input.

**4. One resolver, called before loading.** `resolve_input_names(specs, command=...)` returns
`(path, name, from_file_name)` per input and raises before any matrix is read, so a misnamed
multi-input run fails in milliseconds rather than after a 2 GB load. `load_h5` keeps the first
three rules (explicit, attribute, file name) and its own error, worded without a CLI command,
for Python callers; the CLI always hands it a name.

**5. The info line is the override instruction.** `No embedding name for x.h5 (no 'model_name'
attribute, no known model in the file name); using 'x'. To name it, append the model:
x.h5:<model>, e.g. x.h5:esm2_650m.` It names no flag, since `transfer` takes the file as `-e`.
A file-name match logs `Embedding name 'esm2_650m' taken from the file name x_esm2_650m.h5`.
Both are INFO, like `prepare`'s other inferred defaults, so they show at `-v`.

**6. `stats` adopts a single source only for file-name names.** An explicit or attribute name is
the user's statement and is left alone. A file-name name is a guess about a file whose
projections were labelled at build time, possibly under `:custom`. With one input and one
non-similarity source among the projections, the set takes that source's name (logged). With
several sources and no match, `_select_embedding` would score every projection against this one
embedding, so the command stops and names the sources. With a match, nothing changes.

**7. `transfer` needs no name.** It is resolved like any single input only so that `load_h5`
does not raise; no message is added.

## Risks / Trade-offs

- [A stem fallback name such as `data` reads poorly in projection labels] → the info line tells
  the user how to name it; a bad label is cheaper than a failed run.
- [A file named after one model but holding another's vectors] → the same risk as a wrong
  `:name`; the attribute and `:name` still win.
- [Two inputs, one named by its file name and one not] → still an error: half-named input is the
  ambiguous case.
