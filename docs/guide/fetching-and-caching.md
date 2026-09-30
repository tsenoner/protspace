# Fetching & Caching

`protspace prepare` does three expensive things — embedding sequences, fetching annotations from
public APIs, and computing projections — and caches each so a second run does not repeat them. This
page explains what is fetched, what is stored, when a cached value is reused, and how to force a
refresh.

If you only want the short version: **re-running `prepare` with the same output directory is cheap
and safe.** It reuses what it can, fetches what it cannot, and never silently reuses data that came
back incomplete.

## What gets fetched

Annotations come from five independent sources. Only the first is used by default.

| Source         | Provides                                                     | Needs                      |
| -------------- | ------------------------------------------------------------ | -------------------------- |
| **UniProt**    | `length`, `ec`, `keyword`, `protein_families`, `reviewed`, … | a UniProt accession        |
| **Taxonomy**   | `kingdom`, `phylum`, `class`, … (9 ranks)                    | `organism_id` from UniProt |
| **InterPro**   | `pfam`, `cath`, `superfamily`, … (9 databases)               | the protein sequence       |
| **TED**        | `ted_domains` (structure-based domains)                      | a UniProt accession        |
| **Biocentral** | predicted localization, membrane, signal peptide, …          | the protein sequence       |

Two consequences follow from the "Needs" column:

- **Accession-dependent sources need real UniProt accessions.** If your HDF5 keys are custom IDs
  (`NCBI|...`, `my_protein_042`), those annotations come back empty. That is a property of your
  identifiers, not a failure.
- **Sequence-dependent sources work with any identifier**, as long as ProtSpace can find the
  sequence — pass the original FASTA with `-f` and it will use that instead of asking UniProt.

`length` is a special case: when UniProt has no length for a protein but a matching FASTA sequence
is available, ProtSpace counts the residues itself (`*` terminators and `-` gaps do not count). A
length that UniProt _does_ provide always wins.

## What gets cached

With `--keep-tmp` (**the default**), everything expensive lands in `{output}/tmp/`:

| Cached item       | File                                    | Saves you                      |
| ----------------- | --------------------------------------- | ------------------------------ |
| FASTA sequences   | `queries/{query hash}.fasta`            | re-downloading a UniProt query |
| Embeddings        | `{embedder}.h5`                         | re-embedding proteins          |
| Annotations       | `all_annotations.parquet`               | re-querying the APIs           |
| Similarity matrix | `similarity_matrix.npy`                 | re-running MMseqs2             |
| DR projections    | `proj_{name}_{method}{dims}_{hash}.npz` | recomputing UMAP/PaCMAP/…      |

Every entry is owned by what produced it, so reuse can only ever be reuse of your own work:

- **Query FASTA** by the exact query text, so a second query in the same `-o` downloads its own
  sequences.
- **Embeddings** per protein _and_ per residue: a protein whose sequence changed under an unchanged
  identifier is embedded again, and the file records which backend and model wrote it (see
  [below](#embeddings-belong-to-one-backend-and-model)). Adding sequences to an existing run still
  only embeds the new ones.
- **Projections** by the embedding matrix, the identifier order, the method, the dimensions and
  every reducer parameter. Changing a slider computes one new file and leaves the others alone;
  re-running an input that changed under the same name recomputes rather than returning the earlier
  coordinates.
- **Annotations** per identifier and per column — the next section.

## How the annotation cache decides

This is the part worth understanding, because it explains most "why didn't it refetch?" questions.

The cache is judged **by column and by row**. ProtSpace compares what you asked for against what
`all_annotations.parquet` holds:

- **Every column present, every protein present** → the cache is used as-is, and no API is called.
- **Some column missing** → only the sources owning the missing columns are queried; cached columns
  from other sources are reused.
- **Some protein missing** → each source is queried for exactly those proteins, and cached values
  serve the rest. Taxonomy is looked up only for organisms the cache has not resolved before.

So asking for a new annotation is cheap, asking for the same ones again is free, and adding a
handful of proteins to a large run costs a handful of lookups rather than a full refetch.

A cache holding _more_ proteins than the current run is fine: the extra rows are filtered out of the
bundle, and a run for part of a dataset keeps them rather than replacing the cache with its own
subset.

The consequence of column-level granularity is that an **empty value is not a signal**. A protein
with an empty `ec` may have no EC number, may not be in UniProt at all, or may be a custom
identifier — all three look identical once stored. That is why the rules below exist.

### Incomplete fetches are not cached

If a source does not finish — an API is down, a request keeps failing — the proteins it covers get
empty values. Those are indistinguishable from genuine absences, so caching them would make every
later run reuse the gaps instead of retrying.

ProtSpace therefore **caches only the sources that completed**:

- A source that failed is left out of the cache, so the next run fetches it again.
- Sources that succeeded are still cached, so one flaky API does not throw away an expensive UniProt
  fetch.
- If leaving it out would mean overwriting an existing cache with _fewer_ columns, the existing
  cache is kept untouched instead — unless that cache covers other proteins, in which case the
  sources that completed replace it.

Either way the run still returns everything it did retrieve — your bundle is built, and the message
says which source was short.

### Transient failures are retried first

Requests that time out, fail to connect, or return a retryable status (429, 503, …) are retried with
exponential backoff, honouring `Retry-After`. Only a request still failing after several attempts
counts as lost data. A malformed request (`400`, `404`) is not retried — asking again will not help.

This matters at scale: UniProt is queried 100 accessions at a time, so a Swiss-Prot-sized run is
thousands of sequential requests, and without retries a single blip would be near-certain. Sources
fetched one request per protein (TED) use a smaller retry budget, so a full outage does not multiply
the backoff by the number of proteins.

## Embeddings belong to one backend and model

An HDF5 records the backend and model that produced it. Both backends resume by identifier, so
without that record a run with `--backend local` would resume from vectors the Biocentral API wrote
and silently mix two embedding spaces in one dataset. A run that points at another producer's file
stops and names your options: select that backend, choose another output, or `--refetch embed`.

Files written before this existed carry no record; they are adopted, stamped and reported the first
time a run resumes from them.

## Forcing a refresh

`--refetch` recomputes specific stages, comma-separated:

```bash
protspace prepare -i data.h5 -o out --refetch annotations   # every annotation source
protspace prepare -i data.h5 -o out --refetch uniprot,ted   # just these two
protspace prepare -i data.h5 -o out --refetch projections   # recompute UMAP/PaCMAP
protspace prepare -i data.h5 -o out --refetch all           # everything
```

Stages: `query`, `embed`, `similarity`, `projections`, `uniprot`, `taxonomy`, `interpro`, `ted`,
`biocentral`. Shorthands: `all`, `annotations`.

`--refetch annotations` is also the **repair path**. If a cache already holds empty values — from an
older ProtSpace version, or a run made before you supplied `-f` — a refetch replaces them with what
it retrieves. If it still cannot retrieve a source, it removes that source's columns from the cache
rather than leaving the old values in place, so the next run fetches them instead of trusting them.

To skip caching altogether, pass `--no-keep-tmp`. Nothing is written to `{output}/tmp/`, and every
run starts from scratch.

## Legacy caches

Caches written by older versions are migrated when read, so you do not have to delete them:

- A cache that spelled an unassigned [TED domain](/guide/annotations#ted_domains) `unclassified` is
  rewritten in place to TED's `-`. No refetch needed.
- A cache written before [`xref_pdb`](/guide/annotations#xref_pdb) distinguished "no PDB structure"
  from "no UniProt entry" cannot be fixed in place. A run that surfaces the column refetches the
  UniProt source once and says which columns it is refreshing; other sources are reused. A run that
  does not ask for `xref_pdb` drops it instead, so a later run that does ask still migrates.

## Troubleshooting

**"All cached annotations are empty"** — the cache was probably built from identifiers UniProt does
not recognise. Supply the original FASTA with `-f` so the sequence-dependent sources can work, and
add `--refetch annotations`.

**Annotations are empty for some proteins only** — usually those specific identifiers are not in
UniProt. If a message said a source was incomplete, re-run: that source was deliberately not cached.

**A re-run refetches more than expected** — a source that did not complete on the previous run is
not in the cache, by design. A run whose input includes proteins the cache does not cover also
rebuilds every annotation for that input.

**Nothing is being cached** — check that `--keep-tmp` is on (it is by default) and that `{output}/`
is writable.

## See also

- [Using Python CLI](/guide/python-cli) — full flag reference
- [Annotation Reference](/guide/annotations) — every annotation, its source and format
