# Annotation Value Encoding Redesign (bundle format v2)

**Date:** 2026-07-08
**Issues:** [tsenoner/protspace#56](https://github.com/tsenoner/protspace/issues/56), [#57](https://github.com/tsenoner/protspace/issues/57), [#58](https://github.com/tsenoner/protspace/issues/58)
**Repos touched:** `protspace` (backend) + `protspace_web` (frontend) — coordinated, lock-step
**Status:** approved design — implementation plan to follow

---

## 1. Problem

All three issues are symptoms of **one fragile serialization contract**. Categorical annotation
cells are encoded as a single string per protein:

```
accession (name)|score1,score2;accession2 (name2)|EVIDENCE
```

with four structural characters: `;` between hits, `|` before a score-list or evidence code,
`( )` wrapping the human name, `,` between scores. **These characters also occur inside the
names** pulled from external databases (CATH-Gene3D, InterPro, ExPASy ENZYME, Pfam clans, UniProt
GO/keywords/subcellular). The overload corrupts parsing.

### Empirical evidence (real CATH corpus, `~/.cache/protspace/cath/cath-names.txt`, 5,142 named entries)

| Character | Names containing it | Role in grammar |
|-----------|--------------------:|-----------------|
| `,` comma | **38.5%** (1,979) | score separator |
| `;` semicolon | **15.2%** (784) | hit separator (this is #56) |
| `(` / `)` | 6.2% / 6.1% | name wrapper; **1 unbalanced** (`YojJ-like (1`) |
| `\|` pipe | **0%** | label↔score/evidence separator (this is #58 — latent for CATH, real for the contract) |
| `%` percent | 0% | — |
| any C0/DEL control char, TAB, NL | **0 of 5,142** | — |

Example real name that shatters today: `Ribosomal Protein L15; Chain: K; domain 2`.

### The three issues

- **#56** — `;` inside names shatters one hit into bogus categories (`domain 1)`, `domain 2)`, …).
- **#58** — `|` inside a name collides with the label↔score separator (latent; defensive/contract integrity).
- **#57** — a *different class* of bug: unnamed CATH superfamilies inherit the **parent topology
  name**. E.g. `6.20.10.10` (which has **no** name in CATH) is mislabeled `Laminin` (the name of
  topology `6.20.10`); siblings `6.20.10.10/.20/.30` all collapse to `Laminin`. **3,009** unnamed
  4-level superfamilies would inherit a fabricated name.

### Current frontend state

`protspace_web` already shipped a *defensive* paren-depth split (`splitOnTopLevelSemicolons`, the
[#282](https://github.com/tsenoner/protspace_web/pull/282) repair) whose own doc comment admits it
**silently merges hits** when parens are net-imbalanced and points back to #56 as the real fix. It
is a band-aid over a lossy, ambiguous contract.

---

## 2. Decision & rationale (research-backed)

A deep-research pass (22 claims, all primary sources, 3-vote adversarial verification) plus a
corpus scan and full cross-repo code maps drove these decisions.

### 2.1 Encoding: percent-encode a minimal reserved set inside a versioned flat STRING column

Two independent authoritative bioinformatics standards converge on **percent-encoding a closed
reserved set** to round-trip arbitrary text through a delimited field:
[GFF3](https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md) (`; = & ,` +
tab/nl/cr/`%`/control) and [VCF 4.3](https://samtools.github.io/hts-specs/VCFv4.3.pdf)
(`: ; = % , CR LF TAB`, uppercase hex). It is lossless, stateless-cheap to parse over 570k rows
(split on now-safe delimiters + one decode per field), human-inspectable, and tool-robust.

**Rejected alternatives:**
- **Native Arrow `list<struct>`** — viable (hyparquet *can* read nested STRUCT/LIST; pyarrow writes
  it), but heavier Dremel decode, `list<struct>` is a known-fragile area in hyparquet (struct-in-list
  bug fixed only Dec 2025, v1.23.3), the frontend `hyparquet-writer` **cannot** write nested (export
  would stay string-based anyway), and raw parquet stops being text-inspectable.
- **ASCII control-char delimiters** (US/RS 0x1F/0x1E) — *provably* collision-proof (0 of 5,142
  names contain any control char) but the research rejects them: silently stripped/mangled by
  CSV/TSV round-trips, dev-tools, and text tooling. Operationally fragile.

### 2.2 Minimal reserved set: `%`, `;`, `|`, and control chars — NOT `,`/`(`/`)`

Given ProtSpace's grammar, only `%` `;` `|` (+ control chars for hygiene) need encoding:

- **`,` stays literal.** Commas only mean "score separator" *after* `|`; a comma inside a name is
  before the `|`, positionally isolated, and never reaches the score split. Encoding all 38.5% of
  comma-bearing names would hurt readability for zero correctness gain.
- **`( )` stay literal.** They are pure display sugar. Once `;` is encoded out of names, the cell
  splits cleanly on `;`, and interior parens (including the one unbalanced case) are just part of
  the label string — no depth tracking needed.

Result: names stay maximally readable (only the rare literal `;`/`|` become `%3B`/`%7C`); and every
fragile frontend heuristic (`splitOnTopLevelSemicolons`, `lastIndexOf('|')` ambiguity) is
**eliminated** for v2.

### 2.3 #57: label unnamed superfamilies by bare code; drop parent-name inheritance

Unanimous across three authorities:
- CNF format spec leaves the name field **blank**, no propagation
  ([README-cath-names-file-format.txt](https://download.cathdb.info/cath/releases/latest-release/cath-classification-data/README-cath-names-file-format.txt)).
- cathdb.info shows *"CATH Superfamily 6.20.10.10 … waiting to be named"*
  ([page](https://www.cathdb.info/version/latest/superfamily/6.20.10.10)).
- InterPro API returns `name: null` for `G3DSA:6.20.10.10` and siblings
  ([API](https://www.ebi.ac.uk/interpro/api/entry/cathgene3d/G3DSA:6.20.10.10/)).

Propagating "Laminin" is a ProtSpace-introduced misrepresentation. Fix: an unnamed superfamily
shows its **bare code**, no fabricated name.

---

## 3. The codec (identical in Python and TypeScript)

```
RESERVED = { '%' → '%25', ';' → '%3B', '|' → '%7C' } ∪ { each c in 0x00..0x1F, 0x7F → '%' + HEX(c) }

encode_field(s):  replace every reserved char with its %XX form (uppercase hex).
                  '%' must map to '%25' so the transform is reversible.
decode_field(s):  single left-to-right pass of /%([0-9A-Fa-f]{2})/ → chr(int(hex,16)).
```

**Reversibility proof sketch:** the encoder emits `%XX` only for reserved chars, and every literal
`%` in the source becomes `%25`. On decode, the regex consumes each `%XX` as one token
left-to-right, so a source substring like `%3B` (encoded to `%253B`) decodes `%25`→`%` then leaves
`3B` literal → `%3B`. Order-independent and lossless for arbitrary UTF-8 (non-ASCII bytes are never
in the reserved set, so multibyte sequences pass through untouched).

- Backend: **new** `src/protspace/data/annotations/encoding.py` exporting `encode_field`,
  `decode_field`, `RESERVED`, and the format-version constant.
- Frontend: mirror in a small util imported by `conversion.ts` (e.g.
  `packages/core/src/components/data-loader/utils/annotation-codec.ts`).

Scores are numeric and evidence codes match `[A-Z]{2,5}` / `ECO:\d+` — neither contains a reserved
char, so encoding them is a documented no-op; we still route them through `encode_field` at emit
for uniformity and future-proofing.

---

## 4. Cell grammar (v2)

Unchanged shape; the difference is that free-text tokens are `encode_field`-ed:

```
cell     := hit ( ';' hit )*
hit       := label ( '|' suffix )?
label     := encode_field(display_label)          # e.g. "PF00001 (7tm_1)", "Cytoplasm", "6.20.10.10"
suffix    := scorelist | encode_field(evidence)
scorelist := number ( ',' number )*
```

`display_label` may itself be `accession (name)` — since `( )` are not reserved, encoding the label
only touches `%`/`;`/`|`/control inside it, leaving `accession (name)` structurally intact while
neutralizing any `;`/`|` that lived in `name`.

**Invariants after v2 encoding:**
- No name/label/evidence token contains a literal `;` or `|`.
- Therefore `cell.split(';')` yields exactly the hits, and each hit has **at most one** structural
  `|` (`indexOf === lastIndexOf`).
- `--no-scores` drops the `|suffix`, leaving the encoded label (decoded at display).

---

## 5. Versioning & migration

Stamp `format_version = 2` into the bundle.

- **Primary location:** parquet **key-value metadata** on the `protein_annotations` table
  (`table.replace_schema_metadata({b"protspace_format_version": b"2"})` on the backend; read via
  hyparquet's metadata API on the frontend). Always present, semantically correct, no data-schema
  change.
- **Fallback (if hyparquet KV-metadata access is awkward on the JS side):** a `format_version`
  field in the JSON the frontend already parses (settings `settings_json` or projections
  `info_json`). **To be finalized in the implementation plan after a ~5-minute frontend check** of
  hyparquet's metadata surface; the spec does not block on it.

**Frontend branch:**
- `format_version >= 2` → v2 decode path (§7).
- absent / `< 2` → **existing legacy parser, unchanged** (paren-depth split + `lastIndexOf('|')` +
  evidence regex). Every already-distributed `.parquetbundle` renders exactly as today; **no
  regeneration required**.

Backend always writes v2 going forward. Regenerating the default Swiss-Prot bundle on protspace.app
to v2 (to get corrected names + #57) is an optional post-merge follow-up, not part of this change.

---

## 6. Backend changes (`protspace`)

Emit sites (from the code map) that must `encode_field` the free-text token:

| Site | File:line | Token |
|------|-----------|-------|
| InterPro hit name | `data/annotations/retrievers/interpro_retriever.py:362` | `name` in `f"{acc} ({name})"` |
| TED domain name | `data/annotations/retrievers/ted_retriever.py:88` | `name` |
| EC enzyme name | `data/annotations/transformers/uniprot_transforms.py:188` | `name` |
| Pfam clan name | `data/annotations/transformers/interpro_transforms.py:68` | `clan_name` |
| UniProt keyword name | `data/parsers/uniprot_parser.py:272` | `name` |
| Subcellular value | `data/parsers/uniprot_parser.py:314` | `value` before `\|ev` |
| protein_families value | `data/parsers/uniprot_parser.py:337` | `result` before `\|ev` |
| EC value (parser) | `data/parsers/uniprot_parser.py:355` | `value` before `\|ev` |
| GO bp/mf/cc values | `data/parsers/uniprot_parser.py:374/386/398` | `value` before `\|ev` |

**Free wins (no logic change — they become correct once names carry no `;`/`|`):**
`transform_cath` (`interpro_transforms.py:91`), `transform_pfam_clan` (`:133/141`),
`_strip_scores_from_cell` (`annotations/scores.py:53-60`). Add a **regression test** asserting they
now handle a `;`-bearing name correctly.

**Latent gap to close:** add `ted_domains` and `pfam_clan` to `SCORE_BEARING_COLUMNS`
(`annotations/scores.py:12-30`) so `--no-scores` strips their suffixes too.

**Decode at display only:** `utils/add_annotation_style.py:_to_display_value` (`:86-103`) and any
Dash `serve` display path must `decode_field` the name for human display. The bundle-on-disk stays
**encoded** (it is the wire format). Confirm the Dash visualization path during implementation.

**#57 fix:** delete the parent-topology inheritance loop in
`data/annotations/retrievers/cath_names.py:101-105`. Unnamed 4-level superfamilies then resolve to
`""` via `cath_names.get(code, "")`, so emit sites produce the bare code with no `(name)`.

**Version stamp:** `data/io/bundle.py:write_bundle` writes `format_version=2` (per §5).

---

## 7. Frontend changes (`protspace_web`)

All decoding is centralized in `packages/core/src/components/data-loader/utils/conversion.ts`
(the single chokepoint) + the new codec util.

- **v2 path:**
  - `splitCategoricalAnnotationValues` → plain `value.split(';')` (no paren-depth scan).
  - `parseAnnotationValue` → split on the single structural `|`, then `decode_field` on the label
    and on the evidence token; numeric scores parsed as today.
- **v1 path:** legacy `parseAnnotationValue` + `splitOnTopLevelSemicolons` retained **unchanged**.
- Version detection added in `bundle.ts:extractRowsFromParquetBundle` before building
  `annotationsById`.
- **Downstream consumers unaffected:** legend, tooltip, sort, filter, isolation-reslice all read
  the already-decoded `{labels, scores, evidence}` structures (`annotation_scores` /
  `annotation_evidence` / `annotation.values`), whose shapes are preserved.

**Out of scope:** the frontend export path (`packages/utils/src/parquet/bundle-writer.ts`) is
*already* lossy (label-only, first hit; drops scores/evidence/secondary hits). Making export
lossless is **not** part of this change (noted for a future issue).

---

## 8. Testing (TDD — failing tests first)

**Backend**
- Codec round-trip property: `decode_field(encode_field(s)) == s` for arbitrary text incl. every
  reserved char, control chars, non-ASCII, the real `Ribosomal Protein L15; Chain: K; domain 2`,
  and `YojJ-like (1`.
- Emit-site tests updated to expect encoded names (e.g. the `;`-name → `%3B`).
- Regression tests for the "free win" transformers/strip on a `;`-bearing name.
- `--no-scores` gap: `ted_domains` / `pfam_clan` now stripped.
- #57: `test_cath_names.py` flipped — unnamed superfamily has **no** name (bare code), siblings
  distinct. (Replaces `test_unnamed_superfamily_inherits_topology`.)

**Frontend**
- Codec round-trip (mirror of the backend property).
- `parseAnnotationValue` v2: encoded input → decoded label/evidence/scores; single-`|` unambiguity.
- `splitCategoricalAnnotationValues` v2: plain split; legacy v1 tests retained for the v1 branch.
- Version-detection test: v1 vs v2 branching.

**Cross-repo end-to-end proof (the key test)**
- A small **v2 `.parquetbundle` produced by the backend, read by the frontend**, asserting that a
  `;`-bearing name round-trips to exactly **one** category with the literal `;` restored — the exact
  #56 bug, proven fixed across the seam. Plus a v1 fixture that still renders via the legacy path.

---

## 9. Docs, versioning, rollout

- Update `protspace/docs/annotations.md` and `protspace_web/docs/guide/{data-format,annotations}.md`
  to document the v2 encoding contract (reserved set, encode/decode, version field, the
  deliberately-literal `,`/`(`/`)`).
- Update the Colab preparation notebook only if it documents the value grammar (check).
- Commits: `feat:` in **both** repos (bundle format is package-user-visible → minor bump under
  semantic-release). Feature branch `feat/annotation-encoding-v2` off `main` in each repo; open a PR
  in each, cross-linking #56/#57/#58.

## 10. Scope boundaries (YAGNI)

**In:** the codec; all emit + display-decode sites; the `format_version` stamp + frontend branch;
the #57 inheritance removal; docs; tests incl. the cross-repo fixture.
**Out:** native nested columns; lossless frontend export; encoding `,`/`(`/`)`; any DR/projection
changes; regenerating already-distributed bundles.

## 11. Open items to settle in the implementation plan

1. Final `format_version` location (parquet KV metadata vs settings/info JSON) — after the 5-min
   hyparquet metadata check.
2. Exact Dash `serve` decode points (confirm which display paths re-parse names).
3. Whether any non-CATH name source (GO/keyword) can carry a literal `%` today that the v2 encoder
   must round-trip (corpus-check GO/keyword/EC names alongside CATH).
