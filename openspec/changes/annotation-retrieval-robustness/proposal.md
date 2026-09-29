## Why

The manuscript's example datasets (Swiss-Prot 573K, human + fly 105K, β-lactamase 113K, venom
811, phosphatase 832, the ToxProt demo) have to be re-annotated with the current CLI, and
research on that rebuild found annotation bugs that lose data without saying so. Two of them are
already in the published bundles:

- **InterPro drops every protein whose sequence is identical to another protein's.** The
  retriever keeps one `md5 → identifier` entry per sequence (`interpro_retriever.py:163-171`),
  so only the last identifier of each group gets InterPro values. The others are cached as "no
  match". Measured on the shipped data: 88,238 Swiss-Prot rows (Pfam empty for 70.3 % of
  duplicated sequences against 5.5 % of unique ones), 3,698 β-lactamase rows and 1,228 human +
  fly rows.
- **The family parser cuts family names at the first `.`** (`uniprot_parser.py:335-340`). A
  name like `cation transport ATPase (P-type) (TC 3.A.3) family` becomes
  `cation transport ATPase (P-type) (TC 3` (9,090 Swiss-Prot entries). Multi-domain entries,
  whose UniProt text reads `In the N-terminal section; belongs to the X family`, yield a
  pseudo-family instead of X (4,688 entries). A second family in another section is dropped.
- **InterPro-N predictions leak into the member-database columns.** The InterPro Matches API now
  also returns AI-predicted InterPro-N matches under the name of the member library they predict.
  The retriever maps matches by library only, so they appear in `pfam`, `cdd` and the others as
  unscored hits, for about 3 % of Swiss-Prot proteins in `pfam`.

The rest make large runs unrecoverable or expensive to repeat:

- The InterPro match POST has no retry (`interpro_retriever.py:220`). One timeout among about
  4,900 Swiss-Prot batches marks the whole source incomplete, and the next run fetches it all
  again.
- Biocentral receives every unique sequence in one `predict` call (`biocentral_retriever.py:149`).
  The `_BATCH_SIZE = 1000` at line 26 is never used. At 100K+ sequences that single request is
  untested and likely to fail.
- One TED lookup that fails its two attempts marks the whole TED source incomplete. At Swiss-Prot
  scale TED is 18–40 h of sequential requests, so the next run starts TED from zero.
- The annotation cache is written once, after every source has finished (`manager.py:259-272`).
  A failure in hour 20 of TED also throws away the UniProt and InterPro results already fetched.
  `protspace annotate` has no cache at all.
- TED and InterPro are slow because of the client, not the servers: a new connection for every
  request, one request at a time. TED takes about 23 hours for Swiss-Prot and InterPro about 4.
  Over one reused connection pool, the same APIs answered 8 parallel TED lookups at 124 per second
  and 4 parallel InterPro batches at 92 sequences per second, without a single 429 or 5xx.
- `run.log` does not record which UniProt release the annotations came from. Without it, a
  rebuilt bundle's numbers cannot be traced back to a release.
- A bundle made by `protspace bundle`, `transfer` or the bundle API from a table that holds the
  internal lookup columns `organism_id` and `sequence` ships them to the web app. The venom
  bundle does, which is consistent with it having been bundled from the annotation cache.

## What Changes

- InterPro fans each distinct sequence's matches out to every protein with that sequence, and
  retries a match request that fails transiently before the batch counts as lost. It keeps
  member-database matches only and leaves InterPro-N predictions out.
- TED looks up 8 accessions at a time and InterPro sends 4 match batches at a time, each over one
  reused connection pool; UniProt reuses one connection. Values, their order and the failure
  accounting are unchanged, and a `Retry-After` pauses every request of the source. The limits are
  module constants, not flags.
- Biocentral sends predictions in batches of at most `_BATCH_SIZE` (1,000) unique sequences. A
  failed batch loses only its own proteins, sequences of any length are still sent, and the
  completeness messages keep the embed contract's rules (stderr, warning level, no substring the
  prep service reads as an outage).
- A TED lookup that fails in the first pass is retried once more after every other accession, with
  the normal retry budget. Only a lookup that still fails then makes the source incomplete.
- The family parser keeps names whole: only a `.` followed by whitespace or the end of the text
  ends a family name, and never one inside parentheses. It removes the `In the … section;`
  qualifier and emits each family of a multi-section entry, using the existing `;` multi-value
  convention.
- Caches written before these two fixes refresh their `protein_families` and InterPro columns
  once, through the existing cache-semantics version table, instead of serving the wrong values.
- The annotation cache is written after each source completes. A later failure no longer loses
  the sources that finished before it.
- `protspace annotate` gains `--cache-dir` and `--refetch`. With a cache directory it resumes
  exactly like `prepare`, and it can share `prepare`'s `{output}/tmp/` cache. Without the flag
  it behaves as it does today. **New flags, so `feat`.**
- `run.log` gains a `uniprot_release:` line, read from the `X-UniProt-Release` header of the
  UniProt calls the CLI already makes. The annotation cache records the release its UniProt
  values came from, so a staged run that serves UniProt from the cache still reports it.
- No bundle-writing path writes `organism_id` or `sequence` into a bundle. They are internal:
  `configuration.py` calls them fetched only to drive other lookups, `prepare` already strips
  them, and no web or Python consumer reads them. `annotate` still writes them to its own parquet
  when a user asks for them by name.

## Capabilities

### New Capabilities

- `annotation-source-retrieval`: how each annotation source turns a set of proteins into
  requests, and when a failed request is retried rather than counted as lost. Covers InterPro
  duplicate-sequence fan-out, retry and the InterPro-N filter, Biocentral batching, the TED final
  retry pass, and the connection reuse and bounded concurrency of TED, InterPro and UniProt.
- `annotation-release-provenance`: which UniProt release a run's annotations came from, as
  recorded in the annotation cache and in `run.log`.

### Modified Capabilities

- `annotation-cache-semantics`: the cache is persisted per completed source; `annotate` can
  resume from a cache directory; caches holding values from the old family parser or the old
  InterPro fan-out are refreshed.
- `uniprot-annotation-semantics`: `protein_families` keeps family names whole, takes the family
  of each section of a multi-section entry, and becomes multi-valued for those entries.
- `bundle-format-contract`: a bundle never carries the internal lookup columns.

`ted-domain-annotations` stays as it is. It specifies how TED domains are serialized, and the
retry pass changes only how they are fetched, which `annotation-source-retrieval` covers.

This change adds only requirements to capabilities that the in-progress `fix-cache-ownership`
change leaves alone, and does not touch that change's new `intermediate-cache-ownership`
requirements. Per-identifier fill-in is kept, and `annotate --cache-dir` inherits it.

## Impact

- **Code** (under `apps/protspace/src/protspace/`):
  - the retrievers `http_utils.py`, `interpro_retriever.py`, `biocentral_retriever.py`,
    `ted_retriever.py` and `uniprot_retriever.py` in `data/annotations/retrievers/`;
  - `data/parsers/uniprot_parser.py`, `data/annotations/transformers/uniprot_transforms.py`,
    `data/annotations/encoding.py`, `data/io/bundle.py`;
  - `data/annotations/manager.py`, a new shared cache module under `data/annotations/`,
    `data/processors/pipeline.py`;
  - `cli/annotate.py`, `cli/prepare.py`, `cli/common_options.py`.
- **Behaviour users see:**
  - Duplicate-sequence proteins gain InterPro values, and InterPro-N predictions leave the
    InterPro columns.
  - At Swiss-Prot scale TED takes about 1.5 hours instead of a day, and InterPro about 1.5 hours
    instead of 4.
  - About 2 % of Swiss-Prot entries get corrected family names, and multi-section entries become
    multi-valued in `protein_families`.
  - A legacy cache refreshes UniProt and InterPro once, and only when the run requests those
    columns.
  - New `annotate` flags and a new `run.log` line.
  - Bundles lose the internal columns.
- **Release:** `fix(protspace)`, `perf(protspace)` and `feat(protspace)` commits, so this is a
  minor release of the PyPI package. No bundle format version change, no dependency change, no
  web reader change.
- **Docs:** `docs/guide/python-cli.md`, `docs/guide/fetching-and-caching.md`, and the
  `protein_families` entry and InterPro source text of the annotation docs, from which
  `docs/guide/annotations.md` is generated. The Colab notebooks restate none of the changed behaviour today, which the
  integration step checks again.
- **Downstream:** the example-dataset rebuild (PLAN Change B, phase B3) waits for this change to
  merge.
