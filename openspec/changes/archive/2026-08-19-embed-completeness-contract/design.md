## Context

Two backends, two completeness rules. `biocentral.embed_sequences` raises when the
output HDF5 does not cover `remaining`; `local.embed_sequences` raises only when
the file is _entirely_ empty, and drops over-length and OOM sequences with a
`logger.warning` on the way. The tell that this was never designed is `local.py`'s
import line — it pulls `load_existing_ids` and `save_embeddings` **from
`biocentral.py`**. A shared layer already exists; it just lives inside one of its
two consumers, so the parts that were _not_ shared drifted.

The local backend is the default on Colab (`resolve_default_backend()` returns
`"local"` on any CUDA runtime), which is exactly where the hosted app sends users
when Biocentral is down.

## Goals / Non-Goals

**Goals.** One completeness rule for both backends. Distinguish a capability limit
from a failure. Make every run state what it skipped. Catch a FASTA that does not
cover the embeddings before it corrupts a projection.

**Non-Goals.** Making `base_processor`'s `np.allclose(np.diag(data), 1)` heuristic
robust (this change stops a partially-covered FASTA reaching it, nothing more).
Changing resume semantics for grouped third-party HDF5 files. Reconciling the
`sp|P12345|NAME` vs `P12345` key divergence between `embed` and `prepare` — the
coverage check normalises at comparison time instead.

## Decisions

### The shared layer is a new module, not `biocentral.py`

`data/embedding/store.py` holds `load_existing_ids`, `save_embeddings`,
`validate_headers`, and `finish_run`. Both backends import from it; neither
imports from the other. `biocentral.py` re-exports the two moved helpers so
existing importers (`local.py`, `cli/annotate.py`, tests) keep working.

_Alternative rejected:_ leave the helpers in `biocentral.py` and add `finish_run`
there. It preserves the exact inversion that caused the drift — the local backend
would depend on the remote backend for its definition of "done".

### `expected = requested − skipped`, and skipped is a `{id: reason}` map

A reason string, not a bare set, because the summary has to say _why_ — "3 skipped"
without "longer than max_length=2000 aa" is not actionable. The map is also what
lets one `finish_run` serve both backends: Biocentral passes an empty map.

GPU OOM at batch size 1 counts as a capability limit rather than a failure. It is
the same class as over-length — _this machine cannot do this sequence_ — and
failing on it would make a T4 Colab runtime unable to complete any dataset with
one large protein. The reason string distinguishes it from a length skip, and the
"skipping everything is still a failure" rule keeps a wholly-skipped run from
passing.

### The gate reads the file, never a counter

`save_embeddings` skips identifiers already present, and h5py silently turns an
identifier containing `/` into a group, so a running total can claim more than the
file holds. `missing = set(expected) - load_existing_ids(h5_path)` is an exact
predicate on the artifact.

_Alternative rejected:_ switch the gate to the loader's view (`_collect_datasets`
in `h5.py`, which walks one level of groups) so the check matches what `load_h5`
will later see. It is the more principled read, but it changes resume semantics —
a grouped third-party HDF5 would suddenly count as already-embedded — and it makes
the gate _pass_ on a corrupted `/` identifier, which is stored and reported under
its leaf name. That trade is only safe once nothing can write a `/` at all, which
is what the pre-flight rejection below establishes. Worth doing; not here. The two
views also disagree for identifiers nested two levels deep, which `_collect_datasets`
does not report at all.

### `validate_headers` runs before any work, on both backends

Moving it into the shared layer makes Biocentral fail up front instead of paying
for a full embedding run and then reporting a shortfall it cannot explain. This
changes an existing test that asserted the _post-hoc_ message for a `/`
identifier; the disk gate remains as the backstop and is tested directly by making
the writer under-deliver.

### The summary goes to stderr at warning level

The hosted prep service spawns the CLI with `stdout=DEVNULL, stderr=PIPE` and
keeps the last 50 stderr lines, and passes no `-v`, so `setup_logging` leaves the
threshold at WARNING. A summary written with `typer.echo`, or logged at INFO, is
invisible on the hosted path. `typer.echo` stays for the affirmative per-model
line only.

The same service classifies failures by substring-matching stderr against
`_BIOCENTRAL_DOWN_PATTERNS`. The new messages avoid every one of those substrings,
so a coverage problem is never re-tagged as an embedding-service outage and routed
to Colab, which would not fix it.

### The FASTA check is directional

`h5 − fasta` is the dangerous direction and the only one reported. `fasta − h5` is
routine: a resumed embedding cache legitimately covers fewer proteins than the
FASTA it was built from, and the extra entries are simply unused downstream.

Uncovered embeddings _fail_ under `-s/--similarity` and _warn_ otherwise. Failing
outright would break the legitimate case of deliberately projecting a subset;
warning alone would leave the MDS inversion shipping. This mirrors the shape the
codebase already uses for the multi-set case in `pipeline._validate_headers` —
raise on empty intersection, warn with a count on partial.

Both sides are normalised through `parse_identifier` because `load_h5` uses raw
HDF5 keys while FASTA-derived identifiers are always parsed; comparing them raw
would report every protein uncovered for any user-supplied `sp|…`-keyed file.

## Risks

- **Previously-passing local runs now fail.** Any dataset where the local backend
  dropped sequences _other_ than by length or OOM used to exit 0. That is the bug,
  but it is a behaviour change for anyone who had adapted to it.
- **The FASTA check fires on `-i x.h5 -f y.fasta` runs that work today.** It warns
  rather than fails except under `-s`, and `-f` is documented as similarity-only,
  so the blast radius is bounded — but a stale `-f` path that users had been
  passing harmlessly will now produce output.
- **`-f` is silently ignored for directory inputs** (`prepare` only attaches
  `fasta_path` in the single-file branch), so the check does not fire there. Left
  as-is; noted so the gap is not mistaken for coverage.
