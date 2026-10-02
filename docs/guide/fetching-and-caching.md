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
  Proteins with identical sequences are looked up once and all receive the result.

InterPro columns hold each member database's own matches. The InterPro API also returns matches
that InterPro-N, an AI model, predicts for those databases, without a score. ProtSpace leaves
them out, so a `pfam` value is always a Pfam match.

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

The cache is values **per identifier**, not per sequence. A sequence-dependent source (InterPro,
Biocentral) cached for `P12345` is reused for `P12345` even if the sequence behind that identifier
changed — for example when you switch from a full-length FASTA to one holding mature peptides. When
the sequences change, use a separate output directory, or add `--refetch interpro,biocentral`.

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
  fetch or an hour or more of TED lookups.
- If the cache already held values for the failed source, those values are kept as they were, next
  to the sources that completed. Proteins it held no value for are left out and fetched by the next
  run. When nothing else completed, the cache is left untouched.
- InterPro and Biocentral look proteins up by sequence, which comes from your FASTA or else from
  UniProt. If UniProt lost a batch and one of them had no sequence for a protein, that source counts
  as incomplete too, so its empty value is not cached as "no match". Supplying `-f` avoids this.
  A cache written for columns that need no sequence holds none, so a later run that asks for an
  InterPro or Biocentral column fetches the sequences from UniProt first; for Biocentral, a FASTA
  holding every sequence makes that unnecessary.

Either way the run still returns everything it did retrieve — your bundle is built, and the message
says which source was short.

### Each source is saved as it finishes

The sources are fetched one after another — UniProt, taxonomy, InterPro, TED, Biocentral — and at
Swiss-Prot scale each takes from half an hour (UniProt) to an hour or two (InterPro, TED). The
cache is therefore written after each source that was fetched, under the same rules as the final write,
not only at the end of the run. If the run crashes or is interrupted during TED, the UniProt and
InterPro results are already on disk and the next run fetches only TED.

Two rules keep these intermediate writes honest. A source still waiting its turn keeps whatever the
cache already held for it. And when a run adds proteins to an existing cache, their rows are written
only once every source the cache holds has filled them in, so an interrupted run never leaves a
half-annotated row that the next run would read as complete.

### Transient failures are retried first

Requests that time out, fail to connect, or return a retryable status (408, 425, 429, 500, 502,
503, 504) are retried with exponential backoff, honouring `Retry-After`. Only a request still failing
after several attempts counts as lost data. Any other status, such as `400` or `404`, is not retried
— asking again will not help. This covers the UniProt batches, the taxonomy lookups, the InterPro
match lookups (sent 100 sequences at a time) and the TED lookups.

This matters at scale: UniProt is queried 100 accessions at a time, so a Swiss-Prot-sized run is
thousands of sequential requests, and without retries a single blip would be near-certain. Sources
fetched one request per protein (TED) use a smaller retry budget, so a full outage does not multiply
the backoff by the number of proteins. Instead, TED retries every lookup that failed once more after
its first pass over all proteins, with the full retry budget, by which time a short outage has
usually passed; that final pass gives up after 10 failures in a row. InterPro likewise stops asking
after 10 batches in a row are lost, and counts the rest as lost rather than paying the backoff for
each of thousands of batches.

Biocentral predictions are requested in batches of at most 1,000 sequences and 200,000 residues
(its models fail on much larger requests). A batch that fails is split in half and each half sent
again, two levels deep; whatever still fails loses only its own proteins, and Biocentral stays out
of the cache, so the next run requests them again. Biocentral only predicts sequences of 7 to 5,000
residues and refuses a whole request holding any other, so shorter or longer sequences (short
venom peptides, titin) are never sent: their prediction columns stay empty, a warning gives how
many, and the rest of the source is cached as usual. UniProt's extra lookups for an inactive
accession (its replacement entry, or its sequence from UniParc) are single attempts too.

### Requests run in parallel, within limits

At Swiss-Prot scale TED is over half a million requests, one per protein, and InterPro about 5,000
batches. Both reuse their connections and keep a few requests in flight at once: TED up to 8
lookups, InterPro up to 4 batches. UniProt reuses its connection too, but sends one request at a
time. The results are exactly those of one request at a time, in the same order, and failures are
counted the same way; the "10 in a row" cut-offs above count in input order. A slow request, such as
a lookup that times out, holds up only itself: the other requests keep going while it runs.

The limits are deliberately modest, because these are shared public services, and they are not a
command-line option. When TED, InterPro or UniProt answers any request with `Retry-After`, every
request of that source waits until then, not only the one that received it. When a "10 in a row"
cut-off trips, or you interrupt the run, requests still in flight make no further attempt, so the
run stops once their current attempts end: at most one request timeout (10 s for TED, 30 s for
InterPro), usually far less.

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

## Annotating without `prepare`

`protspace annotate` fetches annotations on their own. By default it keeps no cache. With
`--cache-dir DIR` it reads and writes `DIR/all_annotations.parquet` under exactly the rules above,
so an interrupted run resumes when you repeat the command, and `--refetch` accepts the annotation
stages (`uniprot`, `taxonomy`, `interpro`, `ted`, `biocentral`, or `annotations`). Point it at a
`prepare` run's `{output}/tmp/` to reuse that run's annotations:

```bash
protspace annotate -i data.h5 -a default,interpro,ted -o annotations.parquet --cache-dir out/tmp
```

## Which UniProt release

Every UniProt response names the UniProtKB release its data came from. ProtSpace records it on the
annotation cache, and `run.log` gives it in a `uniprot_release:` line under `## Annotations`, for
annotations fetched in that run and for ones read from the cache alike. A cache filled in across
two releases lists both, and one written before releases were recorded reads `unknown`. A run whose
identifiers include no UniProt accession sends nothing to UniProt and reads `none`, as does a run
whose annotations come only from a CSV file.

## Legacy caches

Caches written by older versions are migrated when read, so you do not have to delete them:

- A cache that spelled an unassigned [TED domain](/guide/annotations#ted_domains) `unclassified` is
  rewritten in place to TED's `-`. No refetch needed.
- A cache written before [`xref_pdb`](/guide/annotations#xref_pdb) distinguished "no PDB structure"
  from "no UniProt entry" cannot be fixed in place. A run that surfaces the column refetches the
  UniProt source once and says which columns it is refreshing; other sources are reused. A run that
  does not ask for `xref_pdb` drops it instead, so a later run that does ask still migrates.
- A cache written before [`protein_families`](/guide/annotations#protein_families) kept family
  names whole (a name like `… (TC 3.A.3) family` used to be cut at its first `.`) is refreshed the
  same way, by refetching UniProt once when the column is requested.
- A cache written before InterPro values reached every protein sharing a sequence (only one protein
  of each identical-sequence group got them) refetches InterPro once when an InterPro column is
  requested. The refetch also drops the InterPro-N predictions that such a cache holds.
- A cache written before [`root`](/guide/annotations#root) became the top of the lineage (it held
  the deepest unranked clade, such as `melanogaster subgroup` for the fruit fly) refetches the
  taxonomy once when `root` is requested. A cache written before
  [`predicted_transmembrane`](/guide/annotations#predicted_transmembrane) spelled a negative
  prediction `non-transmembrane` (it wrote `none`, which displays as N/A) refetches Biocentral once
  when that column is requested. Other sources are reused, and a run that requests neither column
  drops it.

A refresh refetches the whole source: every column of it the cache holds, not only the ones the run
asks for, so the cache keeps them all and a later run asking for another one is still a cache hit.
The run returns only what it asked for. Refreshing `predicted_transmembrane` therefore also re-runs
the models behind any other Biocentral column the cache holds.

If such a refresh cannot retrieve the source, the old values are not stamped as current, and the
next run tries again. At Swiss-Prot scale the one-time refresh takes hours.

Going back to an older ProtSpace is not covered by this migration. Version 4.13 and earlier read a
cache this version wrote as current, but any run of theirs that fetches something passes the cached
`protein_families` through their first-family rule again, which corrupts the new values:
`CarA family|IC;CarB family|IC` becomes `CarA family|IC|IC`, and
`inositol 1,4,5-trisphosphate 5-phosphatase family|IEA` becomes `inositol 1|IEA`. After a
downgrade, delete `{output}/tmp/all_annotations.parquet` or run once with `--refetch uniprot`.

## Troubleshooting

**"All cached annotations are empty"** — the cache was probably built from identifiers UniProt does
not recognise. Supply the original FASTA with `-f` so the sequence-dependent sources can work, and
add `--refetch annotations`.

**Annotations are empty for some proteins only** — usually those specific identifiers are not in
UniProt. If a message said a source was incomplete, re-run: that source was deliberately not cached.

**A re-run refetches more than expected** — a source that did not complete on the previous run is
not in the cache, by design. A run whose input includes proteins the cache does not cover queries
each source for those proteins, and a cache written by an older version may refresh a source once
(see [Legacy caches](#legacy-caches)).

**Nothing is being cached** — check that `--keep-tmp` is on (it is by default) and that `{output}/`
is writable.

## See also

- [Using Python CLI](/guide/python-cli) — full flag reference
- [Annotation Reference](/guide/annotations) — every annotation, its source and format
