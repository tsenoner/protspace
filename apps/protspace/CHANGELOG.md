# CHANGELOG


## v4.7.0 (2026-07-13)

### Fixes

* fix(annotations): keep every hit of a multi-hit scored cell at display

`to_display_value` trimmed the `|score`/`|evidence` suffix with a single
`raw.split("|", 1)[0]` on the whole cell. In a multi-hit cell the first hit's
`|` precedes the `;` separators, so everything after the first hit was dropped:
`"apoptotic process|IDA;signal transduction|IEA"` collapsed to
`"apoptotic process"`. This silently lost hits 2+ for every common multi-value
scored annotation (GO bp/mf/cc, InterPro, TED, multi-EC) in the Dash `serve`
plot/legend, and desynced it from the `;`-splitting style template.

Trim the suffix per hit (after the `;` split), then re-join with `;`, so the
whole multi-hit cell stays one score-stripped/decoded category
(`"A|0.9;B|0.8"` → `"A;B"`). Single-hit and `--no-scores` cells are unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`ded3737`](https://github.com/tsenoner/protspace/commit/ded373746e547eec6f878e2670e9e78b1598d883))

* fix(transfer): re-stamp bundle format version when replacing annotations

`replace_annotations_in_bundle` wrote the new annotations table without a
format-version stamp. `transfer` (and the prediction overlay) build that table
via `rename_columns`/concat, which drop pyarrow schema metadata — so running
`protspace transfer` on a v2 bundle emitted an unstamped annotations part.
Consumers that gate decoding on `protspace_format_version` (the hyparquet
frontend, Dash `serve`) then read it as v1 and render the transferred,
already-encoded names with raw `%XX` escapes.

Stamp at the single annotations-write chokepoint so no caller has to remember
(same unconditional-v2 trust boundary as `cli/bundle`). Covered by
test_replace_annotations_in_bundle_restamps_format_version.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`5bfcc37`](https://github.com/tsenoner/protspace/commit/5bfcc371f9f61d37c4b8ba10244426ce20c4a6db))

* fix(style): key annotation styles by display value, not raw wire cell

`generate_template` lists decoded display values, but `add_annotation_styles_*`
validated and stored color/shape keys against the raw percent-encoded cells
(`get_all_annotation_values`). For a v2 name containing `;`/`|`/`%` the two
diverged, so a styles file built from the template raised "Value ... does not
exist" and could not round-trip.

Both style paths (parquet dir + bundle) now validate/store against the
annotation's display values via a shared `_annotation_display_values` helper —
the same `_to_display_value` transform the template uses — so keys match what
the template exposes and what the plot/legend groups by. NA-like labels carry
no reserved char and pass through unchanged, so NA handling is unaffected.

Docs: note in styling.md that value keys are display values; tests cover the
template→style round-trip for an encoded name on both the parquet and bundle
paths.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`c6ec8e5`](https://github.com/tsenoner/protspace/commit/c6ec8e50d400d21805d95bf347f1b5fe9831a178))

### Refactoring

* refactor(annotations): simplify v2 encoding/display internals from review

Quality cleanups from the /simplify pass (no behavior change):

- `encode_field` uses a `str.maketrans` table (single C-level pass) instead of
  a guard + per-char `dict.get` join; drop the now-redundant `not s` in
  `decode_field`'s guard (`"%" not in ""` is already True).
- Centralize the v2 decode gate as `ArrowReader.should_decode()` (uses the
  `BUNDLE_FORMAT_VERSION` constant), replacing the five copy-pasted
  `get_format_version() >= 2` literals across plotting/callbacks/style.
- `add_annotation_styles_bundle`: hoist the single `compute_value_frequencies`
  scan and reuse its keys for validation, dropping a second full-protein
  scan+decode per styled annotation.
- Drop the dead `if raw is None` branch in `_read_format_version` (`int(None)`
  is already caught).
- Correct the `to_display_value` docstring: it's the shared per-hit transform;
  the `;` multi-label split is layered on only by the style template.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`47d3617`](https://github.com/tsenoner/protspace/commit/47d36178d087284b7c5aa73cdd111b6f8b479430))

### Unknown

* Merge pull request #66 from tsenoner/feat/annotation-encoding-v2

feat: bundle format v2 — lossless annotation name encoding (#56, #57, #58) ([`005d056`](https://github.com/tsenoner/protspace/commit/005d0562264dd3e13db1927856b47db7ca29552b))

* Merge remote-tracking branch 'origin/main' into feat/annotation-encoding-v2 ([`9133174`](https://github.com/tsenoner/protspace/commit/9133174acff5d87e29c35f309c26cc404dc9a079))


## v4.6.0 (2026-07-13)

### Chores

* chore(transfer): sync protlabel to 4.5.0 for lock-step release

protlabel/pyproject.toml was initialized at 4.4.0 while protspace is at
4.5.0. CLAUDE.md requires the two distributions to version in lock-step
(python-semantic-release manages both via version_toml). Bump protlabel
to 4.5.0 and regenerate uv.lock to match.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`c6080b8`](https://github.com/tsenoner/protspace/commit/c6080b838e84a9923912535b6afb84e0af74859a))

* chore(transfer): drop unused MagicMock import in test_base_data_processor

Leftover from main's mock-based test_save_output_bundled variant, which the
merge resolution discarded in favour of this branch's real-bundle integration
test. No remaining reference to MagicMock in the file.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`ea10ba7`](https://github.com/tsenoner/protspace/commit/ea10ba7288f87156e8b0fe79bd1bf8655f323604))

* chore(transfer): drop lingering scipy mentions from protlabel after dependency removal

The scipy dependency was removed earlier; backends.py and a test comment still
named scipy.cdist as the comparison baseline. Reword to neutral phrasing so no
scipy reference remains in the tree (the kNN path is pure numpy).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`bb0cfc2`](https://github.com/tsenoner/protspace/commit/bb0cfc2f3b87a370525951d564fae1c317d4b3ab))

* chore(docs): remove EAT build plan + superseded draft; keep design spec ([`98b42f6`](https://github.com/tsenoner/protspace/commit/98b42f664869a8af082aa5652aeda5e95e955b3d))

* chore(protlabel): scaffold EAT engine package + scipy dep

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`70881d7`](https://github.com/tsenoner/protspace/commit/70881d7b9992de29ad3b37c14ea09af48d4b060a))

* chore(docs): add EAT annotation-transfer design spec + backend implementation plan ([`355cd3f`](https://github.com/tsenoner/protspace/commit/355cd3fbc7bd4f843a9ccbed1a5fd186acadd24a))

### Documentation

* docs(transfer): broaden kNN benchmark to 5 pLM dims (ESMC-300M/600M, ESM2-650M)

Add the embedding sizes ProtSpace actually serves so the scaling study is
representative rather than anchored on two dims: grid dim is now
{960, 1024, 1152, 1280, 2560} = ESMC-300M, ProtT5, ESMC-600M, ESM2-650M, ESM2-3B.

Re-ran bench_knn.py on the same Apple M4 Pro and rewrote the research doc's
results table (30 rows) and every derived figure: build-repayment (~40k queries
to repay the 37.5 s build at 100K x 1024), scaling (0.046 -> 0.117 -> 1.093 ms
at 1024; 0.116 -> 0.202 -> 1.720 at 2560; the mid dims interpolate), Swiss-Prot
extrapolation (~6 ms at 1024, ~10 ms at 2560), per-query speedup (~6-7x at 100K),
and the ef=64 recall range (0.02-0.93). Conclusion is unchanged: exact
brute-force wins end-to-end at every grid point with recall 1.0.

Also fixes two stale figures the re-review verification flagged: the recall
range and the "~5-6x" speedup were left over from the earlier dim set.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`87c6fcb`](https://github.com/tsenoner/protspace/commit/87c6fcb4158d29449e93c8421da443d7bcf11a88))

* docs: slim the protlabel uv-workspace section in CLAUDE.md

Compress the EAT-engine section from ~24 lines (full ASCII tree + verbatim
[tool.uv.sources] snippet + prose) to a tight paragraph that keeps the
navigational essentials: it's a numpy-only workspace member, the boundary is
test-enforced, the module map, and the protspace-side glue files. Addresses
the review note that the section was context bloat.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`9a610ca`](https://github.com/tsenoner/protspace/commit/9a610cae799e9bb9ff4e6da874962e622e7e0ad5))

* docs(transfer): benchmark pLM-relevant dims (1024/2560), drop ESM2-8M's 320

The kNN scaling study benched dim 320 (ESM2-8M), a model too small to be used
for real annotation transfer, which diluted the results. Swap the grid to
1024 (ProtT5, the transfer default) and 2560 (ESM2-3B, the large-model /
memory-ceiling case the doc already reasons about).

Re-ran bench_knn.py on the same Apple M4 Pro and refreshed the research doc:
the results table, the build-repayment and scaling numbers, and the recall
caveat (fresh 10K x 1024 ef-sweep: recall@1 0.33 -> 0.69 -> 0.98; 1st-2nd gap
~0.008). Conclusion is unchanged: exact brute-force wins end-to-end at every
grid point, recall stays 1.0, and it fits the 4 GB target at dim 1024.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`862b6b8`](https://github.com/tsenoner/protspace/commit/862b6b8f0e1f0b19626e1ac438abd61f3e564276))

* docs(transfer): design for EAT visualization — source overlay + frontend spec

Captures the Wed 2026-07-01 EAT UX decisions: re-add COL__pred_source as
provenance (dashed connector line + tooltip, not a colour feature), keep
predictions inline under a reserved __pred_ namespace (no bundle-format
change), confidence as a selectable numeric annotation, and the answer to
the DR question (queries are part of the joint DR). Doubles as the source
for the protspace_web issues (#277 update + new provenance-lines issue).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ce7cd5a`](https://github.com/tsenoner/protspace/commit/ce7cd5a39b6d000b6646852611cc53ebf8e4fff0))

* docs(transfer): add usearch-vs-brute-force kNN scaling study + reproducible benchmark

Substantiates the brute-force-default decision (PR #55 review): an empirical
benchmark (packages/protlabel/benchmarks/bench_knn.py) of protlabel's exact
chunked-GEMM kNN vs usearch HNSW across n_refs {1K,10K,100K} x dim {320,1024},
plus literature context and a recommendation.

Finding: brute-force wins end-to-end for protspace transfer's one-shot/batch
usage (exact, no build, sub-ms to low-ms/query through Swiss-Prot scale). usearch
only pays off for a persisted index reused across tens of thousands of queries,
or as a memory lever (i8/f16 quantization) at full Swiss-Prot on a 4GB box.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`a7792de`](https://github.com/tsenoner/protspace/commit/a7792dec0254c3f994a08132dce155a1f39c338c))

* docs: correct transfer --metric options (euclidean, cosine only) ([`21d508c`](https://github.com/tsenoner/protspace/commit/21d508ceef7de14c457f78fd183fc834f8cce24f))

* docs: document protspace transfer + prediction overlay columns

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`0ee1354`](https://github.com/tsenoner/protspace/commit/0ee1354d28a3d29f68484848e72984708bc9fc61))

* docs(annotations): document bundle format v2 encoding contract ([`13e0351`](https://github.com/tsenoner/protspace/commit/13e0351045339b0182894b1dc48ef5f1f9b57445))

* docs(annotations): implementation plans for bundle format v2 (backend + frontend)

TDD, task-by-task plans covering the shared percent-codec, all backend emit
sites, #57 unnamed-superfamily fix, version stamp/detection, frontend v2 decode
branch, and the cross-repo golden-fixture proof.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`baa766b`](https://github.com/tsenoner/protspace/commit/baa766b37ea8463dcdc8b645140ce12bacee353d))

* docs(annotations): resolve v2 spec open items (version location + lossy export)

- §5: format_version lives in parquet file-level key-value metadata; verified
  end-to-end on pyarrow 20.0.0 (write) + hyparquet 1.26.0 (read).
- §7: pre-existing lossy frontend export filed as protspace_web#303 (project
  status Ready), out of scope for this change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`70a1235`](https://github.com/tsenoner/protspace/commit/70a1235c6d8e5cc15c7addd11ed8fa3e6efc3a47))

* docs(annotations): design for bundle format v2 name encoding (#56/#57/#58)

Percent-encode a minimal reserved set (% ; | + control chars) inside a
versioned flat STRING annotation cell; drop the fragile paren-depth/pipe
heuristics; label unnamed CATH superfamilies by bare code (drop parent-
topology inheritance). Backed by a deep-research pass + corpus scan +
cross-repo code maps.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`0c641f9`](https://github.com/tsenoner/protspace/commit/0c641f93129c7a7a87a9d88937a9524416196d00))

### Features

* feat(transfer): emit COL__pred_source provenance column in EAT overlay

Re-add the reference protein id each label was transferred from
(Prediction.source_id) as a third per-cell overlay column, COL__pred_source,
alongside COL__pred_value and COL__pred_confidence. PR #55 review dropped it as
"noise for colouring"; the web EAT UX (connector line to the source, "transferred
from <neighbour>" tooltip) needs it back as provenance — explicitly not a colour
feature. The frontend reserves the __pred_ namespace and keeps these columns out
of the annotation dropdown.

- predictions.add_overlay_columns: write COL__pred_source (str, null for
  non-predicted), replaced-not-duplicated on re-run.
- tests: assert source present + aligned to the reference id (was: absent).
- docs (annotations.md, cli.md), transfer notebook, and the EAT design spec
  updated to describe three overlay columns.

Design: docs/superpowers/specs/2026-07-04-eat-visualization-overlay-design.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ac7d9d8`](https://github.com/tsenoner/protspace/commit/ac7d9d817f96b3f7f1f9d96e201391c88e2d8ae7))

* feat(transfer): warn on zero transfers; validate --metric/--k early

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`a05e977`](https://github.com/tsenoner/protspace/commit/a05e977f051b5743bc290068f96c64c2116335d4))

* feat: add 'protspace transfer' annotation-transfer subcommand

Implements Task 9: the EAT orchestration core (run_transfer) and the
'protspace transfer' Typer CLI command, wiring classification, nearest-
neighbour lookup (protlabel.eat), and overlay-column writing into a single
pipeline for filling missing annotation values from pLM embedding space.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`c9cae3f`](https://github.com/tsenoner/protspace/commit/c9cae3f537ec431108189f8121cbf0eb5bfe9e50))

* feat: replace annotations part of a parquetbundle in place

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`5093f66`](https://github.com/tsenoner/protspace/commit/5093f6653841c4800ed7238f6818a86e022cdb1d))

* feat: build per-cell prediction overlay columns

Add `add_overlay_columns()` in `src/protspace/data/io/predictions.py`
that appends three aligned Arrow columns (`COL__pred_value`,
`COL__pred_confidence`, `COL__pred_source`) from a list of
`protlabel.Prediction` objects, leaving the curated column untouched.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`94b4f0f`](https://github.com/tsenoner/protspace/commit/94b4f0fe0885d12b059dbd5cc45561f24d58ed37))

* feat: query/reference classifier for annotation transfer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`ae7fcc2`](https://github.com/tsenoner/protspace/commit/ae7fcc23011e69a40dc81ef2aec4a1093ce66549))

* feat(protlabel): persistable Lookup sidecar + public API

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`796e5b1`](https://github.com/tsenoner/protspace/commit/796e5b1f51c485bc16f087ef0a5bc39e01024522))

* feat(protlabel): kNN label transfer with reliability index

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`c07aef5`](https://github.com/tsenoner/protspace/commit/c07aef544315d99fe34b8fa2e2b177f691ff64d9))

* feat(protlabel): chunked brute-force kNN backend

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`4e99e8d`](https://github.com/tsenoner/protspace/commit/4e99e8d6f88f9259a54bf791f55eaec845a14fef))

* feat(protlabel): goPredSim reliability index transform

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`ee482ba`](https://github.com/tsenoner/protspace/commit/ee482ba37191ad4dd9f675440ab2c442713de385))

* feat(style): decode v2-encoded names for backend display

_to_display_value now decode_field()s each ;-split/|-trimmed part so
percent-encoded characters (%3B, etc.) from bundle format v2 render as
literal text in the Dash style/serve display path. The bundle on disk
stays encoded; only display decodes. compute_value_frequencies already
delegates to _to_display_value so it picks up decoding for free.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`b7a5849`](https://github.com/tsenoner/protspace/commit/b7a5849552a9c6c9c87295a38f87efbf59ca2a11))

* feat(bundle): stamp format_version=2 in annotations parquet key-value metadata

Wraps BaseProcessor._create_protein_annotations_table's output and the
standalone `protspace bundle` subcommand's annotations table with
stamp_format_version() so both write paths emit protspace_format_version=2 /
protspace_encoding=pct as parquet footer key-value metadata.

Found and fixed along the way: pa.Table.rename_columns() drops schema
metadata, so in cli/bundle.py the stamp must be applied after the
identifier->protein_id rename, not before. ([`b541a27`](https://github.com/tsenoner/protspace/commit/b541a27e5407e8dfa4900097fa3b1b5859f577a9))

* feat(annotations): percent-encode EC + Pfam-clan names at emit

Wrap EC enzyme names and Pfam clan names in encode_field() at their
emit sites to percent-encode reserved structural chars (;|%) that would
corrupt the bundle cell grammar. Tests verify that pipes and semicolons
are encoded (e.g., "Name|with;reserved" → "Name%7Cwith%3Breserved").

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`229013b`](https://github.com/tsenoner/protspace/commit/229013b8fc302a2fe47945bf038149aadb578ce4))

* feat(annotations): percent-encode UniProt keyword/subcellular/family/GO names

Reserved chars (%;|control) inside free-text keyword names, subcellular
locations, protein family descriptions, and GO term labels corrupted the
`;`/`|`-delimited cell grammar. Wrap each emit point in UniProtEntry with
encode_field so names round-trip losslessly via decode_field. ([`fc10103`](https://github.com/tsenoner/protspace/commit/fc101037d4190f0c68af0e067965a0647ac42c3b))

* feat(annotations): percent-encode TED domain names at emit

Wrap the TED domain human-readable `name` in `encode_field` before assembling
`ted_domains` cells, matching Task C1's InterPro CATH fix. Names from the CATH
names file can contain `;` (the domain hit-separator), which corrupted the
`;`-joined cell grammar without encoding.

Test drives the real fetch_annotations -> _format_domains -> _resolve_cath_name
path with get_cath_names mocked to return a `;`-bearing name, asserting the
emitted string encodes it (%3B present, no raw `;`) and decode_field restores
the original — a bare encode_field() call would not catch a reverted wrap. ([`f7f20ef`](https://github.com/tsenoner/protspace/commit/f7f20efc0ec682fccbc2f4633d1b018a26d662be))

* feat(annotations): percent-encode InterPro entry names at emit (#56/#58)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d40eaac`](https://github.com/tsenoner/protspace/commit/d40eaac3d47a6474766604d118aa1664653ae5d4))

* feat(annotations): add v2 percent-encoding codec + version stamp helper ([`b286f25`](https://github.com/tsenoner/protspace/commit/b286f2569f57993858b1c48522406acbe0460365))

### Fixes

* fix(transfer): correctness fixes from review

- cli/transfer._is_missing: reuse the shared MISSING_VALUE_TOKENS instead of
  a bare `== ""` check. A real float NaN in a numeric target column
  (str(nan) == "nan") was treated as present, so NaN queries got no
  prediction and NaN references were transferred as the literal label "nan".
- protlabel/transfer.eat: break exact-distance ties on the lexically
  smallest source id, so the reported provenance (source_id) no longer
  depends on the arbitrary argsort order of equidistant references —
  matching the docstring's order-independence claim.
- protlabel/backends.nearest: raise a clear ValueError on an empty reference
  set instead of a cryptic argpartition(kth=-1) crash for direct callers.
- protlabel/lookup: use np.asarray, not astype, so save/load don't copy an
  already-float32 embedding matrix (multi-GB at Swiss-Prot scale).

Also folds in the related cleanup that touches the same files: validate
--metric against the shared METRIC_TYPES constant instead of a bare literal;
thread the full-table and embedded identifier lists through run_transfer so
they are materialized once rather than per transfer column; hoist the
per-chunk row index out of the nearest() loop.

Adds regression tests for NaN-as-missing and deterministic source_id.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`5c2c479`](https://github.com/tsenoner/protspace/commit/5c2c479980060b1001aab36b1ee30b05f7a34188))

* fix(transfer): bound the float64 rerank pool by max_block_bytes

The candidate over-fetch (previous commit) widened the float64 rerank tensors
to (eff_chunk, k_pool, d), whose size scales with the embedding dim d. But
eff_chunk was sized only against the (eff_chunk, n_refs) distance block, so for
a small reference set (block budget never shrinks the chunk) queried by many
high-dim vectors — e.g. a curated ~800-ref set, 2048 queries, ESM2-3B d=2560 —
the rerank peaked at ~1.4 GB for an 8 MB reference matrix, contradicting the
module's laptop-feasible memory promise. Correctness was unaffected.

Cap eff_chunk against the rerank footprint (k_pool * d * ~24 B/query-row) as
well, so both per-chunk tensors stay within max_block_bytes. The Swiss-Prot
case is unchanged (still block-bound at eff_chunk 58); the fix only shrinks the
chunk where the rerank would otherwise dominate. Adds a tracemalloc regression
test (peak now ~170 MB, was ~1.4 GB).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`d299e8b`](https://github.com/tsenoner/protspace/commit/d299e8b0f2ebb2cdb05e5d99d6b851c64b6c9d51))

* fix(transfer): over-fetch candidates before the float64 kNN rerank

The float32 GEMM distance ||q||^2 - 2 q.r + ||r||^2 loses precision to
catastrophic cancellation for high-norm pLM embeddings, so the argpartition
top-k *selection* could drop a true nearest whose float32 distance is noise.
The exact float64 recompute only reordered the already-selected candidates, so
it could not recover a nearest that selection discarded — for the default k=1
with two near-equidistant references, eat() could transfer the wrong label.

Over-fetch a wider candidate pool (max(2k, k+16), capped at n_refs) with the
fast float32 block, rerank the whole pool in float64, then take the true top-k.
Selection is now robust to the float32 cancellation, not just the reported
distance. The rerank stays O(b * k_pool * d) << the O(b * n_refs) GEMM, so cost
and peak memory are unchanged in practice.

Adds a regression test: high-norm near-duplicate clusters whose true distances
collapse below the float32 rounding floor. Exact-k selection returns decoy
indices for most queries; over-selection recovers every true anchor.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`045fe8b`](https://github.com/tsenoner/protspace/commit/045fe8b34fe8c58fbe3dddbd45ba65d1337ecb46))

* fix(transfer): address review findings — atomicity, precision, security, robustness

Resolve issues found in code review of the EAT transfer backend (PR #55):

- predictions: make the overlay idempotent — drop existing <col>__pred_* columns
  before re-appending, so re-running transfer replaces them instead of producing
  a duplicate-column bundle that can no longer be read back
- bundle: atomic writes (temp file + os.replace) in write_bundle and the
  replace_* helpers, so an interrupted in-place overwrite (-b X -o X) can no
  longer destroy the bundle; reject the reserved delimiter in serialized parts
- backends: replace scipy.cdist with a pure-numpy BLAS GEMM path and recompute
  the surviving top-k distances in float64 (precise for near-identical vectors);
  guard cosine against zero-norm NaN
- lookup: store float32 + unicode arrays, load with allow_pickle=False
  (no pickle/RCE surface; lossless round-trip)
- transfer/classification: materialize only the needed columns (no full
  to_pylist); deterministic RI tie-break; translate input errors to BadParameter
- cli: colon/Windows-safe -e/-i parsing via a shared split_h5_spec helper
- docs/notebook: qualify the reliability-index formula per metric and k

Adds tests for protlabel engine, overlay idempotency, atomic write, spec
parsing, and CLI error handling. Full suite: 572 passed; ruff clean.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`9da7f4d`](https://github.com/tsenoner/protspace/commit/9da7f4d552690a9403a6425b07c0b81837fcf859))

* fix(transfer): handle protein_id id column in real bundles; clearer errors

- Normalize protein_id→identifier before run_transfer and rename back after
  so real bundles (produced by protspace prepare) no longer KeyError.
- Add ValueError when no bundle proteins match any embedding key.
- Correct misleading comment in test_run_transfer_predicts_for_query_with_missing_value.
- Add end-to-end regression test exercising the protein_id rename path.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`c708f90`](https://github.com/tsenoner/protspace/commit/c708f90f87e2714835d1ee288c6cea9279827541))

* fix(protlabel): bound kNN per-chunk memory adaptively; guard k>=1

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`d494242`](https://github.com/tsenoner/protspace/commit/d494242b4350b5021211f7200fb4e7456e19550a))

* fix(annotations): resolve PR66 review — serve style consistency, v2 decode gate, annotate stamp

Addresses the three review findings on the bundle-format-v2 branch:

- **serve style keys (high):** the Dash plot grouped points by the *decoded*
  value while the style dropdown stored/looked up colors and shapes by the
  *encoded* value, so a user's color choice was silently dropped for any name
  containing `;`/`|`. serve now operates entirely in display space: the value
  dropdown, color-picker preview, and stored style keys all use the shared
  display value, matching the plot's categories.

- **display decode (medium):** factor a single `encoding.to_display_value`
  used by both the plot and the `style` template (unifying the `|`-suffix trim
  so the stats `cluster N|score` cells match their `cluster N` auto-legend
  styles), and gate the percent-decode on `format_version >= 2`. ArrowReader
  now reads `protspace_format_version` from the annotations parquet metadata
  and threads it through the serve dict round-trip, so a legacy v1 name with a
  literal `%XX` is left untouched.

- **annotate stamp (minor):** `protspace annotate` now stamps its parquet as
  v2, so an un-bundled annotate output declares its encoding for any consumer
  that gates decoding on the version.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`41f7b55`](https://github.com/tsenoner/protspace/commit/41f7b5599b053e6dde85b581cb76ef7e9032f1ff))

* fix(serve): decode v2 percent-encoded annotation cells in plot legend/hover

prepare_dataframe() built the plotly color/symbol/legend/hover column
straight from the raw stored annotation cell, so encoded names showed
%3B/%7C/%25 in the serve viewer instead of ;/|/%. Decode once at the
single fetch site via a small _decode_annotation_value() helper (no-op
on None/non-strings), mirroring the style path's existing decode. ([`d40dc78`](https://github.com/tsenoner/protspace/commit/d40dc7865194c7b2024b7e6046b19c1ce828a164))

* fix(annotations): --no-scores also strips ted_domains pLDDT scores

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`bdddf1e`](https://github.com/tsenoner/protspace/commit/bdddf1eeb7bd78f55d9621fc280a016c17bfd8e5))

* fix(annotations): stop fabricating names for unnamed CATH superfamilies (#57) ([`256edd8`](https://github.com/tsenoner/protspace/commit/256edd8f51f35bc35acff8dccdcf57702639e3a7))

### Performance Improvements

* perf(transfer): halve cosine kNN memory to 1x reference matrix; verify 4GB deploy fit

The cosine path in backends.nearest held the reference matrix twice (raw + a
normalized copy), so cosine at full Swiss-Prot / dim 1024 needed ~4.7 GB and would
OOM a 4-core/4 GB deployed box. Fold the per-reference norm into the dot product
(cos = q.r / (||q|| ||r||)) instead of storing a normalized copy, so cosine holds
1x references like euclidean. Behaviour preserved (existing cosine equivalence +
zero-vector tests stay green); _l2_normalize is now unused and removed.

Measured in a docker --cpus=4 --memory=4g container (one fresh process per config):
full Swiss-Prot (570K x 1024) now fits at ~3 GB peak for both metrics, ~7-10 ms/query
on 4 arm64 cores. Adds packages/protlabel/benchmarks/bench_memory.py and folds the
results into the research doc.

Also clarifies in reliability.py that the backend never emits negative distances
(euclidean is a clamped sqrt; cosine distance in [0,2]) — the guard is defensive.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`d5023ae`](https://github.com/tsenoner/protspace/commit/d5023aed3f69af0d74febde2d925ff4cf81ac0cd))

### Refactoring

* refactor(transfer): simplify EAT classification, bundle I/O, and overlay

- classification.classify: drop the per-protein row dict (rebuilt once per
  protein, empty for the common id-prefix-only rule) and index column_data
  directly; remove the unreachable missing-column guard in _matches (the
  up-front validation already raises). Accept a precomputed identifier list
  so callers don't re-materialize it.
- data/io/bundle.replace_annotations_in_bundle: route through the shared
  _parse_bundle decoder instead of a second hand-rolled delimiter split, so
  it preserves settings + statistics parts. A 5-part (statistics) bundle now
  round-trips instead of being rejected. write_bundle reuses
  _table_to_parquet_bytes, and replace_settings_in_bundle now runs the
  delimiter guard on every write path.
- data/io/predictions.add_overlay_columns: accept a precomputed identifier
  list so overlaying several columns onto one table doesn't re-materialize
  the id column on each call.

Adds round-trip tests for statistics-bearing bundle preservation.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`34623d8`](https://github.com/tsenoner/protspace/commit/34623d8e65a6c3f1f9d689517ce62b3dd2aee647))

* refactor(transfer): address PR #55 review — cosine default, bounded RI, protlabel as uv workspace member

Addresses reviewer (t03i) feedback on the EAT backend:

- Default metric for `protspace transfer` is now cosine (bounded, interpretable
  confidence); euclidean stays opt-in. The protlabel engine keeps goPredSim-canonical
  euclidean as its primitive default.
- Reliability index clamps to [0,1], guards negative distance, and maps non-finite
  (NaN/inf) distances to 0 so an invalid neighbour can't yield a high confidence.
  (NaN->1.0 bug found by our own xhigh review; redundant clamp dropped.)
- Drop the unused, heavy scipy dependency (only a docstring/test comment referenced it).
- Extract protlabel into a uv workspace member (packages/protlabel) with its own
  pyproject + dependencies (numpy only), published as its own distribution; protspace
  depends on protlabel>=4.4.0. No-protspace-imports boundary enforced by a test;
  lock-step versioning via semantic-release; CI + Docker build both packages.
- Move protlabel's engine tests into the member (packages/protlabel/tests); a bare
  `uv run pytest` covers both via testpaths.
- Rewrite the design spec to as-built reality (cosine default, brute-force + query
  batching, workspace architecture); drop the frontend (-> protspace_web), the
  ProtTucker/faiss speculation, and hardware-specific benchmarks.

Verified: 576 tests pass, ruff clean, `uv build --all-packages` produces both wheels
with a clean dependency boundary (protlabel requires only numpy).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`7ea9eeb`](https://github.com/tsenoner/protspace/commit/7ea9eebaf0fb3a9a38028d8572f2226ccafb6e60))

* refactor(transfer): drop __pred_source overlay column; keep numeric confidence

The per-cell prediction overlay now writes only <col>__pred_value and
<col>__pred_confidence. The reference id (source) is noise as a colour feature,
so it is dropped from the bundle; it remains available on protlabel's Prediction.
A legacy <col>__pred_source is dropped on re-run so older bundles are cleaned up.

Keeping confidence as a separate numeric column lets the web frontend colour and
threshold by reliability (gradient legend) — which inline label|score values do
not enable (those render tooltip-only).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`f7186f5`](https://github.com/tsenoner/protspace/commit/f7186f56812641558c49672500bdf785f80234af))

* refactor(annotations): drop unused encoding metadata key, dedup GO properties, document bundle -a trust boundary

- Remove write-only protspace_encoding parquet metadata key (redundant with
  protspace_format_version, nothing reads it).
- Extract _go_terms_encoded() helper to dedup go_bp/go_mf/go_cc parsing.
- Document the bundle -a annotations trust boundary (assumed already
  percent-encoded by the same-version annotate/prepare pipeline).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017A9q6QZuqfUSVQv5iPqnWf ([`cfcad06`](https://github.com/tsenoner/protspace/commit/cfcad06ad201528a135d700d22802bc1164798e6))

### Testing

* test: cover empty-predictions and unknown-id overlay edge cases ([`05194bf`](https://github.com/tsenoner/protspace/commit/05194bf989aadd055c832f85471222a75ec7cc3f))

* test: cover neither-match exclusion and multi-prefix OR in classifier ([`bc8837e`](https://github.com/tsenoner/protspace/commit/bc8837e21ab882c3b26df3debe2c8fa52dc993ba))

* test(protlabel): document RI tie-break and cover nearest-source selection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com> ([`4b39cb8`](https://github.com/tsenoner/protspace/commit/4b39cb8cc9f5cb8eecf4e0288c464cfed2b1c34c))

* test: assert stamp_format_version merges metadata; docs: trim redundant wording

- test_annotation_encoding.py: seed schema metadata before stamping and
  assert stamp_format_version preserves it alongside the new
  protspace_format_version key, instead of only covering the fresh-table case.
- annotations.md: "commas, parens, and parentheses" was redundant
  (parens == parentheses); tighten to "commas and parentheses". ([`0a62211`](https://github.com/tsenoner/protspace/commit/0a622112a30a600310ba44d9d1476231f99ca55a))

* test(annotations): backend end-to-end v2 bundle round-trip proof

Proves a ';'-bearing CATH name survives write_bundle -> read_bundle
losslessly: the encoded cell round-trips byte-for-byte, the literal ';'
never leaks into the parsed name (only its %3B escape), the cell stays
parseable as a single hit, and decode_field recovers the exact original
string. Also asserts the annotations part still carries the v2
format-version stamp. ([`62d1712`](https://github.com/tsenoner/protspace/commit/62d1712c1989dc5671b9fa84bf038008c40f3aa1))

* test(annotations): make InterPro name-encoding test exercise the real emit path ([`ce52f66`](https://github.com/tsenoner/protspace/commit/ce52f6642b8d18fd02e86f7adec316883d7f1e07))

### Unknown

* Merge pull request #55 from tsenoner/feat/eat-transfer-backend

feat: protlabel EAT engine + protspace transfer subcommand ([`6b1d98a`](https://github.com/tsenoner/protspace/commit/6b1d98afb47fbbefbf74bc651b24a5cf67925db8))

* Merge branch 'main' into feat/eat-transfer-backend

Resolve three conflicts introduced by the projection-statistics feature (#61):

- pyproject.toml: main moved [project.scripts] to the top of the file while
  this branch appended [tool.uv.workspace]/[tool.uv.sources] after the old
  scripts location. Keep main's single top-level [project.scripts] and the
  workspace/sources config; drop the now-duplicate scripts table.
- data/io/bundle.py: both branches rewrote write_bundle. Keep this branch's
  atomic-write house style (buf + _check_no_delimiter + _atomic_write_bytes,
  matching the rest of the merged module) and layer in main's optional
  statistics 5th part with the zero-byte settings-slot invariant.
- test_base_data_processor.py: keep main's new unbundled-settings test and
  this branch's real-bundle integration test for test_save_output_bundled
  (main's mock-open variant is incompatible with the atomic-write path);
  standardize the lingering src.protspace import to protspace.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`7fa15d7`](https://github.com/tsenoner/protspace/commit/7fa15d7e1f8635c24cbe1e7db7aebef36e3584a3))

* Merge branch 'main' into feat/eat-transfer-backend ([`72fa7b7`](https://github.com/tsenoner/protspace/commit/72fa7b7720790ee489ad7be6a6b1484dd0317c08))


## v4.5.0 (2026-07-08)

### Chores

* chore(data): add 3FTx raw data spreadsheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`631a221`](https://github.com/tsenoner/protspace/commit/631a2214a61b307871aaa99c0f4bce10446ce2f5))

* chore(data): trim JMB toxprot archive to embedding-based files

Drop the sequence-similarity projection JSONs (toxins_seq_sim*.json) and
the supplementary toxins_all.csv. The archive keeps the ProtT5
embedding-based ProtSpace JSONs, toxins.csv (accessions + curated
protein_category), and the reconstructed FASTAs. README updated to match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`78c724d`](https://github.com/tsenoner/protspace/commit/78c724d2c01f68498078a227b0b81c7cc6c58c0e))

* chore(data): stop tracking JMB toxprot embeddings .h5

Keep the 22 MB ProtT5 .h5 out of git (it's reproducible from the mature
FASTA via `protspace embed`). The rebuild script now reads the accession
list from the tracked toxins.csv instead of the .h5, so the archive stays
self-contained without the embeddings. README clarifies the .h5 is
untracked and documents the toxins.csv vs toxins_all.csv column split.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`5ff64db`](https://github.com/tsenoner/protspace/commit/5ff64db27ca8d8b8fd4fd2f4da5ea86dd6b62459))

* chore(data): archive original JMB 2025 toxprot dataset

Restore the venom-toxin (ToxProt) dataset behind the original ProtSpace
JMB 2025 figures (from commit 7c0442e, removed in the Oct 2025 cleanup)
into data/jmb_2025/toxprot/ for backwards compatibility: ProtSpace JSONs
(embedding + sequence-similarity projections), ProtT5 embeddings, and
annotation CSVs.

The input FASTA was never committed, so rebuild_mature_fasta.py
reconstructs both full and signal-peptide-stripped sequences by
re-fetching the 5,181 accessions from UniProt (5,179 recovered; 2 now
obsolete). README documents the dataset and the exact DR parameters used.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`09c163e`](https://github.com/tsenoner/protspace/commit/09c163e7521b1fb63bfcc246e139e691502e1db5))

* chore(toxprot-demo): track regenerated demo bundle

Add the regenerated 7,831-protein toxprot demo bundle (ProtT5 + ESM2-650M,
mature peptides) to the repo. data/toxins/ is whitelisted in .gitignore
for exactly this purpose, matching the precedent of the legacy bundle
files we deleted in the previous commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`6a977fd`](https://github.com/tsenoner/protspace/commit/6a977fdf85f8a2f9e7312d917122624deb5acbfa))

* chore(toxprot-demo): swap ESMC→ESM2-650M, drop extras, restyle top-9

- Use prot_t5 + esm2_650m as the two embedders (was prot_t5 + esmc_300m).
- Trim the bundle to the original demo's 18 annotation columns: drop
  signal_peptide (sequence was stripped in this pipeline so the SP
  annotation no longer applies) plus the InterPro/taxonomy auxiliaries
  brought in by the `interpro` and `taxonomy` annotation groups.
- Reorder columns so protein_families is the first non-id column — the
  web app picks the first non-id column as the default annotation.
  Bundle also keeps ProtT5 — UMAP 2 as the first projection so it loads
  by default.
- Recompute the manual top-9 + __NA__ categories for pfam, ec,
  superfamily, and cath from the new dataset (split on `;`, drop the
  trailing `|score` / `|EVIDENCE`); preserve the hand-curated
  protein_families styling byte-for-byte from the existing web bundle.
- Drop stale tracked data/toxins legacy artifacts left over from the
  pre-regeneration layout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`750e7bd`](https://github.com/tsenoner/protspace/commit/750e7bd42a26d98869855a439bf10ec1b5b5e091))

* chore(toxprot-demo): align main with project logging convention

Apply code-review feedback on Task 6:
- Use protspace.cli.app.setup_logging instead of logging.basicConfig.
  This caps urllib3/requests at WARNING (else they spam DEBUG with
  -v) and routes through the tqdm-aware handler so subprocess
  progress bars don't get garbled.
- Switch -v to action="count" for parity with `protspace prepare`'s
  verbosity convention; default behaviour is unchanged (INFO).
- Use shlex.join when logging the prepare invocation so the printed
  command is copy-paste safe (METHODS contains a `;`).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`e47269a`](https://github.com/tsenoner/protspace/commit/e47269a9b31b20a2628d93f494511f1437622bff))

* chore(toxprot-demo): wire main orchestration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`90354a1`](https://github.com/tsenoner/protspace/commit/90354a10f5ae65ec4345002b2b04528205d27e49))

* chore(toxprot-demo): clarify postprocess_bundle id-mapping + error msg

Address code-review nits on Task 5:
- Comment why we map mature lengths by protein_id rather than zipping
  positionally — the prepare pipeline can reorder rows during
  EmbeddingSet merging and dedup, so positional mapping would silently
  corrupt lengths.
- Enrich the missing-key error to include the bundle filename, the
  size of the mature_lengths map, and the first 5 missing IDs — makes
  the live-run debug path much shorter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`f7c638f`](https://github.com/tsenoner/protspace/commit/f7c638f94f41dc9757ed73c7f3bf8ae944e4e667))

* chore(toxprot-demo): post-process bundle with mature length + settings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`d5f56e8`](https://github.com/tsenoner/protspace/commit/d5f56e8982c3b6fb6022906d56f506ea106983f4))

* chore(toxprot-demo): tighten fetch_toxprot_tsv polish

Address code-review nits on Task 4:
- Document that the cache key is out_path only.
- Use splitlines() instead of count("\n") so the empty-payload guard
  doesn't fire spuriously if UniProt ever returns the data row without
  a trailing newline.
- Pass encoding="utf-8" explicitly to write_text for symmetry with the
  decode step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`af902e5`](https://github.com/tsenoner/protspace/commit/af902e5604998507f5cc4bbf8b74beadf2b2504b))

* chore(toxprot-demo): stream UniProt TSV with sequence + signal_peptide

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`6d7e2b1`](https://github.com/tsenoner/protspace/commit/6d7e2b1505a6a26c007699acef5fb2a6be9d281f))

* chore(toxprot-demo): write mature FASTA with SPs cleaved

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`a411e84`](https://github.com/tsenoner/protspace/commit/a411e846bba63efbce925fc42da6808b941228dc))

* chore(toxprot-demo): scope ?<> uncertainty check to SIGNAL bounds

Previously the uncertainty check ran against the entire Signal peptide
field, so a cleanly-bounded SP with a /note or /evidence containing
`?`, `<`, or `>` would be incorrectly skipped. Use the regex hit/miss
itself as the uncertainty signal: SIGNAL_RE only matches digit bounds,
so 0 hits + a SIGNAL keyword in the field == uncertain bounds. Also
guard against blank Entry rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`b7fae48`](https://github.com/tsenoner/protspace/commit/b7fae48c70bda74b156ac7f37a063bb6e02796fb))

* chore(toxprot-demo): parse signal peptides from UniProt TSV

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`c32396a`](https://github.com/tsenoner/protspace/commit/c32396aa960a396bd5049ba170cd2b81a42b1d8d))

* chore(scripts): scaffold generate_toxprot_demo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8d5ca82`](https://github.com/tsenoner/protspace/commit/8d5ca82eff8f5a1b432267c36d18f232cabc0d18))

* chore(scripts): add bundle inspector, fix h5 entry counter

count_h5_rows previously summed len() across all datasets, which
returned total residues (or entries × embedding_dim) instead of the
number of proteins. Replaced with a single-sample inspection that
reports entries, dimension, and dtype.

inspect_bundle is a new helper that prints rows/cols/schema and a
short preview for each table in a .parquetbundle, plus the settings
keys when present. Reuses read_bundle from data.io.bundle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8518d28`](https://github.com/tsenoner/protspace/commit/8518d28d7c5a2ef9e73652ab8feecb9414885195))

### Code Style

* style(stats): CI ruff format check rejected an over-long _merge_annotations_with_columns call; wrap it to satisfy ruff format

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`f7c42d9`](https://github.com/tsenoner/protspace/commit/f7c42d944c50ae6a2a97d53bfcb0e9cbc80b5d46))

* style: apply ruff format to projection-statistics files

CI's `ruff format --check` flagged 9 files that were committed without
running `ruff format` (`ruff check` lint passed, but the formatter check
is a separate CI step). Pure formatting — no behavior change.
Stats suite still 30 passed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`c83cc27`](https://github.com/tsenoner/protspace/commit/c83cc274a8b5b899d86ead4b86e7b894b042482b))

### Documentation

* docs(stats): document annotation-based cluster-validity + --stats-annotation

Update CLAUDE.md, docs/cli.md, README.md, and the prepare-bundle Colab
notebook to describe the shipped feature: silhouette/DBI/CH validity is
now scored per user-selected annotation on both the embedding and each
projection (space_kind embedding|projection, annotation column in
statistics.parquet), auto-clustering is no longer self-scored but
instead reports ARI/NMI agreement with each annotation, and the new
--stats-annotation (auto|comma-list) flag picks which columns to score
on prepare and stats. Refresh the stats/ package-structure tree and the
test-file table with current test counts (grep -c '^def test_'),
including the new test_annotation_select.py and test_annotation_validity.py.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`6f22bd1`](https://github.com/tsenoner/protspace/commit/6f22bd1238f5a1447878ab441c112df3a8202dd0))

* docs(stats): implementation plan for annotation-based cluster-validity

8 TDD tasks: annotation dimension in the data model, suitability filter +
label builder, AnnotationValidityStatistic (embedding + projection), ARI/NMI
agreement folded into ClusterValidityStatistic, driver once-per-embedding
pass, --stats-annotation on stats + prepare, docs.

Refs: #31, #64, protspace_web#296

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`119ec3f`](https://github.com/tsenoner/protspace/commit/119ec3f45c0735b1ba5faeefb683f83a8d196382))

* docs(stats): design spec for annotation-based cluster-validity

Rework cluster-validity to score user-selected annotations (silhouette/DBI/CH
on both the embedding and each projection) + ARI/NMI vs the auto-clusters,
replacing the circular auto-KMeans self-validity. Keeps the group-detection
membership columns. Gap/BIC k-selection deferred to #64.

Refs: #31, #64, protspace_web#296

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`6d856ce`](https://github.com/tsenoner/protspace/commit/6d856cee2aeceec2f688b7fb215fc9191cac68b2))

* docs(stats): document projection statistics (CLI, README, notebook)

- docs/cli.md: add the `protspace stats` command, the `prepare --stats` flag,
  `bundle -s/--settings`, and a "Projection Statistics" concept section.
- README.md: quality-metrics feature bullet + stats step in the power-user workflow.
- CLAUDE.md: stats command + usage, stats/ package tree, cli/stats.py, the 5-part
  bundle layout (statistics part + settings in unbundled output), and stats
  test-file rows.
- ProtSpace_Preparation.ipynb: a "Quality statistics" cell pointing to the CLI
  (the notebook installs from PyPI, so live-wiring the toggle waits for a release).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`07ab842`](https://github.com/tsenoner/protspace/commit/07ab842777ca7de5f683bca90f5ce17d74483970))

* docs(plan): use chore: prefix for toxprot demo commits

The script is dev tooling, not user-facing package functionality;
chore: avoids triggering a minor bump from semantic-release.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`4fdfb49`](https://github.com/tsenoner/protspace/commit/4fdfb4984028ec088cb5f546c43067ac4164955f))

* docs(plan): toxprot demo bundle regeneration implementation plan

Seven-task TDD plan that scaffolds the orchestration script, builds
parse_signal_peptides / write_mature_fasta / fetch_toxprot_tsv /
postprocess_bundle with unit tests where they make sense, wires up
main(), and finishes with a wipe + end-to-end verification step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`fcae72f`](https://github.com/tsenoner/protspace/commit/fcae72fe1776a57d4fcf87be165c236fbf91c04b))

* docs(spec): toxprot demo bundle regeneration design

Design for recreating the demo .parquetbundle shipped at
protspace_web/app/public/data.parquetbundle with two new behaviours:
strip signal peptides before embedding, and add ESMC-300m alongside
ProtT5. A standalone scripts/generate_toxprot_demo.py orchestrates
fetch → strip → protspace prepare → length+settings post-process.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`5b59c4f`](https://github.com/tsenoner/protspace/commit/5b59c4fd6b1d8035f46f60b1c08b546e3f6ef8a7))

* docs: clarify multi-DR-params syntax and notebook gap

Follow-up to PR #48 review feedback.

- docs/cli.md: rewrite -m flag description to spell out the
  comma-vs-semicolon rule explicitly, add an "Overridable parameters"
  subsection listing the 11 valid override keys with their abbreviations
  and types, and extend "Projection Naming" with an example of the
  parameter-suffix disambiguation behavior.
- notebooks/ProtSpace_Preparation.ipynb: insert an informational markdown
  cell pointing power users at the CLI for parameter sweeps, since the
  toggle UI runs each method only once.

No code or behavior changes; release-bot will not bump the version.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`bbd50c9`](https://github.com/tsenoner/protspace/commit/bbd50c940bd536c8f646f72f05a7ae6b7eea7fc7))

### Features

* feat(stats): prepare --stats-annotation flows selection into the pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`f268a5d`](https://github.com/tsenoner/protspace/commit/f268a5dcf012a061825b0b08655c29110fbecc8d))

* feat(stats): stats --stats-annotation scores selected annotations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`2d145ac`](https://github.com/tsenoner/protspace/commit/2d145aced500c5148291d4ebe50d955cbca97bcf))

* feat(stats): driver runs annotation-validity on embedding + projections

Threads an `annotations` kwarg through `compute_statistics` into every
projection's StatContext, registers AnnotationValidityStatistic in the
statistics registry, and adds a once-per-embedding pass that runs any
statistic opting in via `embedding_space` (currently just
annotation-validity) against the raw embedding as a separability
ceiling. Also patches faithfulness.py's StatRow constructions with the
now-required `annotation` field, and fixes the Task-1 test debt this
exposed (_statrow helper + the 8→9 column schema assertion).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`adb9d38`](https://github.com/tsenoner/protspace/commit/adb9d38dab6b77b57c99bf8d09ada829abbf9df2))

* feat(stats): AnnotationValidityStatistic (silhouette/DBI/CH per annotation)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`3f0731d`](https://github.com/tsenoner/protspace/commit/3f0731db3072eb70c43d2f071cc2090023b12241))

* feat(stats): annotation selection + suitability filter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`3570e7f`](https://github.com/tsenoner/protspace/commit/3570e7f64eba0d410156386094dcb60fb5a900f4))

* feat(stats): add annotation dimension to StatRow + StatContext

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`a6e0210`](https://github.com/tsenoner/protspace/commit/a6e0210cb593a647f088065d624f36a4d713558d))

* feat(stats): cluster-selection (elbow/silhouette/both), silhouette-as-score, global faithfulness

Sub-branch of feat/projection-statistics for separate review.

- --cluster-selection elbow|silhouette|both (prepare + stats): emit the elbow
  clustering (`cluster_<proj>`), the max-silhouette-K clustering
  (`cluster_silhouette_<proj>`), or both; validity rows carry the matching
  label_kind (kmeans_elbow / kmeans_silhouette). kmeans_elbow optionally returns
  the silhouette-optimal K + labels (computed only on request).
- Per-point silhouette is now attached to the membership value as `cluster N|<sil>`
  (the UniProt-ECO / InterPro-bit-score convention) instead of a separate
  silhouette_<proj> column; gated by --no-scores. Legend builder strips the
  suffix to recover the bare category.
- Two global faithfulness metrics: random_triplet (relative-ordering accuracy
  over random triplets) and spearman_distance (rank correlation of all pairwise
  distances). Rows tagged scope=local|global.

Tests updated for the single-column format; added cases for cluster-selection,
score gating, global metrics, and silhouette-K selection. 572 fast tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`96aae0c`](https://github.com/tsenoner/protspace/commit/96aae0c3d9b1d1d7dfb350db9dc64c371b8bed9c))

* feat(stats): auto-style cluster-membership columns (legend settings)

Phase 2A.4 of route-projection-statistics. Generate a full LegendPersistedSettings
envelope per cluster-membership column so clusters are colored when selected with no
manual styling step.

- carriage.build_cluster_legend_settings: for each categorical AnnotationColumn build
  a complete envelope the frontend's sanitizeLegendSettingsEntry accepts —
  maxVisibleValues / shapeSize / sortMode / hiddenValues / enableDuplicateStackUI /
  selectedPaletteId + categories keyed by the exact label with a Kelly-palette
  color, zOrder and shape. Numeric (silhouette) columns keep the default ramp.
- prepare path: BaseProcessor.save_output gains settings=; the pipeline builds the
  cluster styles from the report and writes them into the bundle's settings part.
- prep path: `protspace stats --settings-out <json>` writes the styles; `protspace
  bundle --settings <json>` folds them into the settings part.

Tests: envelope validity (every required field/type + distinct palette colors);
end-to-end stats --settings-out -> bundle --settings styles clusters in the settings
part.

Deferred (follow-up): preserving the generated cluster styles across a later
`protspace style` rewrite (replace_settings_in_bundle) — a rare re-style path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`ecd199a`](https://github.com/tsenoner/protspace/commit/ecd199a55fcad01545f28939d33e20d817941c4e))

* feat(stats): per-protein cluster membership + silhouette as annotation columns

Phase 2A of route-projection-statistics (tsenoner #61 review bullets 1-2): surface
the elbow-K labelling and per-point silhouette as per-protein annotation columns
so the frontend color-by control renders them with no new UI.

- New AnnotationColumn output type (name, kind categorical|numeric, values keyed by
  identifier); StatsReport carries an annotation_columns channel and add() routes
  mixed StatRow / AnnotationColumn lists.
- ClusterValidityStatistic emits `cluster_<projection>` (non-numeric "cluster N"
  labels → categorical inference) and `silhouette_<projection>` (per-point
  silhouette_samples over the full labelled set → numeric). Per-point silhouette is
  O(n^2) with no subsample path, so it has its own hard-ceiling skip guard; both are
  gated by the cluster_annotations param and emitted only for a genuine (>=2)
  clustering with aligned ids.
- carriage.merge_annotation_columns joins the columns onto the annotations frame by
  identifier (absent proteins get no value); wired into the prepare pipeline before
  create_output's .astype(str) so typing survives.
- `protspace stats` gains -a/--annotations: enriches the annotations parquet in
  place with the computed columns (stringified to match the prepare path), so the
  prep `project -> stats -a -> bundle -a` flow carries them. Without -a the
  expensive per-protein computation is skipped.

Tests: validity per-protein outputs + ceiling guard + disable; carriage join +
annotations-table typing; stats -a enrichment; end-to-end stats -a -> bundle -a
ships cluster_/silhouette_ columns in the bundle's annotations part. Auto-styling
(colored-without-manual-step) is the next increment; columns already color via the
default palette when selected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`033bffc`](https://github.com/tsenoner/protspace/commit/033bffc632f46b5a3bf153628b70bf3557e46422))

* feat(stats): standalone `stats` enriches projection metadata with faithfulness

The deployed prep pipeline builds bundles via standalone `protspace project` +
`stats` + `bundle` subprocesses, not the in-process `prepare` pipeline. After the
Phase-1A routing, `protspace stats` wrote faithfulness nowhere (only aggregate
validity → statistics.parquet), so the prep path lost it.

`protspace stats` now folds faithfulness into `projections_metadata.parquet` in
place (parses each row's info_json, injects `quality`, preserves all other columns
and the reducer's existing info, re-serialises). The existing `protspace bundle -p`
then carries the enriched metadata into the bundle's 2nd part with no bundle/prep
code change. statistics.parquet stays aggregate-only.

This matches the spec scenario "the standalone stats path recomputes and merges it
into projections_metadata" and makes Phase 1 deliver faithfulness end-to-end in the
production prep flow.

Tests: stats rewrites metadata.info_json.quality (columns/rows preserved, reducer
info kept); end-to-end `stats` → `bundle -p` ships a bundle whose
projections_metadata carries quality while the fifth part stays validity-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`7186a7d`](https://github.com/tsenoner/protspace/commit/7186a7d40248fd76fbb9649eca90555098988a03))

* feat(stats): route faithfulness to projection metadata (info_json.quality)

Phase 1A of route-projection-statistics: carry each statistic in the bundle
part whose existing frontend consumer matches its granularity, instead of one
opaque fifth part.

- StatRow gains a `destination` (default "statistics_part", not a tidy-table
  column); StatsReport.partition() groups rows by destination and to_arrow()
  serialises only the statistics_part bucket -- the fifth part is now aggregate
  cluster-validity only.
- Faithfulness rows (kNN-overlap / trustworthiness / continuity, incl. the skip
  row) are marked destination="projection_metadata".
- New stats/carriage.py route_faithfulness_to_metadata() folds those rows into
  each projection's info_json.quality (per-metric value + k/metric/sampling
  provenance; NaN skip value -> null so info_json stays valid JSON). Wired into
  ReductionPipeline._compute_statistics before create_output serialises info_json.
- `protspace stats` stays a pure aggregate-only producer (faithfulness no longer
  written to statistics.parquet); the prep stats+bundle path is unaffected.

Tests: destination/partition/to_arrow restriction; faithfulness routing incl.
skip row; carriage router (provenance, NaN->null, info_json round-trip,
multi-embedding); end-to-end `protspace stats` aggregate-only. Existing
fifth-part tests updated to the narrowed contract.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`95b3031`](https://github.com/tsenoner/protspace/commit/95b3031ef88625a222860d6b34da701da8bad25d))

* feat(stats): add projection statistics (cluster-validity + faithfulness)

Add a protspace.stats package computing per-projection statistics, baked
into the .parquetbundle as an optional fifth part:

- cluster_validity: KMeans + distance-to-chord elbow -> silhouette,
  Davies-Bouldin, Calinski-Harabasz on the projection coordinates.
- faithfulness: kNN-overlap + trustworthiness/continuity vs the source
  embedding (high-dim metric from the reducer; large-n sampling guard).

Tidy long-format table (8 cols: space_kind, space_name, stat_family,
label_kind, metric, metric_kind, value, extra_json) — new statistics add
rows, not columns. Registry mirrors the lazy REDUCERS pattern; sklearn
imports stay function-local to preserve CLI startup.

Bundle I/O carries an optional 5th statistics part (core+settings?+stats?)
with a zero-byte settings slot keeping it unambiguous; read_bundle keeps
its 2-tuple shape (new read_statistics_from_bundle accessor) and
replace_settings_in_bundle preserves a trailing stats part so
`protspace style` is non-lossy.

Wiring: ReductionPipeline computes stats (best-effort, never fatal) behind
prepare --stats/--no-stats; new `protspace stats` subcommand for the
discrete path; `bundle -s/--statistics` folds a stats parquet in.

Refs tsenoner/protspace_web#219

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`590306c`](https://github.com/tsenoner/protspace/commit/590306cc8eeee8b1832e5766d4d09e1e933c57d3))

### Fixes

* fix(test): colored CI output splits "--option" tokens with ANSI codes so the guard-message substring match failed; strip escape sequences before asserting (also wraps an over-long invoke arg list ruff format flagged)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`0b9f342`](https://github.com/tsenoner/protspace/commit/0b9f3420d0eb34d51ec8622fe2d1aa29b7c095d0))

* fix(stats): spearman_distance used ordinal (index-broken) ranks, biasing on ties and reporting a spurious perfect score for collapsed layouts; use midranks and return NaN when distances are all-tied

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`e86b1d0`](https://github.com/tsenoner/protspace/commit/e86b1d07029abde51365f1e2f563cd1e662bc6f7))

* fix(stats): stats -a rewrote the annotations parquet through a pandas round-trip that re-inferred dtypes (nullable int64 → float64 on untouched columns); append cluster columns onto the original Arrow table instead

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`caf1465`](https://github.com/tsenoner/protspace/commit/caf146575f181f51d77775845bfd6269045a924a))

* fix(cli): prepare silently ignored --stats-annotation/--cluster-selection when --stats was off; reject a non-default value without --stats

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`cb70337`](https://github.com/tsenoner/protspace/commit/cb70337e44c76715cee29e2fd4d2c4ffabbc74ef))

* fix(stats): an id-namespace mismatch silently added an all-empty cluster column and styled a phantom legend; warn and skip zero-match columns, and style only the columns that landed values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`59c4e89`](https://github.com/tsenoner/protspace/commit/59c4e8980282a1309727e7290e6eb64b73ae8dc8))

* fix(stats): _select_embedding silently picked embedding_sets[0] when several embeddings covered the ids with no source, scoring faithfulness against the wrong space; abstain (return None) on ambiguity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`6775bcb`](https://github.com/tsenoner/protspace/commit/6775bcbeef7cfb65db33235f80571afe99a25fd8))

* fix(stats): a faithfulness metric that raised (e.g. random_triplet on a metric paired_distances rejects) vanished silently from quality; record it as a skipped NaN row instead

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`af35475`](https://github.com/tsenoner/protspace/commit/af354753f3124d0c8325d80ff2562cb3172f4454))

* fix(stats): kmeans_elbow drew its large-n fit/silhouette subsample positionally from the raw seed, making clusters depend on input row order; draw it id-canonically (id-seeded, canonical order) like the other metrics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`7459587`](https://github.com/tsenoner/protspace/commit/7459587c0c96f7f84e6b75de558b6b1f305d4eea))

* fix(stats): annotation validity scored value|score compound labels, splitting one category per evidence code; strip the score suffix to the bare category before scoring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`35fe802`](https://github.com/tsenoner/protspace/commit/35fe8029049cab80300f306e0473ebc652f21dc1))

* fix(stats): review + simplify pass on the projection-statistics engine

Correctness (from /code-review):
- driver `_align`: return None when a reduction has no ids and the row counts
  differ, instead of falling through to positional indexing that IndexError'd
  and silently dropped the projection's entire stats report.
- validity: `--cluster-selection silhouette` on a degenerate/coincident
  projection left no scorable silhouette-K, emptying the labellings so the
  projection vanished from the report — now falls back to the elbow labelling.
- pipeline `_compute_statistics`: build the fallible artifacts (to_arrow,
  legend settings) before mutating the shared reductions/metadata, so a late
  failure yields a clean "no stats" fallback rather than a half-enriched bundle.

Cleanup (from /simplify + review):
- bundle.py: extract `_parse_bundle` (single read+split+validate+normalize
  seam) and `_table_to_parquet_bytes`; fold `read_settings_from_file`; this
  also fixes `read_statistics_from_bundle` silently skipping the part-count
  validation the other readers enforce.
- driver `_align`: keep the embedding at native float32 (was upcast to float64
  per projection); faithfulness bails before its upcast past the ceiling.
- cli/stats: extract `_parse_info_json` (was duplicated); export
  `read_statistics_from_bundle` from data/io.
- docs: add `stats/_sampling.py` to the package tree; fix test counts.
- tests: regression tests for the `_align` no-id guard and the
  silhouette->elbow fallback.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`aaa452c`](https://github.com/tsenoner/protspace/commit/aaa452ceb407c27b606da1da57ae7c5cfcfef6d3))

* fix(stats): review + simplify pass on annotation cluster-validity

Correctness (from /code-review):
- Honor explicit --stats-annotation names by bypassing the auto suitability
  heuristic — it silently dropped documented high-cardinality columns like
  ec_number, so the `major_group,ec_number` example scored only major_group.
- Make annotation-validity subsampling id-canonical (shared id_seed) so the
  once-per-embedding "separability ceiling" and each projection score the same
  proteins above the 5000-point threshold instead of two different draws.
- Recognize <N/A>/<NA>/NaT (and NA/null/none) missing sentinels so a missing
  value is never scored as a phantom category.

Cleanup (from /simplify + review):
- Extract stats/_sampling.py (id_seed + sorted_subsample), reused by
  faithfulness (behavior-identical) and annotation_validity.
- suitable_annotations early-exits past the cardinality cap; the explicit
  --stats-annotation path only inspects the named columns, not the whole frame.
- Avoid the full-embedding float64 upcast + pre-subsample copy in the
  once-per-embedding pass; extract _run_stats; reuse ann_frame instead of
  re-reading the annotations parquet.
- Shared CLUSTER_COLUMN_PREFIX constant; _resolve_id_col helper; push the
  --stats-annotation parse into build_annotation_labels; drop a redundant
  int() cast and dict copies.
- Fix stale docstrings and CLAUDE.md test counts; add explicit-name +
  subsample-determinism regression tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`b3922c7`](https://github.com/tsenoner/protspace/commit/b3922c7952dde5c48eb15031ccae2e5ffd031a90))

* fix(stats): correct random-triplet sampling + simplify/harden extras

Quality pass over the projection-stats "extras" (cluster-selection,
silhouette-as-score, global faithfulness).

Correctness
- random_triplet: sample two DISTINCT others per anchor (j != m != anchor)
  instead of drawing uniformly from [0, n). Self-pairs are distance-0 and
  trivially "agree" in both spaces, biasing the accuracy score upward.

Robustness / efficiency
- faithfulness: return the n > hard_ceiling skip row BEFORE the canonical
  sort/copy, so oversized inputs (metrics skipped anyway) don't pay a wasted
  O(n log n) sort + two array copies.
- cluster-validity: fall back to the 'elbow' default when the raw stats API
  receives an unrecognised cluster_selection (the CLI already validates via a
  Typer enum) instead of silently emitting no labelling at all.

Simplify
- model --cluster-selection as ClusterSelection(str, Enum) in common_options;
  Typer auto-validates, deleting two duplicated manual validation blocks in
  prepare.py + stats.py.
- validity: carry selection_name in a _Labeling NamedTuple (drops the
  reverse-derivation; shrinks _emit_labeling's signature 8 -> 5 args).
- kmeans_elbow: unify the two duplicate ElbowResult return sites.
- faithfulness: factor the 3x repeated local-scope extra dict.

Docs
- sync stale test-count table in CLAUDE.md (37->43, 11->12, 9->10).
- sync driver.compute_statistics docstring params (cluster_selection,
  include_scores, max_fit_sample, n_triplets_per_point, cluster_annotations).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`0ad7204`](https://github.com/tsenoner/protspace/commit/0ad7204681087cf1986022942f18190ae0d17bf7))

* fix(stats): address adversarial review of the extras feature set

- random_triplet was NOT row-order invariant for n<=sample_threshold (it samples
  triplets by array position). Canonicalise emb/coords/ids by id up front in
  FaithfulnessStatistic.compute so EVERY metric depends only on the id-set, in
  both the subsampled and non-subsampled paths. Invariance test now parametrised
  over both regimes and asserts all five metrics.
- prepare: validate --cluster-selection before the expensive query/embed/similarity
  stages (fail-fast), mirroring the stats command; add a CLI rejection test.
- Refresh stale docs/help/comments that still referenced the removed separate
  silhouette_<proj> column (carriage.py, cli/stats.py) and fix a "dense ranks"
  comment (ordinal ranks) + hoist a repeated fancy-index in random_triplet.

574 fast tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`3ff83da`](https://github.com/tsenoner/protspace/commit/3ff83dae01d4390e7a4cb09b49218bd31eb8968d))

* fix(stats): harden projection-statistics correctness, scaling, and defaults

Refinements to the not-yet-released stats subsystem from a /simplify pass, an
xhigh /code-review, and researched fixes for the deferred review findings.

Correctness:
- base_processor.save_output: persist `settings` in the unbundled (--no-bundle)
  branch too — cluster legend styles were silently dropped there.
- cli/stats: union same-name -i inputs (merge_same_name_sets) so multi-file
  same-embedding runs don't collapse to the last set; guard --settings-out to
  require -a; write metadata/annotations parquet atomically (temp + rename);
  infer 3D from z when projection metadata is absent.
- faithfulness continuity: compute via a correct dual (`_continuity`) so the
  embedding is ranked by the run's high-dim metric (was always euclidean);
  bit-identical on the euclidean default path.
- validity silhouette: report the aggregate as the exact per-point mean when the
  per-point column is computed (was an inconsistent sampled estimate).
- faithfulness subsample: select on canonical id order so scores are row-order
  invariant (matching the already order-invariant seed).

Scaling / cleanup:
- kmeans_elbow: fit the K sweep on a bounded subsample (MiniBatchKMeans) +
  predict above 50k points; full-batch unchanged below. Remove the write-only
  silhouette_optimal_k cross-check and its duplicate silhouette compute.
- Collapse duplicated faithfulness try/except into a loop; drop the
  self._stats_settings side channel (return (table, settings)); remove a
  redundant empty-table branch, a needless list copy, a double np.unique, and an
  unused shape param; centralize the reduction `source` stamp via a closure.

Behavior:
- prepare: `--stats` now defaults to False (opt-in) — heavy compute + bundle
  column/style injection should not run on every run.

Adds regression tests (continuity dual, subsample determinism/order-invariance,
silhouette consistency, unbundled settings, --settings-out guard). 565 tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`fc7a1cd`](https://github.com/tsenoner/protspace/commit/fc7a1cd7f440d3f2a00fbe5d34ee51398d4b8a76))

### Performance Improvements

* perf(stats): _align fancy-indexed a full copy of the embedding even when faithfulness skips it past the ceiling; return source arrays as views on an in-order identity match

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`e9b5b43`](https://github.com/tsenoner/protspace/commit/e9b5b43a48c4a35f62bba18bf25f3d223cc373a3))

### Refactoring

* refactor(stats): high_dim_metric stacked 'info.metric or default_metric or euclidean' redundantly; normalise default_metric once so the fallback lives in one place

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`41997f9`](https://github.com/tsenoner/protspace/commit/41997f96019c7241b3d7d24a3e2664acd3a4ca8f))

* refactor(stats): the elbow _Labeling tuple was copy-pasted for the primary and fallback cases; build it via a local _elbow_labeling() helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`4fd8b01`](https://github.com/tsenoner/protspace/commit/4fd8b0173e88e12ef32e964448d05a38651147b2))

* refactor(stats): DEFAULT_SAMPLE_THRESHOLD was defined identically in three metric modules; hoist it to stats.base and import it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`f5b4dd0`](https://github.com/tsenoner/protspace/commit/f5b4dd04cfade3f22bb3b73f3c2aaff9f40b6472))

* refactor(stats): annotation_select re-listed the missing-value tokens that standardize_missing hardcodes; share them via core.constants.MISSING_VALUE_TOKENS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`fb7a3b9`](https://github.com/tsenoner/protspace/commit/fb7a3b9c312981c5b242c14d480020569807a3c0))

* refactor(stats): address final-review nits (docstrings, validation, extra-copy, cleanups)

Fixes six minor findings from the whole-branch review of the
annotation-based cluster-validity feature: stale eight-column docstrings
in stats/base.py, a strict "auto" guard in cli/stats.py that didn't match
the parser's normalised comparison, a shared/aliased `extra` dict across
StatRows in annotation_validity.py, an unused np.unique return in
validity.py, a duplicated _clean() call in annotation_select.py, and a
doc/notebook wording+formatting nit.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`35e3a28`](https://github.com/tsenoner/protspace/commit/35e3a282fafdc0206c9f0dc59065e266fc929d23))

* refactor(stats): drop auto-cluster self-validity, add ARI/NMI agreement

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`1efa34c`](https://github.com/tsenoner/protspace/commit/1efa34c5b8ec9c1083651f410d54c8948116f343))

* refactor(stats): rename elbow membership column to cluster_elbow_<proj> + sync docs

- Rename the elbow clustering's membership column cluster_<proj> -> cluster_elbow_<proj>
  so both selections are explicitly named (cluster_elbow_ / cluster_silhouette_).
  The column name is the only provenance signal that survives to the frontend
  (AnnotationColumn.extra is dropped at carriage), so name the method in it.
- Bring docs + notebook current with the whole extras feature set (they only
  reflected the base PR): --cluster-selection, silhouette-as-attached-score
  (no separate silhouette_ column), and the local/global faithfulness split.
  Updated docs/cli.md, CLAUDE.md, README.md, ProtSpace_Preparation.ipynb.

574 fast tests pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com> ([`babba41`](https://github.com/tsenoner/protspace/commit/babba41893792893ed2899779b02f78186610792))

### Testing

* test(stats): test_base_data_processor imported via src.protspace.* while the new stats suite used protspace.*, duplicating module singletons under one pytest run; standardize this file on protspace.*

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`7c25c55`](https://github.com/tsenoner/protspace/commit/7c25c5508f1707e576df0eb6be896df04cd21181))

* test(stats): legend-envelope test used isinstance-only checks so a bad value (e.g. maxVisibleValues=0) would pass; assert the actual field values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`2d5457e`](https://github.com/tsenoner/protspace/commit/2d5457e2829f121505f015074e723d19582dc4fe))

* test(stats): the global-metric test only asserted the by-construction [0,1]/[-1,1] bounds (vacuous); assert a faithful projection scores meaningfully high instead

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`af2d59f`](https://github.com/tsenoner/protspace/commit/af2d59f3ce8f72852f00421bda2527097f1f7aa0))

* test(bundle): extract_bundle_to_dir was only tested stats-only; add a full 5-part case asserting both settings and statistics files land with correct content

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`f66a8a4`](https://github.com/tsenoner/protspace/commit/f66a8a423f3c900916e16b733c2b98e7365fb63d))

* test(stats): no end-to-end test drove an explicit --stats-annotation list; add one asserting only the named columns are scored (not a silent auto fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`1a56750`](https://github.com/tsenoner/protspace/commit/1a56750043202efa35ef4fae20ce9515290b0418))

* test(stats): the _align positional-fallback positive branch (no ids, equal rowcounts) was untested; add a test that a wrong-order pairing would fail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`5c6a033`](https://github.com/tsenoner/protspace/commit/5c6a033663c7f0e24da4bc47ecaaa85fb335491c))

* test(stats): the kmeans_elbow subsample test asserted determinism at fixed row order only; add a row-permutation invariance test that locks in the id-canonical fix

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`940cb18`](https://github.com/tsenoner/protspace/commit/940cb18cf7504248a4b49ed2d6e490a9e96185c2))

* test(stats): the annotation-validity determinism test reran with identical row order so couldn't catch a non-id-canonical subsample; add a row-permutation invariance test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com> ([`a5a99c4`](https://github.com/tsenoner/protspace/commit/a5a99c4e9fe97f61946865b68373c70cd4d1810d))

* test(stats): add annotation="" to carriage faith-row helper

_faith_row() built StatRow(...) without the now-required `annotation`
field, breaking 3 tests after the annotation-dimension schema change.
Faithfulness rows are not annotation-scoped, so annotation="".

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> ([`bae63a7`](https://github.com/tsenoner/protspace/commit/bae63a711255c125cc5946a2394c76db3d03f2dc))

### Unknown

* Merge pull request #61 from tsenoner/feat/projection-statistics

feat(stats): projection statistics (cluster-validity + faithfulness) ([`03c2140`](https://github.com/tsenoner/protspace/commit/03c21403a7574a3048a4f42b786f187077cb271c))

* Merge pull request #65 from tsenoner/feat/annotation-cluster-validity

feat(stats): annotation-based cluster-validity + ARI/NMI agreement ([`17cf0d0`](https://github.com/tsenoner/protspace/commit/17cf0d0d748b5a32a98546046255fcc51f2560c5))

* Merge pull request #63 from tsenoner/feat/projection-stats-extras

feat(stats): cluster-selection, silhouette-as-score, global faithfulness metrics ([`0553202`](https://github.com/tsenoner/protspace/commit/05532028a6adc97313a47f69e24c4e90f3f57f5a))

* Merge pull request #52 from tsenoner/feat/restore-jmb-2025-toxprot

Archive original JMB 2025 toxprot dataset for backwards compatibility ([`bd1c55d`](https://github.com/tsenoner/protspace/commit/bd1c55d6ee00774b2d1ac3ad4dfacec6f14fbbc9))

* Merge pull request #50 from tsenoner/feat/regenerate-toxprot-demo

chore: regenerate toxprot demo bundle (ProtT5 + ESM2-650M, mature peptides) ([`db12e33`](https://github.com/tsenoner/protspace/commit/db12e33a46eb85a098be7005a63b86374f0c4b74))

* Merge pull request #49 from tsenoner/docs/multi-dr-params-followup

docs: clarify multi-DR-params syntax and notebook gap ([`7c69274`](https://github.com/tsenoner/protspace/commit/7c6927471d27a0e8ccf2aead31159edee6467375))


## v4.4.0 (2026-04-27)

### Documentation

* docs: document multi-input merging behavior (union vs intersection)

Document the fix from #44 — when multiple -i inputs share the same
embedding name, proteins are unioned; different names still intersect.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`aca1beb`](https://github.com/tsenoner/protspace/commit/aca1bebd3feb9276083fb8a1ab68a1693f2ebe49))

* docs: add git workflow convention to CLAUDE.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`58e5abf`](https://github.com/tsenoner/protspace/commit/58e5abffaa2d17b540960122afab6cf192422670))

### Features

* feat: support multiple DR parameter sets in a single prepare run (#46)

Allow inline per-method parameter overrides in the -m flag using colon
syntax with semicolon-separated params. This enables comparing the same
DR method with different parameters in a single run without re-running
the full pipeline.

Example: -m "umap2:n_neighbors=15" -m "umap2:n_neighbors=50" -m pca2

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b2587d0`](https://github.com/tsenoner/protspace/commit/b2587d0b43d13b1b17cec12b85fa41a087cfb5e5))

### Refactoring

* refactor: use _run_with_overridden_config in precomputed-MDS branch

The precomputed-MDS branch in _run_reductions was the last call site
still mutating self.base.config in place (set precomputed=True, then
pop() after). Migrate it to _run_with_overridden_config so:

- The save/restore pattern is consistent across all reduction call sites.
- A precomputed flag can no longer survive in base.config if
  process_reduction raises mid-call.

Regression tests cover both the happy path (flag is set during
reduction, cleared after) and the exception path (flag is cleared
even when reduction raises).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8623365`](https://github.com/tsenoner/protspace/commit/8623365e49df06fa6db5ebb75f7cf7a26bfd797e))

* refactor: extract _run_with_overridden_config and dedupe project loop

- Add _run_with_overridden_config(base, effective_params, method, dims, data)
  to pipeline.py to centralize the save/restore pattern for BaseProcessor.config.
  A leaked `precomputed` flag (or any temporary key) can no longer survive
  across reduction calls.
- Update ReductionPipeline._run_reductions and cli/project.py to use both
  the new helper and disambiguation_suffix. cli/project.py previously set
  base.config without restoring it; this is now handled in one place.
- Hoist the lazy in-test imports added in the previous commit to the top-level
  import block in tests/test_pipeline_utils.py.

Addresses PR #48 review feedback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`4fa5e6f`](https://github.com/tsenoner/protspace/commit/4fa5e6fd8cbb4aaaf86c4dbd50a32496576d14ee))

* refactor: extract disambiguation_suffix helper

Centralize the param-suffix rule used by ReductionPipeline._run_reductions
into a single helper so cli/project.py can share it (follow-up commit).

Includes a regression test for the mixed plain+override case
(`-m umap2 -m umap2:n_neighbors=50`) which currently emits "ProtT5 — UMAP 2"
and "ProtT5 — UMAP 2 (n=50)".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> ([`8bb4a4c`](https://github.com/tsenoner/protspace/commit/8bb4a4c3fc7d937beb64db0d977ba76c72c0d595))

### Unknown

* Merge pull request #48 from tsenoner/feat/multi-dr-params

feat: support multiple DR parameter sets in a single prepare run ([`b0b73f5`](https://github.com/tsenoner/protspace/commit/b0b73f59fe7bc71d33e29fee91044beead75fe8f))

* Merge pull request #47 from tsenoner/docs/multi-input-merging

docs: document multi-input merging behavior ([`b7cc16d`](https://github.com/tsenoner/protspace/commit/b7cc16d191e00d7ee0e33cb24912f865104036a0))

* Merge pull request #45 from tsenoner/docs/git-workflow-convention

docs: add git workflow convention to CLAUDE.md ([`04ed565`](https://github.com/tsenoner/protspace/commit/04ed5655e59dd13d86846b17768ac07c1e65c944))


## v4.3.1 (2026-04-17)

### Fixes

* fix: union protein IDs when multiple inputs share the same embedding name

When multiple -i inputs resolve to the same embedding name (e.g. two species
both embedded with ProtT5), their proteins are now concatenated (unioned)
instead of intersected. Inputs with different names still use intersection
for multi-embedding comparison. Fixes #44.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`fdb1f54`](https://github.com/tsenoner/protspace/commit/fdb1f54bb446036f2b6eb76706c898fb6df48c9e))


## v4.3.0 (2026-04-01)

### Continuous Integration

* ci: re-trigger release after corrupted merge event for PR #41

The merge commit (3725f87) landed on main but GitHub never processed
the push event due to a network issue, so CI, release, and issue
auto-close were all skipped. ([`6fae84d`](https://github.com/tsenoner/protspace/commit/6fae84dbbd65697e502936312208ea29a7173e27))

### Documentation

* docs: cache FASTA and embeddings in Colab notebook

Pass embedding_cache to embed_fasta() and cache UniProt query FASTA
to output/tmp/ so re-runs skip expensive API calls. Also clean up
unused imports flagged by ruff.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7e17236`](https://github.com/tsenoner/protspace/commit/7e17236912bc73227fe8ef6f05dbcf6b7d2cea4e))

* docs: update CLI caching section, test table, and UniProt ID handling

- Expand docs/cli.md caching section to document all 5 cached items
  (FASTA, embeddings, annotations, similarity, DR projections)
- Add 3 new test files to CLAUDE.md test table (pfam_clan, ted, biocentral)
- Update UniProt ID handling docs: identifiers must be bare accessions
- Update test counts (uniprot_retriever: 29→24 after _manage_headers removal)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d4a4a14`](https://github.com/tsenoner/protspace/commit/d4a4a1481d74f22128c00bc5ece60d714b4c08a7))

* docs: update annotations.md with all five data sources and groups

Fix header (three → five sources), add TED and Biocentral rows to
summary table, update InterPro count (9 → 10 for pfam_clan), add
ted and biocentral to group presets table, add CLI example.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`8fe8f82`](https://github.com/tsenoner/protspace/commit/8fe8f82ede0223cdbfa54f04ca1a8948dc8f15b3))

* docs: update Colab notebook with new annotation sources

Add pfam_clan, TED Domains, and Biocentral prediction annotations
to the ANNOTATIONS dict in the preparation notebook.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d667d93`](https://github.com/tsenoner/protspace/commit/d667d937499e78899d3b8a49d39274f315764ddf))

### Features

* feat: replace --force-refetch with granular --refetch <stages>

Replace the all-or-nothing --force-refetch boolean with --refetch
accepting comma-separated stage names for selective cache invalidation:
query, embed, similarity, projections, uniprot, taxonomy, interpro,
ted, biocentral. Shorthands: all, annotations.

Also fixes a bug where --force-refetch skipped TED and Biocentral
annotations, and suppresses the biocentral API length warning.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7dadeff`](https://github.com/tsenoner/protspace/commit/7dadeffec3e0b998befd2b2b3de3af901967ab00))

* feat: use official CATH names file for all-level code resolution

Replace InterPro XML-based CATH name lookup with the authoritative
cath-names-v4_4_0.txt file (393 KB vs 90 MB). This provides names at
all 4 CATH hierarchy levels (Class, Architecture, Topology, Superfamily),
fixing resolution of partial codes like 2.60.40 from the AlphaFold API.

- New shared module: cath_names.py (download, cache 30 days, parse)
- TED retriever: direct lookup at any level, no G3DSA: prefix needed
- InterPro retriever: CATH names from CATH file, SSF/PANTHER still from
  InterPro XML
- Unnamed superfamilies inherit parent topology name as fallback

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9b906db`](https://github.com/tsenoner/protspace/commit/9b906db1ad42b177140a8a19ec3af1d7e404deea))

* feat: cache FASTA downloads, MMseqs2 similarity, and DR projections

When keep_tmp is active (default), all intermediate results are now
cached under {output}/tmp/ and reused on subsequent runs:

- FASTA: skip re-download if tmp/sequences.fasta exists
- Similarity: save/load similarity_matrix.npy + similarity_headers.npy
- DR projections: save/load .npz files keyed by (embedding, method,
  dims, params_hash) so different parameters produce separate caches

All caches are bypassed with --force-refetch (help text updated to
reflect its broader scope). Cache hits log a WARNING for visibility.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`038e502`](https://github.com/tsenoner/protspace/commit/038e5025dfa1be368da0c9b8f9fc96c5585334cd))

* feat: add Biocentral prediction annotations (subcellular location, membrane, signal peptide, transmembrane)

Fetch per-protein predictions from the Biocentral API:
- predicted_subcellular_location (LightAttention, 10 classes)
- predicted_membrane (LightAttention, Membrane/Soluble)
- predicted_signal_peptide (TMbed-derived, True/False)
- predicted_transmembrane (TMbed-derived, none/alpha-helical/beta-barrel)

Closes #40

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`8a4609a`](https://github.com/tsenoner/protspace/commit/8a4609a72f2d3129643eef3737e83fd430d3179b))

* feat: add TED domain annotations via AlphaFold Database API

Query alphafold.ebi.ac.uk/api/domains/{acc} per protein to get TED
(The Encyclopedia of Domains) structural domain annotations. Resolves
CATH superfamily codes to names using the existing InterPro CATH-Gene3D
name map.

Output format: "2.60.40.720 (Immunoglobulin-like)|95.1;3.40.50.300|88.3"

Closes #22

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`91fc68d`](https://github.com/tsenoner/protspace/commit/91fc68d087d9756422ffab304ea0376d3dda956f))

* feat: add pfam_clan annotation — maps Pfam families to CLANS

Downloads Pfam-A.clans.tsv from EBI FTP (cached 30 days), maps Pfam
accessions from InterPro annotations to clan IDs with names.
Output format: "CL0023 (P-loop_NTPase);CL0192 (HAD)"

Closes #38

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`44a1774`](https://github.com/tsenoner/protspace/commit/44a17748712be37e8b1f2341c76146e18361681e))

### Fixes

* fix: use CATH latest-release URL instead of hardcoded v4_4_0

The latest-release/ path is a stable alias that always points to the
current CATH release, so we automatically pick up new versions.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`bbb2dbf`](https://github.com/tsenoner/protspace/commit/bbb2dbf4c0d8a887ff469823a1b755f54a9fd3ab))

* fix: consolidate repetitive cache-hit messages into compact summaries

Group per-item cache warnings (projections, embeddings) into single
summary lines, remove repeated --force-refetch hints in favor of one
at the end, and demote verbose per-item logs to INFO level.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9245e8d`](https://github.com/tsenoner/protspace/commit/9245e8dcbafc694d0128d114ebb015fdb52a711f))

* fix: warn when using cached annotations and when cache is all empty

Change cache-hit message from INFO (only visible with -v) to WARNING
so users always know when cached data is being used. Also detect and
warn about all-empty cached annotations with actionable advice
(--force-refetch or -f).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`64e3cbd`](https://github.com/tsenoner/protspace/commit/64e3cbd990d2a8011eda8200670fdc0f4771ee28))

* fix: simplify UniProt ID handling and document annotation input requirements

Remove _manage_headers() — identifiers must be valid UniProt accessions
directly. Non-matching IDs are skipped with a clear warning that
distinguishes accession-dependent (UniProt, Taxonomy, TED) from
sequence-dependent (InterPro, Biocentral) annotations.

Also:
- Fix _add_required_annotations() to include 'sequence' for Biocentral
- Simplify _build_sequence_map() (no reverse mapping needed)
- Document input requirements in docs/annotations.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`65ab8ac`](https://github.com/tsenoner/protspace/commit/65ab8ac6436f011e3d566b2deaa2c54fd9876e00))

* fix: improve annotation validation error with suggestions and group list

Show fuzzy-matched suggestions (via difflib), list available groups,
and link to online annotation reference. Example output:

  Unknown annotation 'biocentra'. Did you mean: biocentral?
    Groups: all, biocentral, default, interpro, taxonomy, ted, uniprot
    See https://github.com/tsenoner/protspace/blob/main/docs/annotations.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`27fb824`](https://github.com/tsenoner/protspace/commit/27fb82484314bac9ce40f1ad4081ceed21397d2c))

* fix: attach -f FASTA path to H5 embedding sets for sequence reuse

When user provides H5 embeddings with -f fasta.fasta, store the FASTA
path on the EmbeddingSet so sequences are available for Biocentral
predictions and InterPro without needing UniProt accessions.

Also improve the warning message when no sequences are available.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1c0bafd`](https://github.com/tsenoner/protspace/commit/1c0bafdc83cabaf110d664e42ce987fd30c067cf))

* fix: use cache dir for MMseqs2 temp files instead of system temp

Pass cache_dir from CLI to compute_similarity() so MMseqs2 temp files
are stored alongside other cached data. Falls back to system temp
when no cache dir is available. Only cleans up temp files when using
system temp (cache dir is preserved for reuse).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`dd9b273`](https://github.com/tsenoner/protspace/commit/dd9b27346ee6bc75452bcc49ee12f3047381550d))

* fix: pass FASTA sequences through pipeline and deduplicate for Biocentral

- Extract sequences from EmbeddingSet.fasta_path in the pipeline and
  pass them to ProteinAnnotationManager, avoiding redundant UniProt
  sequence re-fetches for FASTA/Query input modes
- Merge local sequences (priority) with UniProt sequences (fallback)
  in both _fetch_interpro() and _fetch_biocentral()
- Deduplicate sequences before sending to Biocentral API (rejects
  duplicate sequences) and map predictions back to all headers sharing
  the same sequence

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b778a7e`](https://github.com/tsenoner/protspace/commit/b778a7ecd1eacccdfcb8a57244f262b31b149b0f))

* fix: add tests for new annotations and update CLI help text

- Add 7 unit tests for Pfam CLAN transformer (mapping, dedup, edge cases)
- Add 7 unit tests for TED retriever (mocked AlphaFold API, CATH names)
- Add 14 unit tests for Biocentral retriever (TMbed parsing, per-sequence)
- Update CLI help text to include ted and biocentral groups
- Update annotations.md overview with all five sources and group presets

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`6506c83`](https://github.com/tsenoner/protspace/commit/6506c83caae225d8b2dc7a2384ff491b0ed1357f))

### Unknown

* Merge pull request #41 from tsenoner/feat/extend-annotations

feat: extend annotations, improve caching, and fix sequence handling ([`3725f87`](https://github.com/tsenoner/protspace/commit/3725f87a00845dd0fdcfbb7c05c83e161fd6e715))


## v4.2.0 (2026-03-28)

### Features

* feat: replace unipressed with direct UniProt REST API calls

Replace the unipressed library (community UniProt API wrapper) with
direct HTTP calls to rest.uniprot.org. Adds _fetch_many_accessions()
and _search_sec_acc() helpers using the same Link-header pagination
pattern as the taxonomy retriever.

Simplifies the sec_acc search fallback from 8 lines of page-parsing
to a single function call.

Closes #32

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5605a93`](https://github.com/tsenoner/protspace/commit/5605a935e680132ee7d22adb30a45b3ff26df02b))

### Refactoring

* refactor: extract shared paginated_get() utility for REST API calls

Consolidate the duplicated Link-header pagination loop (4 instances
across uniprot_retriever, taxonomy_retriever, and uniprot_parser) into
a single paginated_get() function in http_utils.py. Each caller is
now a 1-3 line function.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`cd528ed`](https://github.com/tsenoner/protspace/commit/cd528ed68ba7cf9bf3a33183345b483c00b4f9d1))

### Unknown

* Merge pull request #39 from tsenoner/feat/replace-unipressed-with-direct-api

Replace unipressed with direct UniProt REST API calls ([`5d365c7`](https://github.com/tsenoner/protspace/commit/5d365c70dfb66fe1754fb610c7df3acb3cfae480))


## v4.1.0 (2026-03-28)

### Features

* feat: replace taxopy with UniProt Taxonomy API for taxonomy lookups

Replace the taxopy-based taxonomy retriever (which required downloading
the full NCBI taxonomy database ~50 MB on first use) with the UniProt
Taxonomy API (/taxonomy/search). This eliminates the slow first-run
download, weekly cache refresh, and ~120 lines of cache management code.

Also fix typer[all] → typer (the [all] extra was removed) and add
requests as an explicit core dependency.

Closes #36

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`754fa9b`](https://github.com/tsenoner/protspace/commit/754fa9b45cf5a913a97823b2b45012c49221ca7a))

### Unknown

* Merge pull request #37 from tsenoner/feat/replace-taxopy-with-uniprot-api

Replace taxopy with UniProt Taxonomy API ([`034c0ec`](https://github.com/tsenoner/protspace/commit/034c0ece32238144fe68819ce2b6e5e43d8b57a5))


## v4.0.2 (2026-03-28)

### Fixes

* fix(ci): replace semantic-release publish with gh release upload and remove unused deps

semantic-release publish fails in detached HEAD (tag checkout). Use
gh release upload instead, and drop the now-unused python-semantic-release
tool install + cache from the pypi job.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1b45ddb`](https://github.com/tsenoner/protspace/commit/1b45ddb86fc9c69c3491d879212b70e2a1dd30ba))


## v4.0.1 (2026-03-28)

### Fixes

* fix(ci): bump all workflow actions to latest versions and add uv lock to semantic-release build

- Bump actions in release.yml and publish.yml to Node 22+ versions
  (checkout v6, setup-python v6, setup-uv v7, cache v5, etc.)
- Add build_command = "uv lock" to semantic-release config so uv.lock
  is regenerated after version bumps, fixing Docker --locked builds

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`2474612`](https://github.com/tsenoner/protspace/commit/24746126da81515e3fdf9ca4ffca9d21feb55250))


## v4.0.0 (2026-03-28)

### Breaking

* fix(ci)!: use GitHub App token for repository-dispatch to trigger publish workflow

The trigger-publish job was using the default GITHUB_TOKEN, which cannot
trigger other workflows due to GitHub's anti-recursion protection. Generate
a GitHub App token in the job and pass it to peter-evans/repository-dispatch.

BREAKING CHANGE: CLI flags changed in v3.3.1→v4.0.0 release cycle —
--no-scores replaced by --scores/--no-scores (default: scores enabled),
--non-binary removed (legacy JSON output dropped, only Parquet remains),
--half-precision removed (not implemented in Biocentral server).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5cfb265`](https://github.com/tsenoner/protspace/commit/5cfb26549fdad5d196e8feb0f880bd988a31610b))

### Chores

* chore: clean up scripts/, examples/, and .gitignore

Remove redundant scripts (biocentral/, figures_script/, check_version_bump.sh,
download_foldcomp.sh, plotly_markers.py, probe_hf_models.py), stale example
visualizations (examples/out/, ~60MB tracked), unused assets (annotate.py),
and bin/foldcomp. Move Workflow.svg to docs/publication/.

Trim .gitignore from 182-line GitHub template to 42 lines of project-relevant
rules. Add missing ignores (.playwright-mcp, .ruff_cache). Un-ignore scripts/
now that only useful scripts remain. Fix stale CLAUDE.md reference to removed
biocentral_embed.py.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`c4986ae`](https://github.com/tsenoner/protspace/commit/c4986ae04afd7bb1eaff15206cceaa105e629a42))

### Code Style

* style: fix ruff formatting in arrow_reader.py and reducers.py

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1aadcc9`](https://github.com/tsenoner/protspace/commit/1aadcc922b6f56bb113e45aa8cfef1a7b5b29ee7))

### Continuous Integration

* ci: add ruff lint + pytest workflow on push/PR

Runs ruff check (blocking) and ruff format --check (advisory) plus
pytest with fast tests on push/PR to main and stage branches.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`930b628`](https://github.com/tsenoner/protspace/commit/930b62895b2f0a6e6ada038ff29f0499e315fad4))

### Documentation

* docs: remove legacy Dash frontend link from README

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b9ca1e5`](https://github.com/tsenoner/protspace/commit/b9ca1e576cabda1895ad2138bbc1c06aa22f36b1))

* docs: update notebook examples to use parquetbundle release assets

Point ProtSpace_Preparation.ipynb to the new `examples` release tag
with pre-generated .parquetbundle files instead of old H5 embeddings.

- URL: releases/download/v3.3.1/ → releases/download/examples/
- Replace 4 old H5 datasets with 5 new parquetbundles:
  three_finger_toxin, beta_lactamase, globin, phosphatase, snake_toxin

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`411b27e`](https://github.com/tsenoner/protspace/commit/411b27ec0dcae66214c86b8109972aba83ba3324))

* docs: rewrite CLI reference — concise, complete, with colon syntax guide

Tighten all sections, add detailed prepare description with input
types, add model name resolution section explaining -i file.h5:name
colon syntax for external HDF5 files. Document --no-log and --keep-tmp.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`746b288`](https://github.com/tsenoner/protspace/commit/746b288ea1b6290874f5cd59732a11133db5573b))

* docs: remove Explore_ProtSpace.ipynb (legacy Dash frontend)

Downloads pre-generated JSON and launches old Dash UI in Colab.
Replaced by protspace.app/explore for .parquetbundle visualization.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5593276`](https://github.com/tsenoner/protspace/commit/5593276f28703a3e0883a6ec42fb852961779472))

* docs: remove Run_ProtSpace.ipynb (legacy Dash frontend)

The notebook launched the old Dash frontend inline in Colab.
Users should use ProtSpace_Preparation.ipynb to generate a
.parquetbundle and upload it at protspace.app instead.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`2afc9cf`](https://github.com/tsenoner/protspace/commit/2afc9cf24ed7031d5fa84456953ad8f368788a3d))

* docs: update Colab notebooks for new CLI

Update all 3 affected notebooks for the v4.0.0 CLI:
- ProtSpace_Preparation.ipynb: protspace-local → protspace prepare,
  update n_neighbors range (2-500, default 25), perplexity range (5-5000),
  eps default (1e-6)
- Run_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens
- PfamExplorer_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens, n_neighbors range updated

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`fd9d2aa`](https://github.com/tsenoner/protspace/commit/fd9d2aa87d2b680545dcdb8e4ec84513d6b74e95))

* docs: update Colab notebooks for new CLI

Update all 3 affected notebooks for the v4.0.0 CLI:
- ProtSpace_Preparation.ipynb: protspace-local → protspace prepare,
  update n_neighbors range (2-500, default 25), perplexity range (5-5000),
  eps default (1e-6)
- Run_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens
- PfamExplorer_ProtSpace.ipynb: protspace-local → protspace prepare,
  parameter names with hyphens, n_neighbors range updated

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`752bd25`](https://github.com/tsenoner/protspace/commit/752bd2504e3feea8f6856d2c4c74cf131b98c40a))

* docs: update CLI reference, README, and CLAUDE.md for new typer CLI

- Rewrite docs/cli.md with all 7 subcommands (prepare, embed, project,
  annotate, bundle, serve, style), model name resolution, projection
  naming, and annotation caching documentation
- Update README.md quick start with new CLI commands and power-user
  workflow examples
- Update CLAUDE.md: CLI commands table, package structure (loaders,
  pipeline), usage examples

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`5cce1d1`](https://github.com/tsenoner/protspace/commit/5cce1d1f31bc3982168bae09554e1161623f94b4))

* docs: add CLAUDE.md with full project reference

Merge the previously split .claude/CLAUDE.md (untracked, comprehensive)
and CLAUDE.md (untracked, slim pointer) into a single tracked CLAUDE.md.
Includes package structure, DR methods, implementation details, testing,
conventions, and uv run instructions.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`fbed9c2`](https://github.com/tsenoner/protspace/commit/fbed9c218ace754abfb8b4cea58c3b7dd6cf68f6))

### Features

* feat: add pre-commit hook for auto ruff format and lint fix

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`beace0f`](https://github.com/tsenoner/protspace/commit/beace0f01355699f75f206b1c7f7aa7ad2d17b98))

* feat: add CSV annotation support to protspace prepare pipeline

- _resolve_annotation_names() now detects .csv/.tsv file paths and
  separates them from annotation names
- _fetch_annotations() loads user CSV and merges with API annotations
  (CSV wins on column name collision)
- Update docs/annotations.md: protspace-local → protspace prepare
- Update docs/cli.md: mention CSV/TSV in -a flag description
- Update CLI help text to mention CSV/TSV file paths
- Add 3 tests for CSV path parsing

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7b834b3`](https://github.com/tsenoner/protspace/commit/7b834b3572e0da28425e00310cc21c1a596bb282))

* feat: add example dataset generation system

TOML-driven generation of reproducible example datasets that test the
full pipeline and serve as release assets. Each dataset adds complexity:

1. three_finger_toxin (536) — basic single-PLM
2. beta_lactamase (731) — multi-PLM comparison (prot_t5 + esm2_650m)
3. globin (1,200) — sequence similarity + MDS
4. phosphatase (1,587) — all annotations
5. cytochrome_p450 (~5,500) — includes unreviewed TrEMBL entries

- scripts/generate_examples/datasets.toml: dataset registry
- scripts/generate_examples/generate.py: CLI orchestrator wrapping
  `protspace prepare`, supports --dataset/--all/--skip-existing/--list
- .gitignore: allow scripts/generate_examples/ (was fully ignored)

Usage:
  uv run python scripts/generate_examples/generate.py --dataset three_finger_toxin
  uv run python scripts/generate_examples/generate.py --all

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`8c0246c`](https://github.com/tsenoner/protspace/commit/8c0246cb152c850ad3e45925c71a4bf5c9dc3e68))

* feat(cli): add run.log for reproducibility, improve error messages

- protspace prepare now writes a run.log to the output directory
  capturing all parameters, timing, and version info. Appends with
  separator on re-runs. Disable with --no-log.
- Wrap input-loading + pipeline in try/except so ValueError and
  FileNotFoundError show clean messages without tracebacks.
- Improve missing model_name error with actionable fix command
  using the user's actual file path.
- Ruff format on changed files.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`bfba756`](https://github.com/tsenoner/protspace/commit/bfba7569bb9fa30f8cc587cc4a1327f16dd46068))

* feat(embed): add 7 new pLM embedders via Biocentral API

Expand supported models from 5 to 12 by adding ESM2-35M, ESM2-150M,
Ankh-Base, Ankh-Large, Ankh3-Large, and ESMC-300M/600M (via Synthyra
ESM++ reimplementation). Remove unsupported one_hot, blosum62,
aa_ontology, and random embedders.

New EXTRA_SHORT_KEYS dict maps short aliases directly to HuggingFace
model names for models not in the CommonEmbedder enum. resolve_embedder()
checks both dicts. Documentation updated with full model table including
embedding dimensions and licensing info (Ankh/ESMC-600M are non-commercial).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`837a239`](https://github.com/tsenoner/protspace/commit/837a2390c35280a5c2ae2485cfb67c9a77a3fb0f))

* feat(cli): add individual step commands (embed, project, annotate, bundle)

Add power-user subcommands for running each pipeline step independently,
similar to mmseqs2's composable design.

- protspace embed: FASTA → HDF5 via Biocentral API (repeatable -e)
- protspace project: HDF5 → projection parquets (DR on embeddings)
- protspace annotate: HDF5/FASTA → annotation parquet (API fetch)
- protspace bundle: projections + annotations → .parquetbundle

All commands use the same loader infrastructure as `protspace prepare`.

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`121e40e`](https://github.com/tsenoner/protspace/commit/121e40e74a5254996f8cd2faa2e68259c06de5e5))

* feat(cli): add multi-embedding and multi-embedder support

Support multiple embedding sources and models in the prepare command.

- Make -e/--embedder repeatable: -e prot_t5 -e esm2_3b embeds FASTA
  with each model, producing separate EmbeddingSets
- Add -i colon syntax for model name override: -i file.h5:model_name
  (parsed by _parse_input_specs helper)
- Change -i from list[Path] to list[str] to support colon parsing
- Each -i flag creates a separate EmbeddingSet (multi-embedding)
- Pipeline prefixes each projection: "esm2_3b — PCA_2", "prot_t5 — UMAP_2"

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`a57a93f`](https://github.com/tsenoner/protspace/commit/a57a93ffb871b23092ea3367599eaa5e6d1b9bcc))

* feat(pipeline): create unified ReductionPipeline, remove old processors

Replace LocalProcessor and UniProtQueryProcessor with a single
ReductionPipeline that composes loaders + annotation fetch + DR + output.

- Create data/processors/pipeline.py with PipelineConfig and ReductionPipeline
- Inline annotation fetching logic (from LocalProcessor._fetch_api_annotations)
- Wire cli/prepare.py to use ReductionPipeline + loaders directly
- Support -q/--query via query_uniprot loader + embed_fasta
- Support -s/--similarity via compute_similarity loader
- Always prefix projection names: "{source} — {METHOD}_{D}"
- Delete local_processor.py, uniprot_query_processor.py, common_args.py,
  local_data.py, uniprot_query.py (all replaced by new pipeline + loaders)
- Delete test_local_data_processor.py, test_uniprot_query_processor.py
  (test removed code)
- Update test_output_combinations.py to use BaseProcessor directly
- Update data/__init__.py and processors/__init__.py exports

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ed6c15d`](https://github.com/tsenoner/protspace/commit/ed6c15df3b05cab0e1cd87b4ac7bfc0ce627ae00))

* feat(cli): add typer+rich and create CLI app with prepare/serve/style subcommands

Replace the four separate entry points (protspace, protspace-local,
protspace-query, protspace-annotation-colors) with a single typer-based
CLI app: `protspace {prepare,serve,style}`.

- Add typer[all] and rich as core dependencies
- Create cli/app.py with typer root app, shared utilities (logging, cache
  hash, output path computation), -h shorthand, and clean exception display
- Create cli/prepare.py with all options defined as Annotated type aliases
  (spaCy pattern), grouped into Input/Embedding/Projection/Annotations/Output
  panels via rich_help_panel. Boolean flags use explicit names to avoid the
  --flag/--no-flag toggle. Validates -i or -q required via typer.BadParameter
- Create cli/serve.py wrapping the Dash web frontend
- Create cli/style.py wrapping annotation style management
- Remove --delimiter option (CSV similarity input no longer supported)
- Update pyproject.toml to single entry point: protspace = protspace.cli.app:app

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`d235d28`](https://github.com/tsenoner/protspace/commit/d235d28699746d5d86df3f1d03df103e48cd9aeb))

* feat(local): integrate Biocentral API embedding into protspace-local

FASTA files can now be passed directly to `protspace-local`, which
embeds sequences via the Biocentral API before running dimensionality
reduction. Supports deduplication, length-sorted batching, resume via
HDF5 cache, and all 9 pLM embedders (esm2_8m, prot_t5, etc.).

New CLI flags: --embedder, --batch-size, --half-precision,
--embedding-cache, --probe, --dry-run.

Example:
  protspace-local -i sequences.fasta --embedder esm2_8m -m pca2,umap2

Closes #30

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`53b2157`](https://github.com/tsenoner/protspace/commit/53b215722adb51e445547cf609c5442a89c8f9df))

* feat(uniprot,local): resolve inactive entries via UniParc and harden HDF5 loading

Inactive UniProt entries are now resolved using fetch_one() to detect
merged/deleted status, with sequence recovery from UniParc for deleted
entries and sec_acc: search as fallback. Per-entry diagnostics logged at
DEBUG; a one-line summary at WARNING.

HDF5 loader now handles grouped layouts, validates consistent embedding
dimensions, and rejects per-residue embeddings with a clear error.

Logging uses a tqdm-aware handler to avoid garbling progress bars, and
third-party loggers (urllib3, requests) are capped at WARNING even with
-vv. Redundant InterPro per-batch success logs removed.

CLI error handling improved with specific exception types and clean
sys.exit(1) instead of re-raising tracebacks.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`58fee00`](https://github.com/tsenoner/protspace/commit/58fee0044d08583e833de49fbd94d5cc5034b60e))

* feat(reducers,notebook): add general DR params and seed all stochastic methods

Pass random_state to t-SNE, MDS, PaCMAP, and LocalMAP reducers (previously
only UMAP was seeded), enabling reproducible results across all stochastic
DR methods.

Notebook changes:
- Expose metric, random_state, and eps via interactive widgets
- Fix FloatSlider step bug that made fp_ratio slider non-functional
- Use responsive CSS Grid layout for parameter group boxes
- Suppress PaCMAP's informational "random state is set to" log message

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`7717b55`](https://github.com/tsenoner/protspace/commit/7717b55de6ddb444d38a5d6384e659945e911c49))

### Fixes

* fix(ci): bump all actions to latest major versions (checkout v6, setup-python v6, setup-uv v7)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9feae8c`](https://github.com/tsenoner/protspace/commit/9feae8c324b620241d39b8e2f03cbd42f3f80e40))

* fix(ci): bump actions to Node 22 versions to silence deprecation warnings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`51e1f77`](https://github.com/tsenoner/protspace/commit/51e1f77d6ffd0466a60abdcf2337624dc1c42412))

* fix(ci): run push checks only on main to avoid duplicate PR checks

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`b3c6ab9`](https://github.com/tsenoner/protspace/commit/b3c6ab9536a8599d2a1c90faa7b755d8f2de6e28))

* fix: install protspace from PyPI instead of git in Colab notebook

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e2a2daf`](https://github.com/tsenoner/protspace/commit/e2a2dafed6e9b8246e9c897bf6861bea445cf9e8))

* fix: audit — critical bugs, consistency fixes, and documentation overhaul

Critical fixes:
- MDS reducer: metric param was conflated with precomputed (forced non-metric MDS)
- serve/wsgi: ProtSpace import failed (missing from __init__.py)
- wsgi: loaded .env.example instead of .env

Consistency:
- Align eps default between prepare (was 1e-6) and project (1e-3)
- Fix Metric enum handling (string default → proper enum in project.py)
- Make -a/--annotations repeatable in prepare (was single string)

Code quality:
- Replace print() with logging in Dash callbacks
- Log instead of swallowing exceptions in ArrowReader
- Add per-duplicate DEBUG logging in h5 loader
- Unpin torch, align pyarrow dev dep to >=20.0.0

Documentation:
- Fix outdated file references in CLAUDE.md (local_processor→h5, common_args→app)
- Update test table to actual 16 files with real counts
- Fix styling.md: protspace-annotation-colors → protspace style
- Fix pfam_clans README: protspace local → protspace prepare
- Fix README: add LocalMAP to DR method list
- Fix tests README: uvrun typo, wrong test file, CI description
- Fix help_overview.md typos

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`75a6bf2`](https://github.com/tsenoner/protspace/commit/75a6bf20c8d2e60d44e2fa8ef282928dac4bbe7b))

* fix: use raw H5 keys as identifiers instead of parsing them

H5 keys from UniProt and Biocentral are already clean accessions
(e.g., P12345). The parse_identifier() extraction was lossy for
non-UniProt data (e.g., NCBI|name|species → name) and caused CSV
annotation mismatches. Now H5 keys are used as-is.

parse_identifier() is kept for FASTA header parsing where extraction
is still needed (query.py, fasta.py, similarity.py).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e10e3bf`](https://github.com/tsenoner/protspace/commit/e10e3bfb1be0020d4607d2d66e860b7c9f15f330))

* fix: skip taxonomy/interpro fetch when not requested

ProteinAnnotationManager previously defaulted to fetching all three
annotation sources (UniProt, taxonomy, InterPro) regardless of which
annotations were actually requested. With default annotations (ec,
keyword, length, protein_families, reviewed) — all UniProt-only — this
unnecessarily downloaded the NCBI taxonomy database (~1 min).

Now derives sources_to_fetch from AnnotationConfiguration when not
explicitly provided, so only needed sources are queried.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`1b05dc3`](https://github.com/tsenoner/protspace/commit/1b05dc36756d168a7c6378a3783376e8b42be096))

* fix: identifier parsing, projection naming, CLI cleanup, frontend passthrough

Identifier parsing:
- Parse UniProt accessions from FASTA headers before embedding
  (sp|P12345|NAME → P12345), so H5 keys are clean from the start
- load_h5 also applies parse_identifier as safety net for old H5 files
- similarity loader maps MMseqs2 output IDs through parse_identifier

Projection naming:
- Add format_projection_name() with display name maps for pLMs and methods
- Produces: "ProtT5 — PCA 2", "ESM2-650M — UMAP 2", "MMseqs2 — MDS 2"
- Frontend formatProjectionName() now passes through names as-is

Similarity handling:
- Precomputed sets always get MDS 2 automatically, independent of -m methods
- No longer warns about skipping other methods for precomputed sets

CLI cleanup:
- Remove --custom-names, --probe, --dry-run, --embedding-cache
- Make -e and -a comma-separated (like -m)
- Remove non-pLM embedders, constrain --metric to enum
- Default --metric cosine, --n-neighbors 25, --eps 1e-6
- --keep-tmp default True, -a default "default"

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`8afc64b`](https://github.com/tsenoner/protspace/commit/8afc64b0dab5202b69ce7e0e54cead8633e6759f))

* fix(annotations): resolve EC names for partial/incomplete EC numbers

Parse ExPASy enzclass.txt alongside enzyme.dat to provide human-readable
names for partial EC numbers like 3.4.-.- or 2.-.-.-. Both files are
merged into a single cached map keyed by standard EC format.

Closes #33

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`294b4c7`](https://github.com/tsenoner/protspace/commit/294b4c739ef2ea8b77415485412dab368aa16d09))

* fix(arrow_reader): use first column as identifier instead of hardcoded "protein_id"

Resolves #10

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`edb3eb0`](https://github.com/tsenoner/protspace/commit/edb3eb01bf29a5c86e4efae88fee8dd3e34afcc3))

### Performance Improvements

* perf: lazy per-method reducer imports + use logger for taxonomy status

- Move umap/pacmap imports into fit_transform() so PCA-only runs skip
  pynndescent/numba entirely
- Replace print() with logger.info() for taxonomy database download
  status — proper logging, controllable by callers

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`17530b8`](https://github.com/tsenoner/protspace/commit/17530b8db1b4d920eb257122733773fcbd5239b0))

* perf: lazy-load umap/pacmap per-method instead of all at once

Move `from umap import UMAP` and `from pacmap import PaCMAP, LocalMAP`
from top-level into each reducer's fit_transform() method. PCA-only
runs no longer trigger pynndescent/numba JIT compilation.

Before: importing reducers.py loaded all 6 reducer libraries (~3s).
After: importing reducers.py loads only sklearn (~0.3s). umap/pacmap
are imported on first use of their respective reducers.

Verified: PCA run completes with umap=False, pacmap=False in sys.modules.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`8cb0751`](https://github.com/tsenoner/protspace/commit/8cb0751a5e209a2bf270f50fdb336920890629ab))

* perf: defer heavy reducer imports (umap/pacmap/numba) until first use

Extracted DimensionReductionConfig and method name constants from
reducers.py into a new constants.py with zero heavy dependencies.

Before: importing pipeline.py triggered reducers.py which eagerly
imported umap, pacmap, pynndescent, and numba — ~3s locally, ~30-60s
in Colab due to CUDA/TensorFlow interference.

After: pipeline.py imports only constants.py (0.3s). The heavy reducer
classes are loaded lazily via get_reducers() at reduction time.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`0203a83`](https://github.com/tsenoner/protspace/commit/0203a8372f1d820ce6dc52b6cede44b1e1403965))

* perf: lazy imports for 20x faster CLI startup (2.0s → 0.1s)

Defer heavy ML library imports (sklearn, umap, pacmap, pandas,
pyarrow) until first use via PEP 562 module __getattr__. CLI help
now responds in ~100ms instead of 2 seconds.

- utils/__init__.py: lazy-load reducer classes via get_reducers()
  and __getattr__ with __dir__ for IDE support
- protspace/__init__.py: remove eager imports of add_annotation_style
  and ProtSpace
- serve.py: inline DEFAULT_PORT constant (was importing entire
  Dash/pandas stack for a single 8050 integer)
- annotate.py, bundle.py, project.py, prepare.py: move pyarrow and
  pandas imports inside function bodies

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`30aae74`](https://github.com/tsenoner/protspace/commit/30aae7445187bc17295614f45334be2e48010232))

### Refactoring

* refactor: complete Colab notebook rewrite for bulletproof UX

Addresses NAR reviewer feedback: "ProtSpace processing failed with
return code: 2" with no explanation. The notebook is now bulletproof.

## Notebook Architecture (3 cells)

Cell 1 — Install & Setup (~30s):
- pip install under %%capture (zero output)
- tqdm patched for notebook-style progress bars before protspace import
- Pre-import protspace pipeline (lightweight — heavy reducers deferred)

Cell 2 — Choose Input Data (4 tabs):
- Example Dataset: auto-selects first dataset on cell run, downloads
  from GitHub releases on dropdown change (no button needed)
- Upload H5: HDF5 embedding upload with validation (groups, 2D squeeze,
  per-residue detection, protein count, dim, dtype reporting)
- Upload FASTA: sequences for on-the-fly embedding via Biocentral API
- UniProt Query: direct protein fetch with example queries
- Embedder multi-select shown only for FASTA/Query tabs
- Dark mode fix: CSS in same cell as Tab widget (per-cell iframes),
  bridges --jp-ui-font-color0 missed by Colab's colabtools#1895

Cell 3 — Generate & Download:
- Direct Python pipeline calls (no subprocess, no 30s import overhead)
- Step indicators: 1/4 Loading → 2/4 Annotations → 3/4 Reducing → 4/4 Bundling
- Annotation caching via keep_tmp (re-runs skip API fetching)
- CSV/TSV upload for custom annotations (merged with API data, CSV wins)
- Annotation presets: Default, All, Custom (no None option)
- Auto-download on completion (no separate download cell)
- Method parameter sliders with overflow:hidden (no scrollbars)
- Taxonomy note inline with annotation controls

## Package Changes (already committed separately)

- fix: skip taxonomy/interpro fetch when not requested (manager.py)
- perf: extract constants.py — pipeline import 2.96s → 0.30s
- perf: lazy per-method reducer imports — PCA skips umap/pacmap/numba
- feat: CSV annotation support in protspace prepare pipeline
- docs: update annotations.md/cli.md command names and CSV docs
- fix: better error handling in CLI (sys.exit(1) + stdout errors)
- fix: harden HDF5 loading (groups, 2D squeeze, dim validation)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`649aa02`](https://github.com/tsenoner/protspace/commit/649aa021d06d859767d973cbf78911ee617f9bd0))

* refactor: run CI on all branches, not just main/stage

Support feature-branch workflow by triggering CI on every push
and PRs targeting main.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`c79ad56`](https://github.com/tsenoner/protspace/commit/c79ad56f2bda7f428ee5af12f20bc2b0d32ec02c))

* refactor: simplify CI/CD — consolidate workflows, add Python version matrix, use GitHub App auth

- Remove jekyll-gh-pages.yml (no Jekyll site exists)
- Remove unused requirements-py310/311/312.txt and update_deps.sh
- Merge python.yml + docker.yml into single publish.yml (no Render deploy)
- Replace expiring SEMANTIC_RELEASE_TOKEN PAT with GitHub App token
- Fix UV_TOOL_DIR/cache path mismatch in release.yml
- Add Python 3.10/3.11/3.12 test matrix to ci.yml
- Remove continue-on-error from ruff format check
- Simplify [tool.semantic_release] config in pyproject.toml

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`4946388`](https://github.com/tsenoner/protspace/commit/4946388d2c1ca5fe1a9b99e178eb34c24a4a338d))

* refactor: remove JsonReader, unify Dash frontend on ArrowReader

ArrowReader now accepts both Path (Parquet files) and dict (in-memory
data), fully replacing JsonReader. All Dash frontend code migrated.

- ArrowReader.__init__ accepts Path | dict via isinstance dispatch
- Delete json_reader.py (97 lines) and readers.py (105 lines)
- Remove JSON file input from main.py detect_data_type()
- Remove default_json_file param from ProtSpace.__init__
- Fix wsgi.py broken API call (was using removed param)
- Remove LEGACY_OUTPUT_DATA from test fixtures
- Remove commented-out dead code from app.py
- Clean up data/io/__init__.py exports

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`dfd35e2`](https://github.com/tsenoner/protspace/commit/dfd35e2a61effd8f041ea6880105f0bd00beca3a))

* refactor: consolidate parameter passing with config dataclasses

Introduce config objects to reduce parameter threading across the
codebase. Adding a new CLI flag now requires ~4 changes instead of
12-14.

- New cli/common_options.py: shared Typer option types (Opt_Methods,
  Opt_Metric, Opt_NNeighbors, etc.) used by both prepare and project
  commands, eliminating duplicated definitions.
- New EmbedConfig frozen dataclass: consolidates embedding params
  (batch_size). Passed as single object through embed_fasta() →
  embed_sequences() instead of threading individual args.
- New ReducerParams frozen dataclass: replaces dict[str, Any] in
  PipelineConfig with typed, IDE-friendly config. Converted to dict
  via asdict() at the BaseProcessor boundary.
- Simplified _write_run_log(): from 22 keyword params to 14 by
  accepting config objects and auto-serializing via asdict(). New
  config fields appear in the log automatically.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`7cfc796`](https://github.com/tsenoner/protspace/commit/7cfc796eef0389e55f34e89802497c1e870954f7))

* refactor(cli): normalize flags, remove legacy JSON format, ruff format

Breaking changes:
- --no-scores → --scores/--no-scores (default: ON, pass --no-scores
  to strip). Internal APIs unchanged (PipelineConfig.no_scores stays).
- --non-binary removed — legacy JSON output format dropped. Only
  Parquet and .parquetbundle output remain.
- --half-precision removed — not implemented in Biocentral server.

Cleanup:
- Delete NumpyEncoder, create_output_legacy(), save_output_legacy()
  from base_processor.py.
- Remove non_binary from PipelineConfig, AnnotationManager, pipeline.
- Remove JSON code paths from add_annotation_style.py.
- Delete PfamExplorer_ProtSpace.ipynb (depended on JSON format).
- Add ankh3-large to ClickThrough_GenerateEmbeddings.ipynb dropdown.
- ruff format across all src/ and tests/ (19 files).
- Remove 4 legacy JSON test cases.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`663af14`](https://github.com/tsenoner/protspace/commit/663af14602ab1c5bc100715557988094e637d4dc))

* refactor: remove dead code, non-pLM embedders, and outdated references

Dead code removal (-794 lines):
- cli/app.py: remove parse_custom_names(), determine_output_paths(),
  compute_cache_hash() and unused hashlib/Path imports
- pipeline.py: remove unused custom_names field from PipelineConfig
- utils/analyse_json.py: delete unregistered CLI utility
- utils/add_annotation_style.py: remove dead argparse main()
- examples/cli/protspace_local.py, protspace_query.py: delete old examples
- tests/test_output_combinations.py: remove test classes for deleted functions

Code quality:
- query.py: unify identifier parsing via parse_identifier() from h5.py
- biocentral.py: remove non-pLM embedders (one_hot, blosum62, aa_ontology,
  random) from MODEL_SHORT_KEYS

Documentation:
- Fix -e syntax in README.md, CLAUDE.md, docs/cli.md (comma-separated)

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`815ba9c`](https://github.com/tsenoner/protspace/commit/815ba9c41f2326e4cd979c1247de99a22e877976))

* refactor(data): extract input loaders into data/loaders/ package

Create composable loader functions extracted from LocalProcessor and
UniProtQueryProcessor, preparing for the unified ReductionPipeline.

- data/loaders/embedding_set.py: EmbeddingSet dataclass (name, data, headers,
  precomputed, fasta_path)
- data/loaders/h5.py: load_h5() with PLM name resolution from H5 attrs,
  CLI override, or error. Extracted from LocalProcessor._load_h5_files
- data/loaders/fasta.py: embed_fasta() via Biocentral API, writes model_name
  attr to H5. Extracted from LocalProcessor._embed_fasta_to_h5
- data/loaders/query.py: query_uniprot() for FASTA download from UniProt REST
  API. Extracted from UniProtQueryProcessor._search_and_download_fasta
- data/loaders/similarity.py: compute_similarity() via MMseqs2, returns
  EmbeddingSet(precomputed=True, name="MMseqs2"). Extracted from
  UniProtQueryProcessor._get_similarity_matrix
- LocalProcessor._collect_datasets now delegates to loaders.h5

Ref #26

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`ae767c8`](https://github.com/tsenoner/protspace/commit/ae767c869903a3d7253af8c3d59df9213539dd4f))

* refactor(annotations): remove length binning, promote raw `length` to user-facing annotation

Length binning (`length_fixed`, `length_quantile`) is moved to the frontend
(protspace_web). The backend now exposes raw `length` as a regular annotation
in the default group. Deleted `LengthBinner` class and all associated plumbing
(configuration constants, transformer wiring, manager binning logic, internal
column filtering). Updated CLI help, docs, examples, notebook, and tests.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`e9ceb0f`](https://github.com/tsenoner/protspace/commit/e9ceb0fe80d376f897677b2db0ae6f68cfcebbc3))

### Testing

* test: add 86 unit tests for pure-logic functions, bump umap-learn

Add tests for settings_converter (color conversion, sorting, state
roundtrip), H5 identifier parsing, pipeline utilities (method spec
parsing, header validation, annotation name resolution), bundle settings
serialization, data formatters, and DR config validation.

Bump umap-learn >=0.5.7 → >=0.5.10 to fix sklearn FutureWarning
(force_all_finite rename). Remove now-unnecessary FutureWarning
suppression from base_processor. Add pytest filterwarnings for remaining
harmless third-party warnings (sklearn MDS matmul, umap n_jobs).

Coverage: 42% → 46% (399 tests, 0 warnings).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com> ([`9d97cdf`](https://github.com/tsenoner/protspace/commit/9d97cdf5479e23d6071faf1f87c5d493d155f052))

### Unknown

* Merge pull request #35 from tsenoner/stage

Merge stage into main — CLI rewrite, audit fixes, docs overhaul ([`c4c7a3b`](https://github.com/tsenoner/protspace/commit/c4c7a3b13548d5ef48c3e5f7a46bf67d5c12f63b))

* Merge branch 'stage' of https://github.com/tsenoner/protspace into stage ([`627e675`](https://github.com/tsenoner/protspace/commit/627e67578c343b561e4b13abc03f0fb709362fff))


## v3.3.1 (2026-02-27)

### Chores

* chore: remove dead code and redundant logging.basicConfig calls

- Remove 6 redundant logging.basicConfig() calls from library modules
  (only the CLI entry point setup_logging() should configure logging)
- Remove duplicate logger assignment in reducers.py
- Replace bare print(e) with logger.error() in reducers.py
- Remove commented-out dead code in local_data.py

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`74f04f4`](https://github.com/tsenoner/protspace/commit/74f04f4aee338db09a3abcea699b3932b51ec01a))

### Documentation

* docs(notebook): overhaul Colab UI with interactive widgets

Replace basic SelectMultiple widgets with a polished interactive UI:
- Annotation selection: checkboxes in 2-column CSS grids per category
  (UniProt/InterPro/Taxonomy) with per-group and global preset buttons
- DR method selection: ToggleButtons with color feedback and tooltips
- Method parameters: bordered cards in responsive flex-wrap grid with
  shared params merged (n_neighbors for UMAP/PaCMAP/LocalMAP, etc.)
- Dynamic show/hide of parameter groups based on selected methods
- Remove gene_name from selectable annotations (always auto-included)
- Add /.claude to .gitignore

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`f671715`](https://github.com/tsenoner/protspace/commit/f671715ebf13eb808e7f44567b3c0407a5accb41))

### Fixes

* fix(reducers): robust float16 upcast, annoy fallback, suppress noisy warnings

- Upcast float16 → float32 at HDF5 load time (local_processor) with a
  safety-net in base_processor, preventing overflow in all DR methods
- Add lazy annoy health check: on platforms where annoy segfaults or
  returns empty results (e.g. macOS ARM64), transparently swap in an
  sklearn NearestNeighbors drop-in so PaCMAP/LocalMAP keep working
- Suppress harmless sklearn RuntimeWarnings (randomized SVD overflow),
  FutureWarnings, and umap UserWarnings during fit_transform
- Add LocalMAP to Colab notebook (METHODS list, parameter sliders,
  intro text) — previously missing from the preparation UI

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`7c8193e`](https://github.com/tsenoner/protspace/commit/7c8193ef0ef4c2b9df3a9031dc142f77b28d9fc6))

### Testing

* test(reducers): add comprehensive tests for all 6 DR methods

51 tests covering PCA, t-SNE, UMAP, PaCMAP, MDS, and LocalMAP:
- Per-method: output shape (2D/3D), NaN-free, get_params, determinism
- Cross-cutting (parametrized): finite output, float dtype, no Inf
- Float16 handling: verify upcast produces correct results
- Config validation: defaults, custom values, invalid inputs
- End-to-end: all methods through BaseProcessor.process_reduction

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`85697c0`](https://github.com/tsenoner/protspace/commit/85697c00bd84885999a96bd4613eb3289bcb03bb))

### Unknown

* Merge pull request #34 from tsenoner/stage

Robust reducers, test suite, and Colab UI overhaul ([`e1e416d`](https://github.com/tsenoner/protspace/commit/e1e416d1b51e7880b65a60c60d4d489f4f58645a))


## v3.3.0 (2026-02-17)

### Features

* feat(styling): add pinnedValues, __REST__ marker, and value preprocessing

Add legend ordering support to protspace-annotation-colors:
- pinnedValues for explicit control over legend order and visible categories
- __REST__ auto-fill marker to expand top values by frequency
- zOrderSort to decouple zOrder computation from stored sortMode
- Value preprocessing (pipe trimming, semicolon splitting) matching the
  ProtSpace web frontend
- Auto-assign Kelly's palette colors for pinned values, __NA__ key format
- Comprehensive docs in docs/styling.md, docs/cli.md, and CLI epilog

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`530cd3c`](https://github.com/tsenoner/protspace/commit/530cd3c90cb7acbc5ea35f3974eb39d0bb74c34c))


## v3.2.0 (2026-02-17)

### Code Style

* style: apply ruff fixes and update notebooks for current CLI

Run ruff lint and format across the codebase. Add notebook-specific
per-file-ignores to ruff config for common Jupyter patterns (E402,
F811, ARG001, F841). Fix B904, C414, I001, UP012 lint issues.

Update Run_ProtSpace and PfamExplorer notebooks for current CLI:
replace removed -f/--features with -a/--annotations, change methods
from space-separated to comma-separated, and remove pinned commit
hash from install URL.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`5ad70f2`](https://github.com/tsenoner/protspace/commit/5ad70f205e97c14c057047fd5b9ea29596c56985))

### Documentation

* docs: polish README, add annotation and CLI reference docs

De-emphasize 3D in favor of 2D/ProtSpace Web focus, slim README by
moving detailed content to docs/annotations.md and docs/cli.md, update
example image with ProtSpace Web screenshot, and fix minor inconsistencies.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`a464d57`](https://github.com/tsenoner/protspace/commit/a464d5726f231eeddc4d46fc3de7fb2a368817b5))

* docs: remove redundant poster landing page ([`20db594`](https://github.com/tsenoner/protspace/commit/20db594529089af79d1932da705c8518d1a8094f))

* docs(README): clarify method parameters section

- Change section title from 'Method Parameters' to 'Method Default Parameters'
- Add clarifying text about overriding defaults for fine-tuning ([`3ad6c7e`](https://github.com/tsenoner/protspace/commit/3ad6c7e5e1ae0829f13b1fd9abd3e13c4a964c0a))

### Features

* feat(styling): extend annotation styles with settings support and frequency-based zOrder

Add bundle I/O module and settings converter for parquetbundle 4-part
format. Extend protspace-annotation-colors to accept settings-level keys
(sortMode, maxVisibleValues, shapeSize, hiddenValues, selectedPaletteId)
alongside colors and shapes. Add --generate-template flag for scaffolding
styles JSON files. Fix selectedPaletteId default to "kellys", default
maxVisibleValues to 10, and assign zOrder by frequency when sortMode is
size-based. Normalize NA representations across data sources. Update
ALLOWED_SHAPES to the 6 shapes supported by protspace_web. Clean up 3FTx
example data and add styling documentation.

Closes #25

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`4f18546`](https://github.com/tsenoner/protspace/commit/4f1854601a557b000ab12a6c9923cee031a69dff))

* feat(notebook): add ProtSpace Preparation notebook and move notebooks to root

Move all notebooks from examples/notebook/ to notebooks/ at repo root.
Add ProtSpace_Preparation.ipynb (from protspace_web) with bug fixes:
- Fix -f flag to -a for annotation CLI argument
- Add CSV metadata upload widget for custom annotations
- Complete annotation lists (ec, gene_name, go_*, keyword, cdd, panther, prints, prosite, smart)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`1abf3d4`](https://github.com/tsenoner/protspace/commit/1abf3d42121113c7bb7955bb85bef31f0c528597))

* feat(annotations): allow mixing custom CSV with database annotations

Support multiple -a flags so users can combine a CSV metadata file with
database annotations (e.g. -a metadata.csv -a pfam,kingdom). Columns are
merged on the identifier column with CSV values taking precedence on
collision. Only API-fetched annotations go into the parquet cache.

Closes #20, closes #23, closes #27

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`d01d34a`](https://github.com/tsenoner/protspace/commit/d01d34abaa34a744a1d172a902095321b80e204e))

* feat(annotations): add ECO evidence codes to UniProt annotations

Surface per-value evidence codes from the UniProt API inline using
the `value|CODE` format (same separator pattern as InterPro bit scores).

Affected fields: ec, cc_subcellular_location, protein_families, go_bp,
go_cc, go_mf. Keywords excluded (API never provides evidence on them).
GO source suffixes (e.g. IEA:UniProtKB-EC) are stripped to bare codes.
When multiple evidences exist, the highest-priority code is chosen.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`3991dbc`](https://github.com/tsenoner/protspace/commit/3991dbcecb8b1de07fd9ae58f9d09196e0bc47d4))

* feat(annotations): add named annotation groups (default, all, uniprot, interpro, taxonomy)

Replace the implicit "None means fetch everything" behavior with explicit
annotation groups. Users can now mix group names with individual annotations
(e.g. -a default,interpro,kingdom). When no annotations are specified, the
curated 'default' group (ec, keyword, length_quantile, protein_families,
reviewed) is used instead of fetching all annotations.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`7bd544c`](https://github.com/tsenoner/protspace/commit/7bd544cac6a5a5da79866d1b655790d876579f6b))

* feat(annotations): add EC, keyword, GO terms to UniProt annotations

Add 5 new annotations (ec, keyword, go_bp, go_cc, go_mf) to
UNIPROT_ANNOTATIONS, bringing the total from 13 to 18.

- EC numbers resolved with enzyme names via ExPASy ENZYME database
  (cached at ~/.cache/protspace/enzyme/, 7-day TTL)
- Keywords now include both ID and name: "KW-0418 (Kinase)"
- GO terms split by aspect (BP/CC/MF) with prefix stripping

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`2a4952e`](https://github.com/tsenoner/protspace/commit/2a4952e16c2f3076fa2477061e46f3e10cdab107))

* feat(interpro): resolve entry names via FTP XML download with local cache

Replace the slow paginated list API for name resolution (SUPERFAMILY ~2min,
CATH ~5min, PANTHER timeout) with a single download of interpro.xml.gz from
the EBI FTP server (~7s total). The XML is parsed via streaming ET.iterparse
and cached as JSON in ~/.cache/protspace/interpro/ with a 7-day TTL.

Also updates CLI help text and README with the full list of available
InterPro databases (cath, cdd, panther, pfam, prints, prosite,
signal_peptide, smart, superfamily).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`274bb6f`](https://github.com/tsenoner/protspace/commit/274bb6f1607d04e5149f1d9232383ca7545f36a7))

* feat(tests): update tests to reflect always-included annotations in user-defined lists ([`c519a7c`](https://github.com/tsenoner/protspace/commit/c519a7caab3c7d415ca15f59e4ebcf51db38331b))

* feat(annotations): include always included annotations in user-defined lists ([`7894fc3`](https://github.com/tsenoner/protspace/commit/7894fc36f349f8ba6fe9ae669f437e9932308918))

* feat(uniprot): add uniprot_kb_id and protein_name properties to UniProt retrieval ([`e8bfd04`](https://github.com/tsenoner/protspace/commit/e8bfd042474b4ee3c011ed3ab9b29dcc937145c1))

* feat(local): support multiple embedding files and directories

Enable protspace-local to accept and merge multiple HDF5 files/directories
via the --input argument. Automatically handles duplicates (keeps first) and
filters NaN values. Streamlined input loading logic and added comprehensive
test coverage with reusable mock helpers. ([`7306cb7`](https://github.com/tsenoner/protspace/commit/7306cb744c0dffd91418b8a84515030f7b965af9))

* feat(annotations): add InterPro signature names and refactor test data

Include signature names in parentheses after accessions (e.g., PF00001 (7tm_1)|50.2).
Refactor test data using helper functions and constants for better maintainability. ([`aad6acc`](https://github.com/tsenoner/protspace/commit/aad6acc8d457b5643eac84de083f9d454407151a))

* feat(annotations): store InterPro annotations with confidence scores in pipe-separated format

Store InterPro accessions and confidence scores in a single field using
pipe-separated format: accession|score1,score2;accession2|score1

- Collect all scores for duplicate accessions
- Add multidomain tests
- Update README documentation ([`b4e0556`](https://github.com/tsenoner/protspace/commit/b4e055653b8dac10ca25412907d09216c71ba468))

* feat(annotations): refactor feature extraction to annotation extraction

- Replace all instances of "features" with "annotations" in the codebase
- Rename data/features/ directory to data/annotations/
- Update all module imports and class names
- Update CLI commands and documentation to reflect the terminology change
- Add comprehensive tests for annotation retrieval and processing

This change improves code clarity by aligning internal terminology with the actual data being processed. The JSON output format remains unchanged (still uses "features" key). ([`61bc76b`](https://github.com/tsenoner/protspace/commit/61bc76baaef1e55b21e50a04b998e54a0cb606e6))

* feat(uniprot): add gene_symbol feature to UniProt retrieval

Closes #21 ([`cc0c00d`](https://github.com/tsenoner/protspace/commit/cc0c00d5f4cd3373541a94e2345b8485b7cdaebd))

* feat(cli): use first CSV column as identifier regardless of name

Closes #10 ([`2e7ec11`](https://github.com/tsenoner/protspace/commit/2e7ec111ae9db74a6a636158657d9433f72ce774))

* feat(cache): add incremental feature caching for --keep-tmp

Enable source-level caching that only fetches missing features from UniProt,
Taxonomy, or InterPro APIs. Previously, cache was all-or-nothing.

- Add feature categorization and source determination helpers
- Support cached data in ProteinFeatureManager
- Add --force-refetch flag to bypass cache
- Add comprehensive tests for caching behavior ([`230fc5a`](https://github.com/tsenoner/protspace/commit/230fc5aca16a0dba2169079bf2a79b66946f4058))

* feat(cache): add incremental feature caching for --keep-tmp

Enable source-level caching that only fetches missing features from UniProt,
Taxonomy, or InterPro APIs. Previously, cache was all-or-nothing.

- Add feature categorization and source determination helpers
- Support cached data in ProteinFeatureManager
- Add --force-refetch flag to bypass cache
- Add comprehensive tests for caching behavior ([`d387775`](https://github.com/tsenoner/protspace/commit/d387775fdf872c585e1267c20af895b8a261b23d))

* feat(local-processor): add NaN handling and improve method API

- Add automatic detection and filtering of embeddings with NaN values
- Remove problematic entries with warning instead of failing
- Add strict=True to zip() for safer iteration
- Remove unused output_path parameter from load_data signature
- Rename private methods to public API (load_input_file, load_or_generate_metadata)
- Remove unused process_local() wrapper method

These changes simplify the API by exposing the actual working methods
that are used by the CLI, making the interface more honest and maintainable.

NaN handling prevents PCA failures when input data contains invalid embeddings,
automatically filtering them out with informative warnings. ([`e2aaa54`](https://github.com/tsenoner/protspace/commit/e2aaa54134b66de2dd368f3d829a88b9199b7d15))

### Fixes

* fix(cache): separate storage from presentation in --keep-tmp cache

Always cache annotations as parquet with scores, regardless of
--no-scores or --non-binary flags. Move score stripping to the CLI
output layer via new strip_scores_from_df() utility. Add incremental
annotation fetching to UniProtQueryProcessor. Add --dump-cache flag
for inspecting cached data.

Closes #24

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`2a0a838`](https://github.com/tsenoner/protspace/commit/2a0a83821dd22310608fcfa2f151a6a71b9ea5c1))

* fix(uniprot): resolve inactive/obsolete entries via secondary accession search

fetch_many() silently drops inactive UniProt entries (merged/demerged).
After each batch, detect missing accessions and resolve them by searching
the sec_acc field, which returns the current replacement entry.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`64cd2ce`](https://github.com/tsenoner/protspace/commit/64cd2ceebc593b993b0f6f1182d5706f406e022f))

* fix(uniprot): correct reviewed field parsing for TrEMBL entries

Parser incorrectly matched "unreviewed" when checking for "reviewed" string.
Now returns "Swiss-Prot" or "TrEMBL" directly, eliminating the need for
transform_reviewed() method. ([`589cbac`](https://github.com/tsenoner/protspace/commit/589cbac79f6ac5a06ab508f9880c3e71731d2c03))

* fix(annotations): remove internal columns from final output, keep in cache ([`a25e86f`](https://github.com/tsenoner/protspace/commit/a25e86fa7ba158b6f7b9d6272494b4c607c59087))

* fix(annotations): remove raw length field from output after binning ([`2cfef29`](https://github.com/tsenoner/protspace/commit/2cfef299e5bfb1a57cc3b23b3cca8415794edfcb))

* fix(features): correct user feature filtering in configuration

Previously, when users specified specific features (e.g., -f domain),
the configuration was filtering DEFAULT_FEATURES instead of user_features,
causing all default features to be fetched unnecessarily.

Now correctly filters user_features, ensuring only requested features
and their dependencies are retrieved from data sources.

Fixes issue where requesting only taxonomy features would still trigger
full UniProt and InterPro data downloads. ([`f0297b2`](https://github.com/tsenoner/protspace/commit/f0297b2b23492f41e61683347136450a39a02b5e))

### Refactoring

* refactor(notebooks): improve both Colab notebooks

ProtSpace_Preparation.ipynb:
- Fix -f → -a CLI flag bug
- Add CSV metadata upload widget
- Complete annotation lists (all UniProt + InterPro)
- Remove legacy JSON output option
- Simplify code (~43% line reduction), consolidate imports
- Apply ruff check + format

ClickThrough_GenerateEmbeddings.ipynb:
- Add adaptive batched embedding (sorted by length, auto-halves on OOM)
- Set comparison to skip already-computed embeddings upfront
- Fix HF login: wrap userdata.get in try/except, actually call hf_login
- Use torch.inference_mode() in both embed paths
- Use tqdm.auto for proper notebook widget rendering
- Split config form from function definitions
- Rename variables for clarity (MODEL_SHORT_KEYS, preprocess_sequences)
- Apply ruff check + format

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com> ([`eeb21b0`](https://github.com/tsenoner/protspace/commit/eeb21b0569cd515fedd10004a9b1b93a38143e1a))

* refactor(annotations): rename gene_symbol to gene_name

Rename the gene_symbol property to gene_name across the codebase for
simpler and more intuitive naming. ([`a1ada56`](https://github.com/tsenoner/protspace/commit/a1ada56d79ff43922925110a128673d55e8901f9))

* refactor(cli): update to use public LocalProcessor API

Update CLI to call public methods instead of private ones:
- _load_input_file() → load_input_file()
- _load_or_generate_metadata() → load_or_generate_metadata()

No functional changes, just using the now-public API. ([`7cac0c5`](https://github.com/tsenoner/protspace/commit/7cac0c5f9d62d440e20815439889a0c47e88d572))

### Testing

* test(local-processor): update tests for public API

- Rename test class: TestLoadData → TestPublicMethods
- Update all test calls to use public method names
- Update test documentation to reflect public API
- Ensure tests mirror production usage patterns

All 19 tests passing. ([`be7d9ca`](https://github.com/tsenoner/protspace/commit/be7d9ca731dbbecfc72656dcb30f9a60e8207d99))

### Unknown

* Merge pull request #29 from tsenoner/stage

Merge stage: extended annotations, styling, and CLI improvements ([`ea7e0b0`](https://github.com/tsenoner/protspace/commit/ea7e0b0f06c8c9013e949ff65ea37aa9c63139e0))

* Merge branch 'stage' of https://github.com/tsenoner/protspace into stage ([`cb486ab`](https://github.com/tsenoner/protspace/commit/cb486ab02f193dfbc574c57773d4f4b15caa2276))

* Merge branch 'refactor/local-processor-improvements' into stage ([`afbe054`](https://github.com/tsenoner/protspace/commit/afbe0540c4d15e67af40ab2a959c3e48b616f172))


## v3.1.1 (2025-10-26)

### Documentation

* docs(features): add 'xref_pdb' and remove 'sequence' from feature list

- Add 'xref_pdb' and remove 'sequence' from README.md UniProt features
- Remove 'sequence' from CLI help text in common_args.py
- Sequence is used internally but not exposed to users ([`d62ee4e`](https://github.com/tsenoner/protspace/commit/d62ee4e1bb18926004632dfe4d0a39f11f03a25b))

### Fixes

* fix(parser): truncate protein family descriptions at first dot

- Update protein_families property to remove trailing text after period
- Clean up family description formatting in UniProt parser
- Update toxins dataset with improved family annotations ([`3f1323f`](https://github.com/tsenoner/protspace/commit/3f1323f222fac35ac7526021a81dd1b762e51e6e))

### Unknown

* Merge branch 'stage' ([`92872a8`](https://github.com/tsenoner/protspace/commit/92872a855af90643508bf8cbbf0164f7de8647c8))


## v3.1.0 (2025-10-25)

### Chores

* chore(data): update toxins dataset

- Update toxins.json with latest data
- Add toxins.parquetbundle for testing ([`9a6e9f2`](https://github.com/tsenoner/protspace/commit/9a6e9f227a08c0ffa17b6a9618dfcfbfb43a7dca))

* chore(data): untrack files now ignored by .gitignore

Remove from git tracking (files remain locally):
- All .h5 embedding files (large files)
- gfp, phages, sub_loc, nuclease, ec, cath, sizes directories
- Keep only 3FTx, Pla2g2, and toxins in version control ([`b4ca074`](https://github.com/tsenoner/protspace/commit/b4ca074e1b9085a87f0ef67e2dba9f8fcaaf77cd))

* chore(data): clean up obsolete toxins data files

Remove old processed data, protspace outputs, and scripts that are no
longer needed or should be regenerated ([`a626c31`](https://github.com/tsenoner/protspace/commit/a626c319c078cda986a02e17a6924155f4d65f1b))

* chore(data): simplify .gitignore data rules

- Ignore all /data/* except 3FTx, Pla2g2, and toxins directories
- Always ignore pdb/, tmp/ subdirectories and .h5 files everywhere
- Reduces gitignore complexity from 30+ lines to 7 lines ([`a451818`](https://github.com/tsenoner/protspace/commit/a4518182c48dab635e914bd452a663427f080ce7))

* chore: remove matplotlib dependency ([`e78245c`](https://github.com/tsenoner/protspace/commit/e78245cf8c3a2f0c4b7ee32c117cf47fa0126914))

* chore: Making matplotlib an optional dependency

Creating a new optional dependency category "scripts"

Signed-off-by: Sebastian <sebastian.franz@tum.de> ([`dc25a42`](https://github.com/tsenoner/protspace/commit/dc25a42439365ae863543871997cd86d86d1bd91))

### Documentation

* docs(cli): update features help text with new UniProt properties

- Update --features help to show annotation_score (not annotation)
- Add xref_pdb to list of available UniProt features
- Reflect changes from new unipressed-based retriever ([`8258d3d`](https://github.com/tsenoner/protspace/commit/8258d3d6b26da6fab67a11888492619f8b7f31d4))

### Features

* feat(notebook): add regex-based UniProt ID extraction

- Extract UniProt IDs from FASTA headers using pattern recognition
- Remove old 2024_ClickThrough notebook version
- Improves ID parsing robustness ([`cc73f76`](https://github.com/tsenoner/protspace/commit/cc73f76e46cd48caffa6cf1f4d89b79569bba063))

* feat(data): replace bioservices with unipressed in UniProt retriever

- Replace bioservices.UniProt with unipressed.UniprotkbClient
- Use new UniProtEntry parser for data extraction
- Update UNIPROT_FEATURES to include organism_id and sequence
- Store raw UniProt data in tmp files with minimal processing
- Extract 10 features: annotation_score, cc_subcellular_location, fragment,
  length, organism_id, protein_existence, protein_families, reviewed,
  sequence, xref_pdb ([`4b27eaf`](https://github.com/tsenoner/protspace/commit/4b27eaf2d94240efae960488dfeb8dfe03bddc42))

* feat(parser): add manual UniProt parser, to be independent of 'bioservices'

- Create new parsers module in src/protspace/data/parsers/
- Add UniProtEntry class for parsing UniProt REST API JSON responses
- Implement cc_subcellular_location property to extract location values
- Add fetch_uniprot_data() utility function for batch fetching
- Support 45 UniProt properties with comprehensive docstrings ([`dd86bd9`](https://github.com/tsenoner/protspace/commit/dd86bd93ef74e3052c489f4915be7e087577f64d))

* feat(taxonomy): add root and domain features

Extended taxonomy features with root and domain to better support both
cellular and acellular organisms (viruses).

- Add 'root' feature: uses 'cellular root' or 'acellular root' rank values
- Add 'domain' feature: uses 'domain' rank (Bacteria, Archaea, Eukaryota)
  or falls back to 'realm' rank for viruses (e.g., Riboviria)
- Update documentation in README.md and CLI help text (common_args.py) ([`b9ff5d0`](https://github.com/tsenoner/protspace/commit/b9ff5d017dce10f02480b1999f9fe5b66b783455))

### Fixes

* fix(cli): update imports to new module paths

- Update local_data.py to import LocalProcessor from processors
- Update uniprot_query.py to import from new locations
- Ensures CLI commands work with refactored architecture ([`68b273c`](https://github.com/tsenoner/protspace/commit/68b273c589ef4725af73e0adba490577fd0a7a50))

### Refactoring

* refactor(data): remove backward compatibility code

- Delete old base_data_processor, local_data_processor, uniprot_query_processor
- Delete old feature_manager and feature_retrievers/ directory
- Update __init__.py to export only new module paths

Breaking change: removes all backward compatibility aliases ([`5231144`](https://github.com/tsenoner/protspace/commit/5231144f1e80f9fcb236c65c9a7e5b0c1940fbbd))

* refactor(data): restructure into modular architecture

- Create features/ module with configuration, manager, and merging
- Add retrievers/ subdirectory with uniprot, taxonomy, interpro
- Add transformers/ subdirectory with feature transformations
- Create io/ module with readers, writers, and formatters
- Create processors/ module with base, local, and query processors

This modular structure improves maintainability and testability ([`b9d61ef`](https://github.com/tsenoner/protspace/commit/b9d61ef354e6334746b3e70b6b7c01804d161bd8))

* refactor(data): simplify feature processing and remove backward compatibility

- Remove backward compatibility for old cc_subcellular_location format
- Consolidate annotation_score handling (remove annotation alias)
- Process cc_subcellular_location as semicolon-separated values
- Update UNIPROT_FEATURES constant to match new parser properties
- Assume clean data format from unipressed/UniProtEntry parser ([`47def3a`](https://github.com/tsenoner/protspace/commit/47def3a95aa10bff7fc91712f14122a6291af895))

### Testing

* test: update tests for refactored architecture

- Update all test imports to new module paths
- Rewrite 21 tests to test new modular components directly
- Add tests for FeatureConfiguration, LengthBinner, FeatureMerger
- Add tests for FeatureWriter, DataFormatter, UniProtTransformer
- Fix mock patches to point to new module locations
- All 131 tests passing with 0 skipped ([`b5be61d`](https://github.com/tsenoner/protspace/commit/b5be61ddd593bf9b63ef43fff90bf08c3739ebd6))

* test(data): update UniProt feature retriever tests for unipressed

- Replace bioservices.UniProt mock with unipressed.UniprotkbClient mock
- Update test assertions to match UNIPROT_FEATURES (10 properties)
- Add test for organism_id and sequence in feature extraction
- Verify raw data storage format (bools as strings, etc.)
- Remove PROPERTIES_TO_STORE tests (consolidated into UNIPROT_FEATURES) ([`a17b695`](https://github.com/tsenoner/protspace/commit/a17b6953a4cd06304565c413824934c659840860))

* test(pytest): mark slow taxonomy tests for optional execution

- Add slow and integration pytest markers
- Mark taxonomy tests as slow (~13x faster test runs when skipped)
- Add tests/README.md with marker usage documentation ([`c9b385d`](https://github.com/tsenoner/protspace/commit/c9b385d65a210729f4e0d9cf3d8f94247bbcd2cb))

* test(taxonomy): replace mock tests with real NCBI data tests

Replace 21 mock-based unit tests (858 lines) with 12 real taxonomy
database tests (221 lines). Tests now verify actual NCBI taxonomy
integration for bacteria, archaea, eukaryotes, and viruses.

- 77% code reduction with better test quality
- Session-scoped fixture initializes database once
- Real data tests catch taxonomy structure changes ([`eefd2fc`](https://github.com/tsenoner/protspace/commit/eefd2fc914e5a0fe59ee62ce05d246221d6c33eb))

### Unknown

* Merge remote-tracking branch 'origin/main' into stage ([`68ab956`](https://github.com/tsenoner/protspace/commit/68ab95647df74e9d68a624e5172cd1caebdef59b))


## v3.0.0 (2025-10-13)

### Unknown

* Merge branch 'stage' ([`e787fe8`](https://github.com/tsenoner/protspace/commit/e787fe861888dadcd1c0b196a35187f804411dbe))


## v2.3.0 (2025-09-30)

### Unknown

* Merge branch 'stage' ([`5716992`](https://github.com/tsenoner/protspace/commit/57169922e79968b7c5257f8841185de113982197))


## v2.2.0 (2025-08-07)

### Unknown

* Merge branch 'stage' ([`236a05c`](https://github.com/tsenoner/protspace/commit/236a05c20c6b37c35bdb19656017b002e8a73550))

* Update jekyll-gh-pages.yml ([`248ec54`](https://github.com/tsenoner/protspace/commit/248ec54791408a73da113e50ec4c3dc9655426be))

* Update jekyll-gh-pages.yml ([`5b36dc5`](https://github.com/tsenoner/protspace/commit/5b36dc5ca5d79b32c745bb4e11124da925531e82))

* Merge pull request #8 from tsenoner/improvement/ismb-landing

improvement: add ISMB poster landingpage ([`e8cc651`](https://github.com/tsenoner/protspace/commit/e8cc65118344d56956804a03b0c67279f530777a))

* improvement: add ISMB poster landingpage ([`2250fe2`](https://github.com/tsenoner/protspace/commit/2250fe2d83474ef85a306c8591a24dc2410b6cac))


## v2.1.2 (2025-07-07)

### Fixes

* fix(examples): update jupyter notebooks to use current CLI commands

Replace deprecated 'protspace-json' command with 'protspace-local' in example notebooks:
- examples/notebook/PfamExplorer_ProtSpace.ipynb
- examples/notebook/Run_ProtSpace.ipynb

This ensures the example notebooks work with the current CLI interface and
improves the user experience for notebook-based workflows. ([`c08d241`](https://github.com/tsenoner/protspace/commit/c08d241aaf5bb0b402b6c409a577220af86a3e11))


## v2.1.1 (2025-07-07)

### Breaking

* feat(data)!: add comprehensive feature extraction and output restructuring

BREAKING CHANGE: Restructure output directory organization

- Add enhanced UniProt feature retrieval with batch processing and validation
- Implement comprehensive taxonomy feature extraction with proper error handling
- Add InterPro domain feature retrieval with MD5-based sequence matching
- Restructure output paths with intermediate file management (_tmp, _intermediate)
- Add support for bundled Parquet files (.parquetbundle) and Apache Arrow format
- Implement length binning features for protein size classification
- Add protein family classification with top-9 filtering
- Enhance error handling and logging throughout data processing modules
- Add comprehensive type hints and documentation
- Modernize code with PEP 585/604 type annotations

This represents a major architectural improvement to ProtSpace's data
processing pipeline, significantly enhancing feature extraction capabilities
while maintaining backward compatibility for the legacy JSON format. ([`f3ebef8`](https://github.com/tsenoner/protspace/commit/f3ebef8c9dd8f4b9c37941852f3aa9d1996c84f1))

### Build System

* build: migrate to dependency-groups.dev from deprecated tool.uv.dev-dependencies

Replace deprecated [tool.uv] dev-dependencies with the new [dependency-groups]
syntax to comply with uv latest standards and remove deprecation warnings. ([`a328280`](https://github.com/tsenoner/protspace/commit/a328280a96369cb5db8ca704e20617ec77bcb4cc))

### Chores

* chore: configure ruff to ignore pytest fixture redefinition warnings

- Add F811 to per-file-ignores for tests/* directory
- Pytest fixtures intentionally redefine module-level fixtures
- This prevents false positive warnings in test files ([`f85c13d`](https://github.com/tsenoner/protspace/commit/f85c13d3f9bcb93965c353c6457d8bf27315fa39))

* chore: replace pylint with ruff

- Remove pylint from dev dependencies
- Add comprehensive ruff configuration
- Configure linting rules for unused variables, imports, and arguments
- Set up per-file ignores for test files ([`d46cbb5`](https://github.com/tsenoner/protspace/commit/d46cbb591f3c53a4ff56ea23fb0a4032f0e6204e))

* chore: update Dockerfile and improve script formatting in protspace_local.py

- Added curl installation to Dockerfile to work for pymmseqs2.
- Reformatted command arguments in run_prepare_json_script for better readability in protspace_local.py. ([`07ec5aa`](https://github.com/tsenoner/protspace/commit/07ec5aaec244c6b19efba185c0e8361ec611dfc2))

### Code Style

* style: apply code formatting to utils module

- Format add_feature_style.py (quotes, line wrapping)
- Format arrow_reader.py (quotes, line wrapping)

No functional changes. ([`61892c4`](https://github.com/tsenoner/protspace/commit/61892c473a525cfe478c9d4248f7a4642efbd700))

### Documentation

* docs: update README with improved feature documentation

- Fix JavaScript frontend URL from protspace_d3 to protspace_web
- Add cc_subcellular_location and sequence to UniProt features list
- Enhance feature documentation with more comprehensive examples
- Improve command-line usage documentation
- Update feature extraction examples with better clarity ([`23dd0e3`](https://github.com/tsenoner/protspace/commit/23dd0e39cf63f3a948f1f2ea05efca4e63312c01))

* docs: Update README and CLI help to enhance feature extraction guidance

- Added a new section in README for the JavaScript frontend
- Revised the "Quick Start" section for clarity and updated usage examples for querying UniProt and processing local data.
- Expanded help text in CLI for feature extraction to include available UniProt, InterPro, and Taxonomy features. ([`56e17b2`](https://github.com/tsenoner/protspace/commit/56e17b28b60827be2cf4f63f083a52a85f2ac166))

* docs: Update README examples to clarify usage of protein features ([`3ee0ddf`](https://github.com/tsenoner/protspace/commit/3ee0ddf7a734e666c7e036b03b82e42695cd644d))

### Features

* feat(cli): add shared argument parsing utilities

- Create common_args.py module with reusable CLI components
- Add CustomHelpFormatter for preserving newlines and showing defaults
- Implement modular argument group adders for all parameter types
- Include comprehensive help text with examples and parameter guidance
- Support both CSV metadata files and comma-separated feature lists ([`091a742`](https://github.com/tsenoner/protspace/commit/091a742643675c53f045094a75f20094ee6f53f3))

* feat(umap): add random_state parameter for reproducibility

Add random_state parameter with default value of 42 to ensure
reproducible UMAP results across runs.

- Add random_state field to DimensionReductionConfig (default: 42)
- Update UMAPReducer to pass random_state to UMAP constructor
- Add --random_state CLI argument to protspace-local and protspace-query
- Update base_data_processor to include random_state in valid config keys
- All 53 tests passing

Fixes #16 ([`63b7df8`](https://github.com/tsenoner/protspace/commit/63b7df80ea480e661e73052c3f2e395f93976a6c))

* feat: enhance taxonomy feature retrieval with error handling and cache management

- Added error handling in get_taxonomy_features to log and return an empty mapping on fetch errors.
- Improved _initialize_taxdb to support environment variable for cache directory and implemented a safe refresh strategy for the taxonomy database.
- Updated logic to handle first-time setup and cache refresh without losing existing data. ([`47826e9`](https://github.com/tsenoner/protspace/commit/47826e9b796e840282d1263d3ae85a31a56c5d18))

* feat: update all Jupyter notebooks for new protspace-local CLI interface

- Update protspace-local command to use -f (features) instead of -m (metadata)
- Update PfamExplorer, Explore_ProtSpace, and Run_ProtSpace notebooks
- Adapt notebook workflows to work with new JSON file generation method
- Update installation commands to use specific git commit for consistency
- Maintain backward compatibility with existing data processing pipeline ([`95f5e78`](https://github.com/tsenoner/protspace/commit/95f5e781f640661f4737ada4c3661ae511e95f30))

* feat: add -m as alias for --methods flag ([`b54e0b3`](https://github.com/tsenoner/protspace/commit/b54e0b3b248d360729c5434977fb36715765039d))

* feat: Update interpro feature retriever to include boolean signal peptide

- Update interpro_feature_retriever to accept `cath` instead of `cath-gene3d` making it easier for users to call it
- Modified example CLI scripts to include 'signal_peptide' in feature extraction (as well as modified `cath`)
- Adjusted tests to reflect changes in expected features. ([`baa4983`](https://github.com/tsenoner/protspace/commit/baa49830eb25b3c06049d4824dec957b76cdef5f))

* feat: Add InterPro feature retrieval support

- Add InterProFeatureRetriever class for fetching domain annotations
- Support Pfam, SUPERFAMILY, and CATH-Gene3D features from InterPro6 API
- Integrate InterPro features into ProteinFeatureExtractor workflow
- Update CLI examples to include InterPro features
- Add comprehensive tests for InterPro functionality ([`59644bf`](https://github.com/tsenoner/protspace/commit/59644bf27435823ce42e0d7fc92b018f2cc5c139))

* feat: add support for bundled parquet files in ProtSpace

- Enhanced data input handling in main.py to support .parquetbundle files.
- Introduced a new function to extract parquet files from bundled format.
- Updated CLI argument parser to include a flag for bundling parquet files.
- Modified save_output method in BaseDataProcessor to handle bundling logic. ([`b7312b9`](https://github.com/tsenoner/protspace/commit/b7312b977a84f42246277d0a19c3fe72f113a638))

### Fixes

* fix(docker): add curl dependency and fix jupyter notebook imports

1. Docker build fix:
   - Add curl dependency to resolve pymmseqs build failure
   - The pymmseqs package requires curl to download the MMseqs2 binary during installation
   - Without curl, Docker builds fail with 'curl: not found' error
   - This resolves: scripts/download_mmseqs.sh: 37: curl: not found

2. Jupyter notebook import fix:
   - Updated import path from 'from protspace.app import ProtSpace' to 'from protspace import ProtSpace'
   - Modified src/protspace/__init__.py to expose ProtSpace at package level
   - This simplifies imports for users in notebooks and examples

Fixes the Docker build failure in GitHub Actions and improves the developer experience for notebook users. ([`26d973e`](https://github.com/tsenoner/protspace/commit/26d973e96ab8d7d2a9611af08bb493ec29d3cef7))

* fix: JSON encoder for NumPy data types in BaseDataProcessor

- Introduced NumpyEncoder class to handle serialization of NumPy integers, floats, and arrays.
- Updated json.dump call in save_output method to use NumpyEncoder for improved data handling. ([`e03a353`](https://github.com/tsenoner/protspace/commit/e03a353b16a9b5657258a470c2e45a6396b6dab4))

* fix: correct validation logic for taxon IDs in TaxonomyFeatureRetriever ([`3000370`](https://github.com/tsenoner/protspace/commit/300037024ac0867621ec0ab480095a393f7dfc4e))

* fix: correct spelling of delimiter in parquet handling ([`931e03c`](https://github.com/tsenoner/protspace/commit/931e03c9d34afa4206f7ffc1b3e43213115ff93a))

### Refactoring

* refactor(ui): rename missing value label from <NaN> to <N/A>

- Standardize missing value display to '<N/A>' across UI and processing ([`7d6160a`](https://github.com/tsenoner/protspace/commit/7d6160a116e8f14a88873ee39c553180f3d0a7da))

* refactor: improve CLI examples with better documentation and user-friendliness

- Add comprehensive docstrings and shebang lines
- Improve error handling and user feedback
- Fix import sorting issues
- Add input validation for local data example
- Enhance comments and parameter explanations
- Make examples more professional and user-friendly ([`7b0d72d`](https://github.com/tsenoner/protspace/commit/7b0d72d263ec18d7b7dc310374f2bfe221137f27))

* refactor(vis): fix ruff linting issues in visualization module

- Fix C408: Replace dict() calls with dictionary literals (6 instances)
- Fix ARG001: Replace unused is_3d parameter with underscore
- Improve code consistency and readability
- Follow modern Python best practices for function parameters ([`ac3f653`](https://github.com/tsenoner/protspace/commit/ac3f653d4e32da2b944805c5c462377a9321d9a1))

* refactor(utils): fix ruff linting issues in utility modules

- Fix B904: Add proper exception chaining with 'from e' (2 instances)
- Fix C401: Replace generators with set comprehensions (2 instances)
- Fix C416: Replace list comprehension with list() call
- Improve error handling and code efficiency
- Follow modern Python exception handling practices ([`81969dc`](https://github.com/tsenoner/protspace/commit/81969dcba2db26f4e7edb11a867748322c976a73))

* refactor(ui): fix ruff linting issues in UI callbacks

- Fix C408: Replace dict() calls with dictionary literals (5 instances)
- Fix C414: Remove unnecessary list() call in sorted()
- Improve code formatting and consistency
- Follow modern Python best practices ([`6f205e4`](https://github.com/tsenoner/protspace/commit/6f205e48dabb3f416bded43a7b7af256b80b76d0))

* refactor(data): fix ruff linting issues in data processing modules

- Fix B007: Replace unused table_name with underscore in loop
- Fix C414: Remove unnecessary list() call in sorted(set())
- Add missing trailing comma in INTERPRO_MAPPING
- Improve code quality and follow modern Python practices ([`aee7431`](https://github.com/tsenoner/protspace/commit/aee74315da56c132fcdd07c556b1dd778e310fce))

* refactor(utils,vis): modernize utility and visualization modules with ruff auto-fixes

- Update type annotations to modern syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency
- Enhance error handling and logging
- Optimize set comprehensions and generator expressions ([`06a47bd`](https://github.com/tsenoner/protspace/commit/06a47bd50365d12e0cde34b49b62fb3338c95430))

* refactor(ui): modernize UI and application modules with ruff auto-fixes

- Update type annotations to modern syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency
- Enhance error handling and logging ([`d9c21e7`](https://github.com/tsenoner/protspace/commit/d9c21e7352501d730e56c0e27d0940d5e9fd4126))

* refactor(cli): modernize CLI modules with ruff auto-fixes

- Update type annotations to modern syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency
- Enhance error handling and logging ([`0f1f0ad`](https://github.com/tsenoner/protspace/commit/0f1f0add73bd9471df94fc1ee02e649121c8fca5))

* refactor(core): modernize core modules with ruff auto-fixes

- Update type annotations to modern PEP 585/604 syntax
- Reorganize imports with proper sorting
- Replace dict() calls with literals
- Update deprecated imports
- Improve code formatting and consistency ([`8f9d8f2`](https://github.com/tsenoner/protspace/commit/8f9d8f2e97d71cd4c0b2306d7164b7489a33f200))

* refactor(imports): update imports to reflect new module structure

- Update main __init__.py to import from .app instead of .server
- Update app.py imports for ui.callbacks and core.config
- Update main.py to use core.config
- Update ui module imports (callbacks, layout, styles)
- Update visualization/plotting.py imports
- Update data/feature_manager.py to import from feature_retrievers
- Add proper exports in ui/__init__.py

All imports now reference the new directory structure. ([`9ba8ae3`](https://github.com/tsenoner/protspace/commit/9ba8ae32927f9c54ff7665e03f339b15d3bee5bb))

* refactor(structure): reorganize codebase into logical module directories

- Move ProtSpace class from server/app.py to root app.py
- Create core/ module for configuration and constants
  - Move config.py to core/config.py
  - Rename helpers.py to core/constants.py for clarity
- Create data/feature_retrievers/ subdirectory
  - Move interpro_feature_retriever.py
  - Move taxonomy_feature_retriever.py
  - Move uniprot_feature_retriever.py
- Reorganize UI components
  - Move callbacks.py from server/ to ui/
  - Move styles.py from root to ui/
- Move molstar_helper.py to visualization/molstar.py
- Remove server/ directory (now empty)

This improves code organization and follows Python packaging best practices. ([`22d3487`](https://github.com/tsenoner/protspace/commit/22d3487825dca70c482264178aba66b417aeada0))

* refactor: simplify download_plot and save_plot functions

- Remove strict width/height requirements for 2D plots
- Eliminate unused parameters in download_plot callback
- Add proper HTML file handling in generate_plot
- Improve code maintainability and compatibility ([`8c3f3e9`](https://github.com/tsenoner/protspace/commit/8c3f3e9df07a98a2ee0a85d91d592f001feb9139))

* refactor: renamed --metadata to --features

- Renamed -m, --metadata to -f, --features, making it more descriptive
- Updated the test
- Updated the examples
- Updated the README ([`9ae5f80`](https://github.com/tsenoner/protspace/commit/9ae5f801e622ce3f64a6abf3c5697307c115eb3c))

* refactor: remove old test files and add tests for the data module ([`19d4901`](https://github.com/tsenoner/protspace/commit/19d49018f94f6257c338b9df9f17a5774913b857))

* refactor: enhance data input handling in main.py for ProtSpace

- Consolidated JSON and Arrow directory input into a single argument.
- Implemented a new function to detect data type and validate input paths.
- Updated ProtSpace initialization to accommodate the new input structure. ([`6a5a9d6`](https://github.com/tsenoner/protspace/commit/6a5a9d6994d24c62a79ac9bccabed6082c8487b1))

* refactor: update import paths and modify ProtSpace initialization in image_creation.py

- Changed import of ProtSpace to a direct import from protspace.
- Updated initialization in image_creation.py to use arrow_dir instead of json_file.
- Cleaned up __init__.py to reflect the new import structure and removed unused imports. ([`9e65502`](https://github.com/tsenoner/protspace/commit/9e655026174dc4f167eafabfe8f24cd314fb789d))

### Testing

* test: fix ruff linting issues in test files

- Fix C401: Replace generator with set comprehension in test_feature_manager.py
- Fix F811: Resolve pytest fixture redefinition conflicts in test files
- Use temp_dir_path instead of temp_dir in local scopes to avoid conflicts
- Restore proper fixture arguments for test functions
- All 148 tests continue to pass successfully ([`eebcaeb`](https://github.com/tsenoner/protspace/commit/eebcaebaf7eded67027ea66e77f16ad13bfa08be))

* test: add comprehensive test suite for output formats and directory structures

- Add test_config.py with shared fixtures for all test modules
- Add test_output_combinations.py with 30+ tests for output scenarios
- Test bundled vs separate Parquet file generation
- Test JSON vs Parquet output formats
- Test keep_tmp flag and intermediate directory behavior
- Test output path determination logic for both local and query modes
- Verify proper cleanup of temporary files
- Test legacy JSON format compatibility ([`d4245e0`](https://github.com/tsenoner/protspace/commit/d4245e030136480573ab6419892c145beab3b683))

* test: clean up unused variables and imports

- Remove unused imports and variables from test files
- Fix unused function arguments by replacing with underscore
- Add missing imports that were accidentally removed during cleanup
- Ensure all test fixtures are properly imported
- All 148 tests continue to pass ([`6b48923`](https://github.com/tsenoner/protspace/commit/6b48923d3bb7a65dc29686eb1941ad31dd7d9881))

* test: update test imports for feature_retrievers module

Update all test files to import from the new feature_retrievers location:
- test_feature_manager.py
- test_interpro_feature_retriever.py
- test_taxonomy_feature_retriever.py
- test_uniprot_feature_retriever.py

All 127 tests passing. ([`c04b56f`](https://github.com/tsenoner/protspace/commit/c04b56f7ef9cd0c8ef5affdcb795ab59212e93eb))

### Unknown

* revert: manual version bump to prepare for semantic release ([`304acfc`](https://github.com/tsenoner/protspace/commit/304acfc638b0504646ff374d8f2c2e84ef7c68da))

* bump: version 2.1.0 → 2.2.0 (includes curl fix for pymmseqs build) ([`08b86f6`](https://github.com/tsenoner/protspace/commit/08b86f600a1c229baee7372dbbd7a74c2f3f35ab))

* Update .gitignore and remove analysis.ipynb ([`80d7dbb`](https://github.com/tsenoner/protspace/commit/80d7dbb86f0a548fc41f889122ba1204e66f9f43))

* chor: update image generation to include PCA_3 projection

- Changed the projection list to use only "PCA_3" for image generation.
- Added support for HTML file format in the image output. ([`36551f3`](https://github.com/tsenoner/protspace/commit/36551f3748ca0e74447c91db98a5c24c9d845dd4))

* improve code formatting with black and ruff ([`59a36d2`](https://github.com/tsenoner/protspace/commit/59a36d28e41b75c1068b655307d3866444c5d9a5))

* Chore: Run Black and Ruff to improve code formatting and quality ([`683578f`](https://github.com/tsenoner/protspace/commit/683578f60cf8689968ae93ffeffe77f25d5ebd82))


## v2.1.0 (2025-07-04)

### Documentation

* docs: update README and add new CLI scripts for protspace-query and protspace-local ([`5485a6c`](https://github.com/tsenoner/protspace/commit/5485a6c33f5847007b605bebb3432b02ae1de718))

* docs: update README to include detailed usage instructions for protspace-query and local data processing commands

- Added examples for `protspace-query` to search proteins from UniProt.
- Clarified required and optional arguments for both `protspace-query` and `protspace-local`.
- Enhanced descriptions for input types and method-specific parameters. ([`957e3b9`](https://github.com/tsenoner/protspace/commit/957e3b9f863d335a7d46d6e7f63edc6fe75d16d5))

### Features

* feat(ci): update release workflow to handle protected branches

- Add support for SEMANTIC_RELEASE_TOKEN to bypass branch protection
- Improve error handling and output management in release workflow
- Add fallback to GITHUB_TOKEN if PAT not available
- Create setup guide for PAT configuration
- Enable fully automated releases with protected main branch ([`45ccd1c`](https://github.com/tsenoner/protspace/commit/45ccd1ca0b9904f80454b6ab9570b5b84a84df37))

* feat: add support for Apache Arrow data format in ProtSpace

- Introduced ArrowReader class for reading and manipulating Arrow/Parquet files.
- Added new flags for protspace-query and protspace-local called --non-binary, if using this flag, everything is like before, otherwise using apache arrow format
- protspace cli has a new argument called --arrow, to pass a arrow files directory ([`ebac3c4`](https://github.com/tsenoner/protspace/commit/ebac3c4d9931f41af058e1c67ace6c3494b455a4))

* feat: enhance metadata validation in protspace-query, not to accept csv files as metadata ([`1a3d680`](https://github.com/tsenoner/protspace/commit/1a3d680c8375b342c2bfb9beae2ce840daffea65))

* feat: add UniProt query CLI tool and related data processing modules

This commit introduces a new CLI for querying UniProt, with several supporting modules for data retrieval and processing. Key additions include:
- `uniprot_query.py`: CLI for searching and processing proteins from UniProt.
- `uniprot_feature_retriever.py`: Renamed old `uniprot_fetcher.py` to this
- `uniprot_query_processor.py`: Handles query processing and data analysis.
- Updates in `generate_csv.py` to use the new feature retriever. ([`9f2b661`](https://github.com/tsenoner/protspace/commit/9f2b661185339976db0e4c6ac0591991d9bc49c5))

* feat: implement length binning features in ProteinFeatureExtractor
- Now a csv file is created based on all available features and then we filter them based on user requested features ([`b54f323`](https://github.com/tsenoner/protspace/commit/b54f3234eb9aad7615b20922be3d5f23c6f3cd7e))

* feat: enhance CSV processing by adding protein families handling ([`27cc6d4`](https://github.com/tsenoner/protspace/commit/27cc6d4512ef69d90a4fe9b34095f84c09a9bbc0))

* feat: expand taxonomy features and implement cache refresh logic in TaxonomyFetcher ([`0395d26`](https://github.com/tsenoner/protspace/commit/0395d26651e816d9827eac116c524a552ae43c38))

* feat: refactor DataProcessor with the new automated metadata generation logic ([`cb21caf`](https://github.com/tsenoner/protspace/commit/cb21cafb441b9a6662a84f368fa66171f6134987))

* feat(notebook): enhance ClickThrough_GenerateEmbeddings notebook with new model options and improved embedding generation logic

- Updated installation cell to include additional dependencies for ESM and Hugging Face.
- Added optional Hugging Face login cell for models requiring authentication.
- Improved model selection and embedding generation logic, including handling for different model types and sequence lengths.
- Enhanced error handling for invalid headers in the output dataset.
- Updated output file naming to include model type for clarity. ([`adc6553`](https://github.com/tsenoner/protspace/commit/adc6553988c345d4181211fab4b6d7853274885b))

### Fixes

* fix(tests): update tests for new architecture and add automatic ChromeDriver management

- Fix import paths: ProtSpace moved to server.app, DataProcessor to LocalDataProcessor
- Update LocalDataProcessor API usage in tests to match new method signatures
- Add conftest.py for automatic ChromeDriver version management using webdriver-manager
- Resolve Chrome/ChromeDriver version mismatch issues
- All tests now passing: 4/4 app tests, 4/4 sampled data processing tests ([`932734a`](https://github.com/tsenoner/protspace/commit/932734a019bfc1cb5a27a3e08e71a136c4322056))

* fix: correct import and variable names from REDUCER_METHODS to REDUCERS ([`e9f5a29`](https://github.com/tsenoner/protspace/commit/e9f5a2960dbb4290e20332929803b85552411876))

* fix: remove limit on UniProt headers in fetch_features method ([`1acdbcf`](https://github.com/tsenoner/protspace/commit/1acdbcf7146f16b1dade74ae050e41ac079ee2d1))

* fix(config): update marker shape configuration to use ValidatorCache

To work with Plotly update
This commit modifies the marker shape configuration in `config.py` to utilize `ValidatorCache` for improved performance and maintainability. The `SymbolValidator` is now retrieved from the cache, streamlining the extraction of marker shapes for both 2D and 3D plots. ([`e5931f9`](https://github.com/tsenoner/protspace/commit/e5931f9fecbc551cf3f4e3ee99f271c991a00c2b))

### Refactoring

* refactor: change data type conversion to np.float32 in BaseDataProcessor ([`c9483cb`](https://github.com/tsenoner/protspace/commit/c9483cbd2e8af3e3beddd3b44d1d80092e823b80))

* refactor: remove sp filtering from UniProt query processing, users should provide the exact query themselves ([`f077a23`](https://github.com/tsenoner/protspace/commit/f077a23b3c7641d8853d561b7b557d8ccc78f071))

* refactor: restructure data processors with inheritance-based architecture

- Replace prepare_json.py with modular BaseDataProcessor and LocalDataProcessor classes
- Extract common data processing logic into BaseDataProcessor base class
- Refactor UniProtQueryProcessor to inherit from BaseDataProcessor
- Move local data CLI functionality to dedicated cli/local_data.py module
- Update entry points and imports to reflect new module structure
- Improve code organization and reduce duplication across processors

Breaking change: rename protspace-json CLI command to protspace-local ([`9a627e6`](https://github.com/tsenoner/protspace/commit/9a627e6935ba7dad3c9ace3094b049179b0d88fa))

* refactor: update import paths to use absolute imports for consistency and clarity ([`8ee68ac`](https://github.com/tsenoner/protspace/commit/8ee68acd8c94c13d760d3440dc7f3b24618c97d5))

* refactor: update import paths and clean up whitespace in various files; enhance .gitignore to include additional data directories ([`1f1b48b`](https://github.com/tsenoner/protspace/commit/1f1b48b0af21df21f8a3f7ee2f87b35135c0cfbe))

### Unknown

* Merge branch 'stage' ([`5a0030e`](https://github.com/tsenoner/protspace/commit/5a0030eaff34b0ee5c64d56e0b98a1fd1c01f1ac))

* Rename class name ([`38fd3ff`](https://github.com/tsenoner/protspace/commit/38fd3ff81b27efe5f33e9776eae9fd82634347ae))

* Merge branch 'main' into stage ([`852ddde`](https://github.com/tsenoner/protspace/commit/852ddde1f79b6a899a15af18441a9c620941818c))

* Merge branch 'stage' of https://github.com/tsenoner/protspace into stage ([`3ecafc7`](https://github.com/tsenoner/protspace/commit/3ecafc79b25ac6b3e315f78e2c2b88b48dbadf01))

* Merge pull request #6 from heispv:develop

Extract and parse metadata from UniProt automatically ([`bd9fe6d`](https://github.com/tsenoner/protspace/commit/bd9fe6d082cadb6828c971ca6af17955cf6a5ba4))

* Merge branch 'pr/heispv/6' into stage ([`b1cafb5`](https://github.com/tsenoner/protspace/commit/b1cafb5d36015dc5cd71177449520fa9671b28d1))

* Add taxonomy fetcher, move uniprot fetcher to a separate file, update dependencies ([`d568c65`](https://github.com/tsenoner/protspace/commit/d568c6523cfb89775e94b4f7c79acb6f8c18bcfe))

* Enhance CSV generation by modifying 'annotation_score' values before writing rows ([`5e01a61`](https://github.com/tsenoner/protspace/commit/5e01a6191ee2ddee885659e0d210fefcf61a3b60))

* Removing some prefixes ([`78aa3e5`](https://github.com/tsenoner/protspace/commit/78aa3e5f6daacf1c225abf56de30b084e6d141cb))

* Using number of the seqs instead of batches for the progress bar ([`721e7cb`](https://github.com/tsenoner/protspace/commit/721e7cb0739a22ef20c9fa8a76b6a62b4f52dbeb))

* Update a package and sync uv lock ([`0a8e0e9`](https://github.com/tsenoner/protspace/commit/0a8e0e92fd61a5d89b20d35f1a5bc5ff895f9952))

* Minor fix in the custom names arg ([`53fb12f`](https://github.com/tsenoner/protspace/commit/53fb12f8575608d473a0c83b0a69a4797a1ad9fb))

* Resolve the logo issue in ui ([`ac3476d`](https://github.com/tsenoner/protspace/commit/ac3476dec0c38e280a18e9b098239f74547a89b8))

* Managing default uniprot headers to extract accession correctly ([`fbb3f90`](https://github.com/tsenoner/protspace/commit/fbb3f90d6a9d793b00f02a9108e6d8c526c59d15))

* Updating args to use comma separated inputs ([`d4f4a83`](https://github.com/tsenoner/protspace/commit/d4f4a839e30f6ec0dc925811f2022c9e9e52b895))

* Minor import update ([`57f76c3`](https://github.com/tsenoner/protspace/commit/57f76c33bd8ebd9e2804e1778975d2c1613b6403))

* Updates based on new modularization logic ([`3d5aad2`](https://github.com/tsenoner/protspace/commit/3d5aad2db50c5ffb6d62ccb541d2b8be198602bb))

* Adding server module ([`b142c74`](https://github.com/tsenoner/protspace/commit/b142c7460f9071feea91bf914bc5c47416d1f682))

* Adding visualization module ([`e67d4e9`](https://github.com/tsenoner/protspace/commit/e67d4e94ef23683c3f77d90ef44bbc8feabc6190))

* Creating ui module ([`a6f98a8`](https://github.com/tsenoner/protspace/commit/a6f98a80ba9e691a7b13de3f625c5a9473296814))

* Moving data related files to data module ([`141e511`](https://github.com/tsenoner/protspace/commit/141e5114595ab0a7b22f0c3176025a4ddcd549bf))

* Modified examples ([`fb7483f`](https://github.com/tsenoner/protspace/commit/fb7483fa3f21f3c59bdc839197cc2e183a760ebe))

* Adding progress bar during data fetching through uniprot ([`11e98f1`](https://github.com/tsenoner/protspace/commit/11e98f12a9cce6c9ee94c275bc55d55849a8c8b3))

* Adding bioservices ([`534a73a`](https://github.com/tsenoner/protspace/commit/534a73aa6b4a7993b850aba85d96c6cb1f7fe208))

* Improved ProteinFeatureExtractor class, added batch size for request ([`7c7b78d`](https://github.com/tsenoner/protspace/commit/7c7b78dd9b5dee91aaefbbb914e179dbb6c27fbb))

* Moving reducers to another file ([`6f40fb6`](https://github.com/tsenoner/protspace/commit/6f40fb6a3c8d2e7bbab0f5105e5e2b0856dc2816))

* Moving the available FEATURES to this file ([`fea0b40`](https://github.com/tsenoner/protspace/commit/fea0b4082ac9a6f647eb1a44f2361f19efacb2de))

* Adding a class for protein feature extraction from uniprot ([`7493644`](https://github.com/tsenoner/protspace/commit/74936440e60ca9ce8bd85c939490431c7cfb7f69))


## v2.0.1 (2025-06-15)

### Fixes

* fix(docker): resolve Kaleido and markdown helper dependencies

This commit addresses two critical functionality issues in the Docker container:

1. Kaleido Image Generation:
- Adds libexpat1 to the runtime stage of the Dockerfile
- Ensures proper library availability for Kaleido subprocess
- Maintains clean image by removing apt lists after installation

2. Markdown Helper:
- Adds build-essential and gcc to build stage for proper compilation
- Ensures markdown content is properly accessible in container
- Fixes path resolution for helper markdown files

These changes restore both the image generation functionality and markdown
helper features while maintaining container performance and security best
practices. ([`de89ddb`](https://github.com/tsenoner/protspace/commit/de89ddbc808e139e3b2e2cf8c98fd53505e93278))


## v2.0.0 (2025-06-15)

### Breaking

* fix(ui): dropdown direction and color synchronization

This commit addresses two UI-related issues:

1. Download Format Dropdown:
- fix: make dropdown menu open upwards by wrapping in div with drop-up class
- style: prevent dropdown from being obscured by elements below

2. Color Management:
- fix: synchronize colors between scatter plot, legend and color picker
- feat: add default color generation for JSON files without styling
- fix: properly handle color conversion between rgba and hex formats
- fix: ensure consistent color display for NaN values

BREAKING CHANGE: None ([`bd65fd2`](https://github.com/tsenoner/protspace/commit/bd65fd281cd8b74736b7fdc16992a6855e762563))

### Features

* feat(viewer): replace NGL Viewer with Molstar Viewer

- Replace NglMoleculeViewer with dash-molstar component
- Add molstar_helper.py for data handling and AlphaFold DB fetching
- Refactor styles from callbacks into centralized styles.py
- Remove obsolete NGL viewer code ([`2475c53`](https://github.com/tsenoner/protspace/commit/2475c539680b8f323bcab73ba0d21387442fef45))

* feat(app): Overhaul plotting, styling, and UI interactivity

This commit introduces a comprehensive set of improvements, including major refactoring, new features, and numerous bug fixes to enhance user experience, code maintainability, and performance.

**Refactoring:**

- Separated style application from plot generation into distinct callbacks, improving performance and preventing unintended side-effects.
- Consolidated duplicated plotting logic into a single, centralized `create_plot` function.
- Unified the side-panel (Help and Settings) logic into a single, more robust callback.
- Streamlined marker shape configuration in `config.py` for better consistency and clarity.
- Refactored the `save_plot` function to write directly to an in-memory buffer, making downloads more efficient.
- Corrected the data access pattern in `data_loader.py` to prevent crashes and align with the actual data schema.

**Features & Enhancements:**

- **Plot & Legend:**
  - Decoupled legend size from the main marker size with a new, independent "Legend Size" input field for granular control.
  - The legend size now updates instantly on input change for a better user experience.
  - Re-implemented the custom legend trace logic to ensure markers are large, clear, and free of duplicates.
  - The marker shape dropdown now dynamically updates based on whether the plot is 2D or 3D.
- **Styling:**
  - Implemented default styling for `<NaN>` values and made their shape configurable.
  - Ensured all data points correctly default to a "circle" marker if no specific shape is defined.
  - The `<NaN>` option now only appears in the styling dropdown if the selected feature actually contains missing values.
- **Downloads:**
  - Expanded download options to include PNG, JPEG, WEBP, PDF, and HTML.
  - Enforced the correct filename format for all downloads: `<dim_reduction>_<feature>.<format>`.

**Bug Fixes:**

- **CRITICAL:** Fixed a style-bleeding bug where style changes for a value in one feature would incorrectly apply to other features.
- Fixed a `KeyError: 'annotations'` crash on application startup.
- Resolved multiple crashes and errors related to the download functionality.
- Fixed a crash when using 2D-only marker shapes in 3D plots.
- Fixed an `AttributeError` crash caused by scrambled callback parameters.
- Corrected various minor UI and data handling bugs. ([`f5705eb`](https://github.com/tsenoner/protspace/commit/f5705eb7a6ff1dee3afb6fc74fed4edaccc5251d))

* feat(app): overhaul plotting, styling, and download functionality

This commit introduces a major overhaul of the application's core features, including significant refactoring, new functionality, and numerous bug fixes to improve user experience and code maintainability.

**Refactoring:**

- Consolidated all plotting logic into a single, centralized `create_plot` function in `plotting.py`, removing duplicated code from `callbacks.py`.
- Refactored the `save_plot` function to write directly to an in-memory buffer, making downloads more efficient and fixing several related bugs.
- Streamlined marker shape configuration by removing redundant variables in `config.py` and enforcing a consistent `MARKER_SHAPES_2D` and `MARKER_SHAPES_3D` structure across the application.
- Corrected the data access pattern in `data_loader.py` to prevent crashes and ensure correct feature value retrieval.

**Features & Enhancements:**

- **Legend:**
  - Resolved marker overlap in the legend for better readability.
  - Implemented a workaround using dummy traces to allow for larger legend markers.
  - Ensured the legend is always sorted alphanumerically.
- **Styling:**
  - Implemented default styling for `<NaN>` values (semi-transparent gray, circle shape) and made them configurable.
  - Ensured all data points default to a "circle" marker if no specific shape is defined, preventing inconsistent automatic shape assignment.
  - The marker shape dropdown now dynamically updates based on whether the plot is 2D or 3D.
- **Downloads:**
  - Expanded download options to include PNG, JPEG, WEBP, PDF, and HTML.
  - Implemented the correct filename format for downloads: `<dim_reduction>_<feature>.<format>`.
- **UI/UX:**
  - The `<NaN>` option now only appears in the styling dropdown if the selected feature contains missing values.

**Bug Fixes:**

- Fixed a critical bug where style changes for a value in one feature would incorrectly bleed into other features upon switching.
- Corrected a `KeyError: 'annotations'` crash on startup.
- Resolved multiple crashes related to the download functionality (`TypeError`, `ValueError: Invalid format ''`).
- Fixed an issue where the marker shape dropdown was not updating correctly.
- Prevented crashes when using 2D-only marker shapes in 3D plots. ([`a0b9299`](https://github.com/tsenoner/protspace/commit/a0b92991382c585d8748de4a70879a4ac1664526))

### Refactoring

* refactor(config): Centralize settings and simplify callbacks

This commit improves maintainability by centralizing configuration and reducing duplicated logic.

- Hardcoded side panel widths are now defined in `config.py`.
- A new `is_projection_3d` helper function was created to simplify dimension-checking logic in callbacks, removing redundancy. ([`7e70c1b`](https://github.com/tsenoner/protspace/commit/7e70c1b89e2f35c536346c48ec4e4b5b6e300ba4))

* refactor(ui): Overhaul codebase for maintainability and redesign help system

This commit introduces a major architectural refactoring to improve modularity, simplify logic, and enhance long-term maintainability. It also completely redesigns the help menu for better user experience and easier content management.

**Refactoring:**

- **Data Processing & Plotting:**
  - Eliminated the `data_processing.py` module by moving its data preparation logic directly into `plotting.py`, improving code locality.
  - The monolithic `create_plot` function was broken down into smaller, focused helper functions (`_create_base_figure`, `_add_legend_traces`, etc.) for significantly improved readability.
  - A new `helpers.py` module was created for general utility functions, starting with `standardize_missing`.

- **Callbacks:**
  - Replaced the complex, multi-purpose `toggle_side_panels` callback with a reusable `create_side_panel_callback` factory. This simplifies the logic for managing side panels and makes it easily extensible.

- **Layout:**
  - The `create_layout` function was streamlined to correctly initialize the application state from the main `ProtSpace` class, resolving multiple bugs.

**Features & Enhancements:**

- **Help Menu Overhaul:**
  - Re-implemented the help menu to use a robust, tabbed interface (`dbc.Tabs`).
  - Help content is now managed in separate, easy-to-edit Markdown files located in a dedicated `assets/help_content/` directory.
  - The "Interface Overview" tab now features interactive jump links that scroll to the relevant sections, created programmatically in the layout to ensure they always work correctly.
  - The layout for the overview tab is now generated with Dash HTML components to ensure the interface image displays reliably and scales correctly.
  - Added a main "ProtSpace Help Guide" title and removed redundant subheadings from content files for a cleaner UI. ([`6baef98`](https://github.com/tsenoner/protspace/commit/6baef98de7db3172ed50e91c32d48af167b85c4d))

### Testing

* test(app): stabilize and refactor UI test suite

This commit introduces a comprehensive set of UI tests for the main application and resolves several stability issues.

- **Initial Setup**: Created `tests/test_app.py` to validate core application functionality, including loading, feature selection, and UI interactions.

- **Stabilization**:
  - Resolved `DuplicateIdError` and race conditions by replacing `time.sleep()` with robust, explicit waits.
  - Fixed flaky tests by using reliable selectors and waiting for specific UI states before making assertions.
  - Suppressed the `kaleido` `DeprecationWarning` in the `pytest` configuration to clean up test output.

- **Refactoring**:
  - Introduced `pytest` fixtures (`protspace_app`, `protspace_app_with_data`) to eliminate redundant app setup code.
  - Created a reusable `wait_for_element_attribute_to_contain` helper function to reliably handle polling for asynchronous style changes during animations, making the tests cleaner and more maintainable.

The resulting test suite is now stable, robust, and provides solid coverage for key user interactions. ([`b928c01`](https://github.com/tsenoner/protspace/commit/b928c010cb6bdcf7965bd3a64a1312ee4a39695f))


## v1.3.0 (2025-06-13)

### Features

* feat(app): enhance plot controls and fix UI interactions

This commit introduces significant improvements to the user interface and adds new functionality for plot customization, while also resolving several bugs.

- **Marker Size Control:**
  - Adds a new input control allowing users to dynamically adjust the size of the scatter plot markers.
  - The plot now updates automatically when the marker size value is changed, providing immediate visual feedback.
  - The default marker size is now set to 10, and the previously hardcoded constant has been removed.

- **Plot Downloads:**
  - Fixes a critical bug that caused plot downloads to fail. The download callback now correctly handles different file formats by using `dcc.send_bytes` for PNGs and `dcc.send_string` for SVGs and HTML.

- **UI and Layout:**
  - The download format dropdown has been modified to open upwards, preventing it from being obscured by elements below it. This was achieved by removing an invalid property and using a custom CSS class.
  - The settings panel for marker styling now appears alongside the scatter plot instead of overlaying it. The scatter plot resizes to accommodate the panel, creating a more integrated and responsive layout.
  - The width of the settings panel has been adjusted to provide a better balance between the controls and the plot visualization.

- **Bug Fixes:**
  - Resolves a state management issue where applying a style to a feature would incorrectly reset the feature dropdown to its default value. The callback now preserves the user's selection.
  - Corrects an `AttributeError` that occurred due to a misordered function signature in a callback after a new input was added. ([`9853925`](https://github.com/tsenoner/protspace/commit/985392554a3b2824a235a0cd37b10dc7589fbb4c))

### Refactoring

* refactor(ClickThrough_GenerateEmbeddings): correct max_len handling ([`fdc3e3d`](https://github.com/tsenoner/protspace/commit/fdc3e3d7c4fee785ef882f43948190c991bf04bb))

* refactor(ClickThrough_GenerateEmbeddings): streamline code structure and enhance functionality

- Updated cell metadata and IDs for better organization.
- Improved installation instructions by adding missing dependencies.
- Enhanced model setup logic to support additional models, including ProstT5, native ESM3 (open variant), and native ESMC (300m and 600m variants).
- Refined embedding computation to handle different model types and added length checks.
- Updated output file naming convention to include model type for clarity.
- Improved error handling for invalid sequence headers.
- Added optional Hugging Face login cell for models requiring authentication. ([`7d3673b`](https://github.com/tsenoner/protspace/commit/7d3673b12ecd1f94fd08fbd3999632fe376a1e45))


## v1.2.0 (2025-04-15)

### Unknown

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`4b1e33d`](https://github.com/tsenoner/protspace/commit/4b1e33d306f7fe839368a53f2683c18f1523f83a))


## v1.1.8 (2025-04-15)

### Chores

* chore: update notebooks to install protspace[frontend] ([`e5398b6`](https://github.com/tsenoner/protspace/commit/e5398b652971c026f09ed9458e168e481f7c19f5))

### Documentation

* docs: add image of the different 2D markers ([`a0da72a`](https://github.com/tsenoner/protspace/commit/a0da72ab426e21c0b1ba31c2e61660624fca5692))

* docs: add note that external mode only works on Google Chrome ([`eb9dd10`](https://github.com/tsenoner/protspace/commit/eb9dd10b6986ba506cef40684e18558e30cf045a))

* docs: add PfamExplorer notebook ([`67fc596`](https://github.com/tsenoner/protspace/commit/67fc5968b3461971cdaf8cd29c0e82f734fb3b36))

* docs: update the README to reflect the changes in frontend dependencies ([`244b7ec`](https://github.com/tsenoner/protspace/commit/244b7ecf26d496c76e076401342fd6195813ccd9))

### Features

* feat(localmap): add new LocalMAP redundancy reduction ([`38d4982`](https://github.com/tsenoner/protspace/commit/38d498206552249c724cd469a8eae1290fde2d57))

### Fixes

* fix(pca): switch to arpack solver for numerical stability

Resolves `RuntimeWarning`s during PCA on `float16` embeddings by using `svd_solver='arpack'`. Removed prior dtype casting attempts. ([`0bf5b21`](https://github.com/tsenoner/protspace/commit/0bf5b21d06ac9f97aa2fb463b5a2b41f03ebaca8))

### Refactoring

* refactor(prepare_json): Improve maintainability ([`13af68f`](https://github.com/tsenoner/protspace/commit/13af68fb7153e623e7d323f56b0a5e34a5d0bc8b))

* refactor(json-analysis): show all feature values on high verbosity ([`9b8b833`](https://github.com/tsenoner/protspace/commit/9b8b8333e4fc38967074c07da9e93cea893139ab))

### Unknown

* example(pfamExplorer): extend description ([`8887d54`](https://github.com/tsenoner/protspace/commit/8887d54e733fd24da6fa1f4b981a3849cecaf38b))

* example(pfamExplorer): add option to download generated JSON file ([`e5ba1cb`](https://github.com/tsenoner/protspace/commit/e5ba1cb4b3d0325fd2d806e84d74d513bfe34847))


## v1.1.7 (2025-03-28)

### Fixes

* fix: NaN coloring ([`b6821be`](https://github.com/tsenoner/protspace/commit/b6821becf311f745eaebedafde662e86612a28f3))


## v1.1.6 (2025-03-28)

### Documentation

* docs: clearify the file upload in the embedding jupyter notebook ([`744b5bf`](https://github.com/tsenoner/protspace/commit/744b5bfe9905a151416f92dd6c3907662c276c60))

### Fixes

* fix: NaN process + app.run update ([`5250e33`](https://github.com/tsenoner/protspace/commit/5250e336929995f5ab0c20f59669c6b15da983b9))

### Refactoring

* refactor: check types ([`921e40d`](https://github.com/tsenoner/protspace/commit/921e40d1ab9f562712976d00a12675a4265e886c))

### Unknown

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`2168cf1`](https://github.com/tsenoner/protspace/commit/2168cf1799c6106b00fd9a5675dea8c20affde9f))

* Adding config file improvements (#5)

* Adding to_dict_by_method to DimensionReductionConfig

* Making parameter config matching case-insensitive

* Adding constraints to config fields

* Adding name to parameter dict

* Changing to_dict to parameters_by_method and returning List

* Adding separate key for parameter constraints

* Separating frontend dependencies to optional dependencies

* Adding frontend import error handling

* Changing param.lower() in parameter dict by method function

* Adding type hints to constraints

* Adding additional metadata constraints for parameters

* Adding experimental docstring extraction for method parameters

* Improving parameter description cleaning ([`0f9d0d1`](https://github.com/tsenoner/protspace/commit/0f9d0d16e0fdab31a90eb60497f4db50f2396981))


## v1.1.5 (2025-01-28)

### Documentation

* docs: Add citation, web-service URL, fix parameter typo ([`ebf308d`](https://github.com/tsenoner/protspace/commit/ebf308d950ed408d362bf58014b2e3ac094cd98d))

### Fixes

* fix: add metadata delimiter definition option and sanity checks when creating .h5 ([`b4591ed`](https://github.com/tsenoner/protspace/commit/b4591ed38d523936c7b3ef29abf976a9b50de1f0))


## v1.1.4 (2025-01-07)

### Documentation

* docs: add citation links to help menu ([`61dc188`](https://github.com/tsenoner/protspace/commit/61dc1887e6a63c914b8355ddfafed6edc0d40362))

### Fixes

* fix: update annotation image ([`27fed47`](https://github.com/tsenoner/protspace/commit/27fed4727fdd9926a0e7918e8762de8c48ff0e84))


## v1.1.3 (2025-01-05)

### Fixes

* fix: update the dependencies ([`f2b0009`](https://github.com/tsenoner/protspace/commit/f2b00090ff712ea4ab2ee3de4dda8f4bb15e244f))


## v1.1.2 (2025-01-05)

### Fixes

* fix: add JSON instruction layout ([`1531335`](https://github.com/tsenoner/protspace/commit/1531335417e0c2f7187e3dab2963037b6c18bcf0))


## v1.1.1 (2025-01-04)

### Code Style

* style: update help menu ([`cb4262e`](https://github.com/tsenoner/protspace/commit/cb4262e0aa2d07048d8feb386ace1bdbf49ed133))

### Fixes

* fix: update workflow image ([`bbaf9dd`](https://github.com/tsenoner/protspace/commit/bbaf9dd5ca337aea2981b17ddaf37a8059eb998b))


## v1.1.0 (2025-01-03)

### Chores

* chore: update example file ([`ec74ab7`](https://github.com/tsenoner/protspace/commit/ec74ab7090aaeb339b04c4cc53b84518f5ee36ce))

* chore: update example file ([`94ef539`](https://github.com/tsenoner/protspace/commit/94ef539cd7d40027d40bad1740ffed1e74e9262a))

### Features

* feat: add help button ([`3c2c4c4`](https://github.com/tsenoner/protspace/commit/3c2c4c47b7947d121ff0158f0d0dccf3733e0607))


## v1.0.4 (2025-01-02)

### Fixes

* fix: wrong import in prepare_json ([`82efdf4`](https://github.com/tsenoner/protspace/commit/82efdf449976c4d00ce4661a9f1f1a31a0ad77a5))

### Unknown

* refactore: add quality check to prepare_json.py ([`f87cdb6`](https://github.com/tsenoner/protspace/commit/f87cdb626b1a5dda7e49298585bc388f6e1939f8))


## v1.0.3 (2024-12-18)

### Documentation

* docs: Add full path to toxin 2D example ([`32b387e`](https://github.com/tsenoner/protspace/commit/32b387efa38a3dc00edb324520324c8595d4f3c6))

### Fixes

* fix: make embeddings without feature <NaN> ([`bf97138`](https://github.com/tsenoner/protspace/commit/bf97138a28acb79409cb177bc9b1a656119d3812))

### Unknown

* Update embedding generator ([`e0ca7fe`](https://github.com/tsenoner/protspace/commit/e0ca7fe714d4e7ed5a02399acef51ab01f7ee6f1))

* Add forgotte change ([`6446fba`](https://github.com/tsenoner/protspace/commit/6446fba99235abcbf52111f00e50056d272e3179))

* Add navigation guide to 'Explore_ProtSpace.ipynb' ([`1e14f4b`](https://github.com/tsenoner/protspace/commit/1e14f4b12a8d88cb1c3ee1bdb51bbc2a522bfd86))


## v1.0.2 (2024-12-03)

### Fixes

* fix: transparancy assignment ([`edbac07`](https://github.com/tsenoner/protspace/commit/edbac07b34021b901906e1bc77c4fb49f12030d2))

### Unknown

* Make Marker config dependent on visualization dimension ([`3e2566a`](https://github.com/tsenoner/protspace/commit/3e2566a82d6e9c0ec96efded8e74bdb55afb8626))


## v1.0.1 (2024-12-03)

### Fixes

* fix: only display possible 3D markers ([`79fe477`](https://github.com/tsenoner/protspace/commit/79fe477a4581939d17b610b533481e46d33bee2e))

### Unknown

* Add note about Safari browser limitations for google colab ([`fd141c5`](https://github.com/tsenoner/protspace/commit/fd141c520e77f3757869de0ec436fccd9e6b2c55))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`f029c37`](https://github.com/tsenoner/protspace/commit/f029c37a99af79a792ab4ca053ab4bd9f1ffd323))


## v1.0.0 (2024-11-30)

### Breaking

* fix: format README

BREAKING CHANGE: release ([`9a37e48`](https://github.com/tsenoner/protspace/commit/9a37e48295eef82198916f1980803a1315c926f3))

### Unknown

* BREAKING CHANGE: release again ([`3b3b2c6`](https://github.com/tsenoner/protspace/commit/3b3b2c6e6920d5d8ada8ca9db2fa5fb122cd961a))

* Braking Change: Release ([`366f4b7`](https://github.com/tsenoner/protspace/commit/366f4b75bef846be42d5dcb1c6e68ccfc570fd49))

* hide installation progress in exploration jupyter ([`f48f3f6`](https://github.com/tsenoner/protspace/commit/f48f3f612140e735ce41062f274eac6e4806dde0))

* update notebook: clean old cell ([`d7e6895`](https://github.com/tsenoner/protspace/commit/d7e6895b5c97baa23e40853a9ec3f68950b1d372))

* Merge branch 'main' of https://github.com/tsenoner/protspace ([`564ee64`](https://github.com/tsenoner/protspace/commit/564ee64cb2aecc6c8f6c5dd665d966e05cb9af80))


## v0.1.0 (2024-11-28)

### Chores

* chore: fix docker container version tagging ([`317570f`](https://github.com/tsenoner/protspace/commit/317570f67770c5fb5482d40a2b0f8667e2af3346))

* chore: improve uv caching ([`a62282b`](https://github.com/tsenoner/protspace/commit/a62282b55bc65cf20ef8f36a0b1138c5af7adac1))

* chore: update uv.lock file [skip ci] ([`e71a89c`](https://github.com/tsenoner/protspace/commit/e71a89c85f8f037de6841083780f8ddb9d745867))

* chore: fix build process ([`c62ac73`](https://github.com/tsenoner/protspace/commit/c62ac737c3018845dd58d8053ca49729c13cd65b))

### Continuous Integration

* ci: modularize build process ([`4da6438`](https://github.com/tsenoner/protspace/commit/4da643895d0de4ab295ae1fcaf2b077e4f389653))

### Features

* feat: update datasets ([`611c83f`](https://github.com/tsenoner/protspace/commit/611c83fe0a7277b6a00ec3bc218cbf4fa67cf448))

* feat: test update ([`95b620c`](https://github.com/tsenoner/protspace/commit/95b620cf0b3cf70325f83439a3109f78eb1921ca))

* feat(utils): add JSON analyzer for data inspection

Add a CLI utility that provides insights into ProtSpace JSON files
with configurable detail levels. The tool helps inspect:
- Number of proteins and available features
- Dimensionality reduction methods
- Feature distributions
- Visualization settings ([`202c5cc`](https://github.com/tsenoner/protspace/commit/202c5ccc353294b4c86bba877e78d2be832df67e))

* feat: add PaCMAP as a DR method ([`c7deb2d`](https://github.com/tsenoner/protspace/commit/c7deb2d5ea85209b8846ca57edd7ee26e9b9a467))

* feat: update uv caching strategy ([`ff03f33`](https://github.com/tsenoner/protspace/commit/ff03f33a7bf75c0591966332a5f3aaaa47d48ae5))

### Fixes

* fix: go back to square 1 ([`3d8e4e4`](https://github.com/tsenoner/protspace/commit/3d8e4e47d4d4dc40f60b73deca7aa85be6d0a97e))

* fix: adjust python version for numba ([`98955b4`](https://github.com/tsenoner/protspace/commit/98955b4694aba21b2ab9cea93de428f923955b25))

* fix: remove support for 3.10

Python 3.10 requires an only numy that is troublesome. ([`16c93f8`](https://github.com/tsenoner/protspace/commit/16c93f8119fbdfbc91bb30c7cecc24a1a23ca465))

* fix: remove dash-bio dependency ([`fbc4a8e`](https://github.com/tsenoner/protspace/commit/fbc4a8e36e69cdacea2c20a1e06bfb3da3e006f6))

* fix: remove explicit bio-dash dep ([`b6b59d9`](https://github.com/tsenoner/protspace/commit/b6b59d9f867d052cdf82826648520062581d4d4f))

* fix: populate __init__ file with scripts ([`621f66e`](https://github.com/tsenoner/protspace/commit/621f66eff4f53c3a814021cb4e9c61f470827dfc))

* fix: populate __init__ file with scripts ([`56cab43`](https://github.com/tsenoner/protspace/commit/56cab436b35f3df46cc10c04d3e1822283130c71))

* fix: jupyter notebook call ([`9d3ed21`](https://github.com/tsenoner/protspace/commit/9d3ed21c3154c0e51b6ef591bfb86ab3b0eef590))

* fix: allow for python version 3.10, 3.11, 3.12 ([`5531783`](https://github.com/tsenoner/protspace/commit/5531783af4ef73316f7988eb9d585f76139c031b))

* fix: psr toolname ([`20d13b9`](https://github.com/tsenoner/protspace/commit/20d13b91ac658f4cba323fa7921e0eabe8ba45fb))

* fix: github release ([`0104042`](https://github.com/tsenoner/protspace/commit/0104042b9fb0bcaa564fb9bd88b4bc6aebe3492e))

* fix: fix detached history problem ([`4e4198f`](https://github.com/tsenoner/protspace/commit/4e4198ff2c8b4339cc778f60cbdfe9f220d9fba7))

* fix: update config option in pyproject.toml ([`f9ed456`](https://github.com/tsenoner/protspace/commit/f9ed4561ea096426e1ea8c5c5623a22fc55d78b7))

* fix: check for release ([`2a9bb7b`](https://github.com/tsenoner/protspace/commit/2a9bb7b516687c5f53f836e24f0985e01ea9ee00))

* fix: add uv lock git username ([`66023b5`](https://github.com/tsenoner/protspace/commit/66023b562bec3384b733de88b79b4f6fd44414ff))

* fix: add manual uv.lock update ([`5698bab`](https://github.com/tsenoner/protspace/commit/5698bab49f43645311434f04f62c59d5a41a9563))

* fix: version command ([`b9aef74`](https://github.com/tsenoner/protspace/commit/b9aef74d6b30f4f419a5069324d7e4d74bbab345))

* fix: correct semantic-release command ([`eeb12cc`](https://github.com/tsenoner/protspace/commit/eeb12ccb87f58781a08fa77c3c6b076fd10f3db0))

* fix: remove git setup ([`1b242a3`](https://github.com/tsenoner/protspace/commit/1b242a38f39a21aa6523421cf1f8477917a02e50))

* fix: improve uv build process ([`30732d2`](https://github.com/tsenoner/protspace/commit/30732d2e4846577c4ce4e98eab5dc1157f504652))

* fix: change repository version ([`f807fd2`](https://github.com/tsenoner/protspace/commit/f807fd205eb27d19f6133a38772ee9803481076c))

* fix: add token permissions ([`1651fde`](https://github.com/tsenoner/protspace/commit/1651fde38c80eac4edcb04849283a117dc5712a2))

* fix: add version ([`c5268b9`](https://github.com/tsenoner/protspace/commit/c5268b944fd43109fdcbf3826ec17ad4e26e5afb))

* fix: correct version ([`0dd9107`](https://github.com/tsenoner/protspace/commit/0dd91070c891d353a683a34f870f126751e44ea3))

### Performance Improvements

* perf: add dev dependencies ([`f581f5d`](https://github.com/tsenoner/protspace/commit/f581f5d1862550a7c19b75caeaf4d81d34d1d6c4))

### Refactoring

* refactor: move pacmap dependence out of dev ([`18644df`](https://github.com/tsenoner/protspace/commit/18644dfdacb273d14e77bda96b8f03fd11463319))

### Testing

* test: add figures yaml files ([`0bf5147`](https://github.com/tsenoner/protspace/commit/0bf51470559dc0d2fa84a0f326856f0cd475932b))

* test: add tests for the prepare_json script ([`b9a254b`](https://github.com/tsenoner/protspace/commit/b9a254b30d64a4802e0b7d9f8352ad8292e4fc0c))

### Unknown

* update readme links to lowercase protspace ([`68f1619`](https://github.com/tsenoner/protspace/commit/68f1619f7fb92bc24fa97b97021108131090a3a1))

* Update .gitignore ([`0cdf190`](https://github.com/tsenoner/protspace/commit/0cdf190a15ee3edfd12178906d8b1c6f7838bdc5))

* Add example outputs ([`f104c30`](https://github.com/tsenoner/protspace/commit/f104c30aa1eec15836edaa83eaf4c92d9487d2e4))

* Add data ([`7c0442e`](https://github.com/tsenoner/protspace/commit/7c0442e5cd7b625448f0b7759127bbffe678fac9))

* Clear notebook output ([`abdf979`](https://github.com/tsenoner/protspace/commit/abdf979d88d760f8755c21a0c7699d1eee927b7d))

* Update Pla2g2 data: rename + fic inequality ([`61e1744`](https://github.com/tsenoner/protspace/commit/61e174465b07865780dc70552acefdfa1765d672))

* Update Notebooks to be better for walkthrough ([`8e45fa6`](https://github.com/tsenoner/protspace/commit/8e45fa6b3fa2f01d156b2926ad9ebb9947dfb3da))

* Update README: pip install + explore ProtSpace notebook ([`c19b7b3`](https://github.com/tsenoner/protspace/commit/c19b7b3bb16f39a23fc9c24bcfdb455cfc7c82fd))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`2a980ea`](https://github.com/tsenoner/protspace/commit/2a980ea20eccf5c5152791f3d83216e7c3acddfa))

* add option to force SVG creation, also with many dots ([`16ff253`](https://github.com/tsenoner/protspace/commit/16ff253c23bc795a0823f44497bec46271f8fa38))

* update noteboks to be more user friendly ([`bf2999b`](https://github.com/tsenoner/protspace/commit/bf2999b458efc141e2a5a6058131da8493a572ae))

* update README.md ([`55f3caa`](https://github.com/tsenoner/protspace/commit/55f3caa94339546ddd90ba5e2e4cd386e69d551f))

* remove github action pythonversion test ([`59a3052`](https://github.com/tsenoner/protspace/commit/59a3052b3117bc3fc07bf8f65656ae0008d054ac))

* make images creation easier with a YAML config file ([`94d7ba9`](https://github.com/tsenoner/protspace/commit/94d7ba96cc4f422da6fec8d2bc61df416a81df42))

* update example and code to generate imgs from cli ([`cedbbf3`](https://github.com/tsenoner/protspace/commit/cedbbf3ad90e588b991635f3143123e5740d4bb2))

* add notebook to create embeddings ([`adde18a`](https://github.com/tsenoner/protspace/commit/adde18a4db78955ee4f8bffef2b4b10dde285b09))

* remove foldseek and mmseqs GFP data ([`b09dc4e`](https://github.com/tsenoner/protspace/commit/b09dc4e39d3f3d95fbbfe3810c32c58400c36841))

* add GFP data and output examples ([`0a32fb8`](https://github.com/tsenoner/protspace/commit/0a32fb8fc87aafea9e625a9a1c7d41d353eee40c))

* add costum naming in prepare_json.py ([`9ec409c`](https://github.com/tsenoner/protspace/commit/9ec409c8f9357bf56bff6566da1689266d8f8437))

* reduce dot size on 3D plots ([`984e303`](https://github.com/tsenoner/protspace/commit/984e303a86b93bdf3ea52bdc6794bf7e73625807))

* add natural key sorting to legend ([`d73a1c7`](https://github.com/tsenoner/protspace/commit/d73a1c7ac18edcb213595c90af1000a56d1510b7))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`6981db7`](https://github.com/tsenoner/protspace/commit/6981db7a1e33f38e9bc0fe1aa354bc8c0c71d472))

* Merge branch 'main' of https://github.com/tsenoner/ProtSpace ([`e08528d`](https://github.com/tsenoner/protspace/commit/e08528d372932474219742f2a818139032daaf45))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`498ed53`](https://github.com/tsenoner/protspace/commit/498ed530757e3b63ca4d4c3f45bf0e7125d870e6))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`ec31aa0`](https://github.com/tsenoner/protspace/commit/ec31aa0880bbbdcceed977b8a5b5eeac1028b670))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`f6df935`](https://github.com/tsenoner/protspace/commit/f6df935971f026871fd772fd5029b474267c4616))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`514d4f4`](https://github.com/tsenoner/protspace/commit/514d4f46874bae77bb6f10d5f5da8de18f51c26e))

* Add uv.lock as build asset to be commited ([`1a0458d`](https://github.com/tsenoner/protspace/commit/1a0458d3f72e9702c73fc742656f130f95bf1b91))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`acaa577`](https://github.com/tsenoner/protspace/commit/acaa5777af858ea0273480f0b63efd6a8912027e))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`a2d6953`](https://github.com/tsenoner/protspace/commit/a2d695368083972b558f107f835334f2273b783b))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`c86a640`](https://github.com/tsenoner/protspace/commit/c86a640535334dc63258fb654f4b68750be554b9))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`99a2fbc`](https://github.com/tsenoner/protspace/commit/99a2fbc027edfce29647aa2b5fbbf53c79908963))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`7c2b732`](https://github.com/tsenoner/protspace/commit/7c2b7327f231d05b1505d0058b2d98b44f3ed125))

* fix invalid yaml

fix: build process ([`e624319`](https://github.com/tsenoner/protspace/commit/e62431908fca74120c07d033c2297122c3068ee1))

* fix pypi push action

fix: build process ([`aa89653`](https://github.com/tsenoner/protspace/commit/aa89653dddcadbb391bd1c42081351a50a9a83fe))

* add python semantic release

chore: Add python build and push ([`86ba04d`](https://github.com/tsenoner/protspace/commit/86ba04d53d01640a9cb4233190967b78348a92da))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`c560ddf`](https://github.com/tsenoner/protspace/commit/c560ddfdb1c8b65acad13de8eebac2afe79dbdb7))

* ignore SyntaxWarning of biopython ([`36c56a1`](https://github.com/tsenoner/protspace/commit/36c56a190610bc3f60d335e741b439491a71d3e0))

* Only build on tags ([`07dc4ac`](https://github.com/tsenoner/protspace/commit/07dc4acdf3d845dba89d501db6e2c06fa5b0bd66))

* Docker build only on src changes ([`1002211`](https://github.com/tsenoner/protspace/commit/100221166ea91063c08fb6f07f120eb25e752dcd))

* Create jekyll-gh-pages.yml ([`0c96791`](https://github.com/tsenoner/protspace/commit/0c96791079da703d9304e8e72a88d3980563db54))

* Version bump ([`78dafba`](https://github.com/tsenoner/protspace/commit/78dafba8c25efc4f5d2e2379c830802a0d7123ea))

* Update README.md ([`f6deb41`](https://github.com/tsenoner/protspace/commit/f6deb4127b04ac03a50cc056b60999691b8cf188))

* Updated README.md ([`67f1853`](https://github.com/tsenoner/protspace/commit/67f185307d898c616878379dac9c67def019f162))

* Version Bump ([`8e8629e`](https://github.com/tsenoner/protspace/commit/8e8629e6d3447dd240b55ef848c888ebf566c82c))

* Merge branch 'main' of github.com:tsenoner/ProtSpace ([`77066bb`](https://github.com/tsenoner/protspace/commit/77066bb6d9941f607e18dbe5199f68b156492f76))

* Remove unneccary __init__.py lines ([`d7bbb1b`](https://github.com/tsenoner/protspace/commit/d7bbb1b02c6f0eb48fd02df5270f5d8a9208714d))

* Updated dependencies ([`ba4c297`](https://github.com/tsenoner/protspace/commit/ba4c297a2a1816d2895494decf26ab41f1ff6c13))

* Add commandline parsing ([`fe39d9b`](https://github.com/tsenoner/protspace/commit/fe39d9b887c97b4132d6fdc83d2ec2a8b52aec90))

* Add render deploy hook ([`17ee985`](https://github.com/tsenoner/protspace/commit/17ee9859494cc5fc1d9eec2102f4a4ba9d010424))

* Merge pull request #4 from tsenoner/f-transition-uv

Add data to docker image ([`0f8c2b2`](https://github.com/tsenoner/protspace/commit/0f8c2b2e171a18f1e17e752736ffb3a70491b48f))

* Add data to docker image ([`9ccc392`](https://github.com/tsenoner/protspace/commit/9ccc39263ae585968ea4712c0936bc489c112e82))

* Merge pull request #3 from tsenoner/f-transition-uv

F transition uv ([`c694b07`](https://github.com/tsenoner/protspace/commit/c694b07855b28a9c0475c474fd08b78570ff23f4))

* Fix license ([`3cd0d81`](https://github.com/tsenoner/protspace/commit/3cd0d811a281ab62e970d09f1a26701d2aa60212))

* Add Github Action to build image ([`7581401`](https://github.com/tsenoner/protspace/commit/7581401cdfaee8f9357a60372d8df64c31c806f4))

* Add relevant labels ([`f252b1f`](https://github.com/tsenoner/protspace/commit/f252b1f0a856f61a0f79517cbe262ba2fc25a2a7))

* fix docker deployment ([`54b7731`](https://github.com/tsenoner/protspace/commit/54b77314242862685fd33c2227cde0f9746821a9))

* Fix import in main from util to config ([`cab1598`](https://github.com/tsenoner/protspace/commit/cab1598266687bdb4be1974b1923ee71caf1b92a))

* Update examples ([`4ae35f2`](https://github.com/tsenoner/protspace/commit/4ae35f20e0c66a14160c177c00eaacd17802c5a9))

* Merge branch 'main' into f-transition-uv ([`41d0521`](https://github.com/tsenoner/protspace/commit/41d0521d606c8d586543982e50d7c5cf1e88d20d))

* Correct deployment path name ([`73f8027`](https://github.com/tsenoner/protspace/commit/73f8027194b2edaa2053e6b252519e2be1ec0293))

* Update Example images ([`e4c02c9`](https://github.com/tsenoner/protspace/commit/e4c02c94ad644045b5388430030cc2364e6b410c))

* Update Pla2g2 example data ([`0cbf866`](https://github.com/tsenoner/protspace/commit/0cbf86646492a4c311e6e375f1cb9a0547b7ef38))

* Change example data to Pla2g2 ([`19fe7ed`](https://github.com/tsenoner/protspace/commit/19fe7ed3f4ab5e374f887affcb40890dc33362b8))

* Add command ([`af87578`](https://github.com/tsenoner/protspace/commit/af875782d5cd776debd3cf7bbf86df8088ad40e0))

* Add dotenv ([`17979ad`](https://github.com/tsenoner/protspace/commit/17979ad9f7edfb6d8ffb5b22bdeeb39bb5c63e79))

* Fix src layout ([`e0aa9cf`](https://github.com/tsenoner/protspace/commit/e0aa9cfc0898913c3c854fa0676790fcc67afe9b))

* Update render config ([`6688f44`](https://github.com/tsenoner/protspace/commit/6688f44b4a93534bc117fd9046c3f038bf68b529))

* Add dockerfile ([`f1e7c2c`](https://github.com/tsenoner/protspace/commit/f1e7c2ce65d5e40e79b2c33fed7e1c3860bd9627))

* Switch to Env variables for more dynamic config ([`508f732`](https://github.com/tsenoner/protspace/commit/508f732f53b897148c324f70558732ea3fdfb5c3))

* Change uttils to config ([`df1fa40`](https://github.com/tsenoner/protspace/commit/df1fa40fa62f74f1550c65decda8a8b5b0af1dcd))

* Transition to uv ([`d8d8f02`](https://github.com/tsenoner/protspace/commit/d8d8f02b789f02e7672eca21ccb570849e9faffa))

* Move for easier packaging ([`2344b7e`](https://github.com/tsenoner/protspace/commit/2344b7e36f2ca6fb2103dbe2c9452002c66d606b))

* Rename to scripts ([`9c691db`](https://github.com/tsenoner/protspace/commit/9c691db4249f0af369d52799500b8cbc848f5879))

* Update LA image + add ProtSpace workflow ([`e9033e3`](https://github.com/tsenoner/protspace/commit/e9033e3ed65884e8d059554cf3cff8cda3dcaaf2))

* Remove old example file in base ([`c1a201d`](https://github.com/tsenoner/protspace/commit/c1a201d0e1658aad8b2b433f6603a1e5f3bffbab))

* Update merge script for manuscript ([`c2fb97a`](https://github.com/tsenoner/protspace/commit/c2fb97ae3faefc22129850a44fc6c6e37b6ebb2e))

* Add examples for pla2g2 and homo sapiens ([`8e7f5c8`](https://github.com/tsenoner/protspace/commit/8e7f5c8a392eb2f3faf6b09329808592e77f8a82))

* Add homo sapiens data ([`a98f417`](https://github.com/tsenoner/protspace/commit/a98f417a96853fe08993778f1bd9be67016efef0))

* Remove pdb directories from Git tracking ([`9e9374d`](https://github.com/tsenoner/protspace/commit/9e9374d72dd2afaf62f368503da3faabf8a69fdb))

* remove PDB by default in wsgi.py for gunicorn ([`333a1a8`](https://github.com/tsenoner/protspace/commit/333a1a814c2a9fa1ecd68cb45878f56e4667aac4))

* Fix broaken marker style update ([`d628b93`](https://github.com/tsenoner/protspace/commit/d628b9351f85f7ea7b5ac3dfc7209fe72f5cf571))

* Implement PDB viewer and zip upload ([`39f49ea`](https://github.com/tsenoner/protspace/commit/39f49ead785d0a0d7e85ef95813a430e41bd5963))

* Fix multiple worker run with gunicorn using dcc.Store ([`0e14933`](https://github.com/tsenoner/protspace/commit/0e149334d7f3dba8b1aea37d1852c2165f99dd4a))

* let render only install the needed dependencies ([`fbe9dfa`](https://github.com/tsenoner/protspace/commit/fbe9dfad182acc697d78e69b76a3edf1948cd067))

* move wsgi to protspace ([`4bbf489`](https://github.com/tsenoner/protspace/commit/4bbf4897d71277b53e235448eff771989823f27b))

* add __init__.py to script ([`76ba0c6`](https://github.com/tsenoner/protspace/commit/76ba0c6fd5b1bd72d695021f44c1c407f9145d89))

* Move render.yaml to base ([`e31858c`](https://github.com/tsenoner/protspace/commit/e31858c9ffcc5b2c0acf7e9043c7251ffc029504))

* Set everything up for render ([`4ab9404`](https://github.com/tsenoner/protspace/commit/4ab9404155fe90c2da6f54b99632ec85c97db952))

* add build.sh for render web service ([`ed5c057`](https://github.com/tsenoner/protspace/commit/ed5c057b6fe7c0f47d418e8e5e7940842e6201a6))

* Add Pla2g2 dataset ([`7c20fb8`](https://github.com/tsenoner/protspace/commit/7c20fb87afeaef4cc3754fe037e3fd216a400a3c))

* Extend script to add colors and shapes ([`c52650f`](https://github.com/tsenoner/protspace/commit/c52650f0656ab0bfecde1773d0eb45cd897793b1))

* Allow to append embedding spaces to existing JSON ([`18f73c0`](https://github.com/tsenoner/protspace/commit/18f73c0380eef81b283c1cebccd783ded5dd34a5))

* Rename config to utils ([`3d90fa2`](https://github.com/tsenoner/protspace/commit/3d90fa2e2ee33a8128b71ef7dfab56e552b18b43))

* Update examples ([`0efd90b`](https://github.com/tsenoner/protspace/commit/0efd90b522c246564e743d40b7a5a3e1ae210674))

* Update examples ([`be60366`](https://github.com/tsenoner/protspace/commit/be60366f7f1782fc94991e5708ace7d6c6157a5e))

* Add settings, download, and upload JSON button ([`d369a06`](https://github.com/tsenoner/protspace/commit/d369a06afd2ab841cb2afaaed8976249bbeafc6a))

* Update ProtSpace according to new JsonReader ([`87fb810`](https://github.com/tsenoner/protspace/commit/87fb810f7fde2e507e8913e356f94116e062c03b))

* JsonReader updates marker color and shape ([`13d6821`](https://github.com/tsenoner/protspace/commit/13d6821faa0e002a5ba2b92cd6f7875ee544bae0))

* Move color and marker shape update to callbacks ([`e61df93`](https://github.com/tsenoner/protspace/commit/e61df937e4bcbfd69aec628c42312f314101b5a1))

* Legend in saved image is proportional to height ([`8dc859f`](https://github.com/tsenoner/protspace/commit/8dc859f21350188af2ad3ce1c8623600e6f8c572))

* Add script to generate h_sapiens manuscript img ([`7b6e992`](https://github.com/tsenoner/protspace/commit/7b6e99224e18a46ad6a74810051a607680c18617))

* Update examples ([`42b23e2`](https://github.com/tsenoner/protspace/commit/42b23e27c611e0abcf61912b70434c3323f286ef))

* Handle <NAN> colors properly ([`6340833`](https://github.com/tsenoner/protspace/commit/6340833b182ac353d9fe91113df22fe4ac94b1b3))

* update the LA embedding creating script ([`645ece3`](https://github.com/tsenoner/protspace/commit/645ece32bf1b167fa5dd3e7d77db0f96fa4e680e))

* add script to download folcomp compressed structures ([`368cb3e`](https://github.com/tsenoner/protspace/commit/368cb3e2a1f8a837673db3780b38ff4eb3989bb3))

* add script to create LA embeddings ([`e5775f1`](https://github.com/tsenoner/protspace/commit/e5775f197292aa1710a7533e567a7a7663106aea))

* add examples for both hex and rbga colors ([`44a5f45`](https://github.com/tsenoner/protspace/commit/44a5f45e4f590516b02c91f6f3f0dec9b92d8420))

* Allow for costumized colors ([`eb6df74`](https://github.com/tsenoner/protspace/commit/eb6df744cb533fce03e279b1f57d15938bd6a229))

* Make the info key in the projections optional ([`17e07e2`](https://github.com/tsenoner/protspace/commit/17e07e2284c65dc1b24bb4b5192cdac66bdebc1f))

* Remove old notebook directory ([`b4d18ad`](https://github.com/tsenoner/protspace/commit/b4d18adca8d6cabe9e4a149186f15ed53667d7a4))

* Add notebook to explore ProtSpace w/o installation ([`180d902`](https://github.com/tsenoner/protspace/commit/180d902f502e56c9862d41595f202026043dbe65))

* Have no output when running the app interactivelly

E.g. when running in a jupyter notebook or Google colab ([`9d3426f`](https://github.com/tsenoner/protspace/commit/9d3426f1292005a53e23dcfddcfd4cfbf45c1902))

* Add some usecase examples ([`82ff759`](https://github.com/tsenoner/protspace/commit/82ff7597f0443ede4b159c46ebd98744144f47b3))

* Restructure app for better mantainability ([`c852272`](https://github.com/tsenoner/protspace/commit/c852272181cfb5cd802d3e2dc3a6de975c18e31f))

* add independent image generation ([`1d09860`](https://github.com/tsenoner/protspace/commit/1d0986017104c092b26f5c4b54ef940741b177b4))

* Update 3FTx.html file ([`1bdd44e`](https://github.com/tsenoner/protspace/commit/1bdd44ea4573916de7ad5df4aeba07bd51dda3d0))

* Correct path to 3FTx.html in README.md ([`7b3913a`](https://github.com/tsenoner/protspace/commit/7b3913ac1c7aeaf0622cbe0e6ae39362dfe97045))

* Correct path to 3FTx.html in README.md ([`fe950c4`](https://github.com/tsenoner/protspace/commit/fe950c40eb8dcae05bd045c98fafa961ae8162dc))

* Add example output to the README.md ([`beab0b7`](https://github.com/tsenoner/protspace/commit/beab0b7b0f221e1b4998fbeeb31fdfd6233cfa22))

* Update README.md ([`73cf792`](https://github.com/tsenoner/protspace/commit/73cf792334cf0ab42669a01a89f7576305a3e629))

* Add structure protein display next to scatter plot ([`e725145`](https://github.com/tsenoner/protspace/commit/e725145e7874caaf7d04efbb2637f42afb78e379))

* Update Layout, add download and search functionality ([`9e603f3`](https://github.com/tsenoner/protspace/commit/9e603f34a27be868061b3deaf3256c84f843ba3f))

* Restructure app and only keep what is necessary ([`e8cc4f3`](https://github.com/tsenoner/protspace/commit/e8cc4f3ad512de3127c099411aa4b238c71eb8a5))

* Add basic version of the main app to visualize protein embeddings ([`1ee43db`](https://github.com/tsenoner/protspace/commit/1ee43db0877054315015b8d5d50f85b801462b23))

* Add script to load JSON file for the app to handle ([`b980147`](https://github.com/tsenoner/protspace/commit/b980147eb7eea091ef49d81004ac710d1fec39bb))

* Prepare data to a JSON format to be visulaized ([`d14d71d`](https://github.com/tsenoner/protspace/commit/d14d71d2b3fb84a0273336e92977731cdb46572c))

* Create LICENSE ([`6ca4601`](https://github.com/tsenoner/protspace/commit/6ca460166d1b3c8c8a3ebf6462dba064030bb4d3))

* Directory structure ([`15dd9e4`](https://github.com/tsenoner/protspace/commit/15dd9e43f521683710e0bb8f716fac8d4766409b))

* Remove .DS_Store and add it to .gitignore ([`0def325`](https://github.com/tsenoner/protspace/commit/0def3259b892eaed3b157a8ed0244939a3527da1))

* Remove .DS_Store and add it to .gitignore ([`be45406`](https://github.com/tsenoner/protspace/commit/be454061eafab56150087dcf1459ce149f13fd81))

* Initial commit ([`51e0d75`](https://github.com/tsenoner/protspace/commit/51e0d7533b5b976a4d08fef219a35ce1ce9ae078))
