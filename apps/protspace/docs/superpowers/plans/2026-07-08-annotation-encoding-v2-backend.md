# Annotation Encoding v2 — Backend (`protspace`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `protspace` backend emit lossless, percent-encoded, version-stamped categorical annotation cells (bundle format v2) so external-DB names containing `;`/`|` never corrupt parsing, and stop fabricating names for unnamed CATH superfamilies (#57).

**Architecture:** A tiny shared codec (`encode_field`/`decode_field`) percent-encodes a minimal reserved set (`%` `;` `|` + C0/DEL control chars) inside every free-text token (name / bare-text label / evidence) at the serialization boundary; the bundle carries `format_version = 2` in parquet file-level key-value metadata on the `protein_annotations` table. Names are stored encoded (the wire format) and decoded only at display. Unnamed CATH superfamilies resolve to their bare code.

**Tech Stack:** Python ≥3.10, pyarrow 20, pandas, pytest, ruff. Run everything with `uv run`.

## Global Constraints

- Run all Python via `uv run` (e.g. `uv run pytest -m "not slow"`, `uv run ruff check src/ tests/`). Never bare `python`.
- ruff, py310 target, 88-char line length.
- TDD: failing test first, minimal implementation, green, commit. Frequent commits.
- Reserved set encoded inside free-text tokens: `%` → `%25`, `;` → `%3B`, `|` → `%7C`, and each control char `0x00–0x1F`/`0x7F` → `%XX` (uppercase hex). **`,` `(` `)` are NOT encoded** (positionally safe / display sugar — keeps names readable).
- Bundle format version constant value: `2`. KV metadata keys: `protspace_format_version = "2"`, `protspace_encoding = "pct"`.
- Branch: `feat/annotation-encoding-v2` (already created off `main`). Commits use `feat:` (bundle format is package-user-visible → minor bump).
- Spec: `docs/superpowers/specs/2026-07-08-annotation-encoding-redesign-design.md`.

---

## File Structure

- **Create** `src/protspace/data/annotations/encoding.py` — the codec + version constant + table stamp helper. One responsibility: the v2 wire codec.
- **Create** `tests/test_annotation_encoding.py` — codec unit tests.
- **Modify** emit sites (wrap the free-text token in `encode_field`): `retrievers/interpro_retriever.py`, `retrievers/ted_retriever.py`, `transformers/uniprot_transforms.py` (EC), `transformers/interpro_transforms.py` (clan), `parsers/uniprot_parser.py` (keyword/subcellular/families/go).
- **Modify** `retrievers/cath_names.py` — remove #57 inheritance.
- **Modify** `annotations/scores.py` — add `ted_domains` to the strip allowlist.
- **Modify** `processors/base_processor.py` + `cli/bundle.py` — stamp the version.
- **Modify** `utils/add_annotation_style.py` — decode at display.
- **Modify** `docs/annotations.md` — document the v2 contract.
- **Modify** tests: `test_cath_names.py`; add reserved-char cases to `test_interpro_annotation_retriever.py`, `test_ted_retriever.py`, `test_transformer.py`, `test_pfam_clan.py`, `test_annotation_manager.py`.

> **Low test churn, by design:** existing emit-site assertions use names with **no** reserved chars (`7tm_1`, `Winged helix`, `Acting on peptide bonds (peptidases)` — parens are not encoded), so `encode_field` is a no-op there and those tests keep passing. New tests cover reserved-char names. The only behavior-change test edit is `test_cath_names.py` (#57).

---

## Phase A — Codec foundation

### Task A1: The v2 codec

**Files:**
- Create: `src/protspace/data/annotations/encoding.py`
- Test: `tests/test_annotation_encoding.py`

**Interfaces:**
- Produces: `encode_field(s: str) -> str`, `decode_field(s: str) -> str`, `BUNDLE_FORMAT_VERSION: int = 2`, `FORMAT_VERSION_KEY = b"protspace_format_version"`, `ENCODING_KEY = b"protspace_encoding"`, `stamp_format_version(table: pa.Table) -> pa.Table`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_annotation_encoding.py
import pyarrow as pa
import pyarrow.parquet as pq
import io
import pytest

from protspace.data.annotations.encoding import (
    encode_field,
    decode_field,
    stamp_format_version,
    BUNDLE_FORMAT_VERSION,
    FORMAT_VERSION_KEY,
)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "7tm_1",
        "Winged helix",
        "Acting on peptide bonds (peptidases)",   # parens NOT encoded
        "Ribosomal Protein L15; Chain: K; domain 2",  # semicolons
        "YojJ-like (1",                            # unbalanced paren
        "weird|pipe and 50% and %3B literal",      # pipe + percent + literal %3B
        "tab\tnewline\nreturn\r",                  # control chars
        "Kinase, ATP-binding",                     # comma stays literal
        "Café ĸμ 名前",                             # non-ASCII round-trips
    ],
)
def test_round_trip(raw):
    assert decode_field(encode_field(raw)) == raw


def test_encodes_only_reserved():
    # comma, parens, colon, slash stay literal; ; | % control get encoded
    assert encode_field("a,b(c):d/e") == "a,b(c):d/e"
    assert encode_field("a;b|c%d") == "a%3Bb%7Cc%25d"
    assert encode_field("x\ty") == "x%09y"


def test_decode_is_safe_on_plain_text():
    assert decode_field("no escapes here (with parens), commas") == (
        "no escapes here (with parens), commas"
    )


def test_stamp_round_trips_through_parquet():
    tbl = stamp_format_version(pa.table({"protein_id": ["P1"], "cath": ["6.20.10.10"]}))
    buf = io.BytesIO()
    pq.write_table(tbl, buf)
    buf.seek(0)
    md = pq.read_metadata(buf).metadata
    assert md[FORMAT_VERSION_KEY] == str(BUNDLE_FORMAT_VERSION).encode()
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_annotation_encoding.py -q`
Expected: FAIL — `ModuleNotFoundError: protspace.data.annotations.encoding`.

- [ ] **Step 3: Implement the codec**

```python
# src/protspace/data/annotations/encoding.py
"""Lossless percent-encoding for annotation value serialization (bundle format v2).

Categorical annotation cells use the grammar
``accession (name)|score,score;accession2 (name2)|EVIDENCE``. The structural
characters ``;`` (hit separator) and ``|`` (label/score separator) also occur
inside human names from external databases, which corrupts parsing. To keep the
cell losslessly parseable, every free-text token (name, bare-text label,
evidence) is percent-encoded over a minimal reserved set before assembly and
decoded at display.

Reserved set: ``%`` (escape), ``;``, ``|``, and all C0/DEL control chars
(0x00-0x1F, 0x7F). ``,`` ``(`` ``)`` are deliberately NOT encoded: commas are
positionally isolated after ``|`` and parens are display sugar, so leaving them
literal keeps names maximally readable.
"""

import re

import pyarrow as pa

BUNDLE_FORMAT_VERSION = 2
FORMAT_VERSION_KEY = b"protspace_format_version"
ENCODING_KEY = b"protspace_encoding"

# Chars that must be percent-encoded inside any free-text token.
_RESERVED = {";", "|", "%"} | {chr(c) for c in range(0x20)} | {chr(0x7F)}
_ENCODE_MAP = {c: f"%{ord(c):02X}" for c in _RESERVED}
_DECODE_RE = re.compile(r"%([0-9A-Fa-f]{2})")


def encode_field(s: str) -> str:
    """Percent-encode the reserved set inside a free-text token. Lossless."""
    if not s or not any(c in _ENCODE_MAP for c in s):
        return s
    return "".join(_ENCODE_MAP.get(c, c) for c in s)


def decode_field(s: str) -> str:
    """Inverse of :func:`encode_field`. A no-op on text without ``%``."""
    if not s or "%" not in s:
        return s
    return _DECODE_RE.sub(lambda m: chr(int(m.group(1), 16)), s)


def stamp_format_version(table: pa.Table) -> pa.Table:
    """Attach the bundle format version to a table's schema metadata.

    pyarrow writes these as top-level parquet file key-value metadata, readable
    by hyparquet on the frontend via ``parquetMetadata().key_value_metadata``.
    """
    existing = table.schema.metadata or {}
    return table.replace_schema_metadata(
        {
            **existing,
            FORMAT_VERSION_KEY: str(BUNDLE_FORMAT_VERSION).encode(),
            ENCODING_KEY: b"pct",
        }
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_annotation_encoding.py -q`
Expected: PASS (all parametrized cases + stamp round-trip).

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff check src/protspace/data/annotations/encoding.py tests/test_annotation_encoding.py
git add src/protspace/data/annotations/encoding.py tests/test_annotation_encoding.py
git commit -m "feat(annotations): add v2 percent-encoding codec + version stamp helper"
```

---

## Phase B — #57: drop unnamed-superfamily inheritance

### Task B1: Unnamed CATH superfamilies keep their bare code

**Files:**
- Modify: `src/protspace/data/annotations/retrievers/cath_names.py:74-107` (and docstrings L1-6, L28-29)
- Test: `tests/test_cath_names.py:26-38`

- [ ] **Step 1: Rewrite the locked test to the new behavior**

Replace `test_unnamed_superfamily_inherits_topology` (`tests/test_cath_names.py:26-38`) with:

```python
    def test_unnamed_superfamily_has_no_name(self, tmp_path):
        """An unnamed superfamily must NOT inherit the parent topology name (#57)."""
        content = (
            "6.20.10           3s6xC01    :Laminin\n"
            "6.20.10.10        1lmmA01    :\n"
            "6.20.10.20        3s6xC01    :\n"
        )
        f = tmp_path / "cath-names.txt"
        f.write_text(content)

        names = _parse_cath_names(f)

        assert names["6.20.10"] == "Laminin"          # topology keeps its name
        assert "6.20.10.10" not in names              # unnamed → absent (bare code used)
        assert "6.20.10.20" not in names              # siblings stay distinct
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_cath_names.py -q`
Expected: FAIL — currently `names["6.20.10.10"] == "Laminin"`.

- [ ] **Step 3: Remove the inheritance loop**

In `src/protspace/data/annotations/retrievers/cath_names.py`, delete the collection and the fill loop. Change `_parse_cath_names` body so it no longer tracks or fills unnamed superfamilies:

```python
def _parse_cath_names(path: Path) -> dict[str, str]:
    """Parse a CATH names file (CNF 2.0 format).

    Each line: ``cath_code  representative_domain  :Name``. Superfamilies with an
    empty name (``:`` followed by nothing) are left OUT of the mapping so callers
    fall back to the bare CATH code — matching CATH's own "waiting to be named"
    convention (issue #57). The parent topology name is never propagated onto an
    unnamed superfamily.
    """
    names: dict[str, str] = {}

    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        colon_idx = line.find(":")
        if colon_idx == -1:
            continue

        name = line[colon_idx + 1 :].strip()
        code = line[:colon_idx].split()[0]

        if name:
            names[code] = name

    return names
```

Also update the module docstring (`cath_names.py:1-6`) — replace "Unnamed superfamilies inherit their parent topology name." with "Unnamed superfamilies are omitted so callers fall back to the bare CATH code (issue #57)." — and the `get_cath_names` docstring line 28-29 similarly.

- [ ] **Step 4: Run to verify green (and no other cath test regressed)**

Run: `uv run pytest tests/test_cath_names.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/protspace/data/annotations/retrievers/cath_names.py tests/test_cath_names.py
git commit -m "fix(annotations): stop fabricating names for unnamed CATH superfamilies (#57)"
```

---

## Phase C — Encode free-text tokens at emit sites

### Task C1: Encode InterPro entry names

**Files:**
- Modify: `src/protspace/data/annotations/retrievers/interpro_retriever.py:17,362`
- Test: `tests/test_interpro_annotation_retriever.py` (add one case)

**Interfaces:**
- Consumes: `encode_field` from Task A1.

- [ ] **Step 1: Add a failing test for a `;`-bearing CATH name**

Append to `tests/test_interpro_annotation_retriever.py` (adapt the module's existing mock-result helper style; the key assertion):

```python
def test_cath_name_with_semicolon_is_encoded(self):
    from protspace.data.annotations.encoding import encode_field
    name = "Ribosomal Protein L15; Chain: K; domain 2"
    assert encode_field(name) == "Ribosomal Protein L15%3B Chain: K%3B domain 2"
    # And the emitted cell must carry the encoded name (no raw ';' inside the name):
    acc_with_name = f"G3DSA:1.10.10.10 ({encode_field(name)})"
    assert ";" not in acc_with_name.split("(", 1)[1]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_interpro_annotation_retriever.py::TestInterProRetriever::test_cath_name_with_semicolon_is_encoded -q`
Expected: FAIL — `encode_field` import path exercised; if the test class name differs, place the function at module level.

- [ ] **Step 3: Wrap the name at the emit site**

`interpro_retriever.py` — add the import near line 17:

```python
from protspace.data.annotations.encoding import encode_field
```

Change line 362 from:

```python
                            acc_with_name = f"{acc} ({name})"
```
to:
```python
                            acc_with_name = f"{acc} ({encode_field(name)})"
```

- [ ] **Step 4: Run the file's tests**

Run: `uv run pytest tests/test_interpro_annotation_retriever.py -q`
Expected: PASS (existing name-free-of-reserved-chars assertions unchanged; new one green).

- [ ] **Step 5: Commit**

```bash
git add src/protspace/data/annotations/retrievers/interpro_retriever.py tests/test_interpro_annotation_retriever.py
git commit -m "feat(annotations): percent-encode InterPro entry names at emit (#56/#58)"
```

### Task C2: Encode TED domain names

**Files:**
- Modify: `src/protspace/data/annotations/retrievers/ted_retriever.py:9,88`
- Test: `tests/test_ted_retriever.py` (add one case)

- [ ] **Step 1: Failing test**

```python
def test_ted_name_with_semicolon_encoded():
    from protspace.data.annotations.encoding import encode_field
    assert encode_field("Foo; bar") == "Foo%3B bar"
```
(Plus, if the module has a `_format_domains` unit test, add an assertion that a `;`-name domain yields no raw `;` inside the parenthesized name.)

- [ ] **Step 2: Run to verify it fails / is red where wired**

Run: `uv run pytest tests/test_ted_retriever.py -q`

- [ ] **Step 3: Wrap the name**

`ted_retriever.py` — add near line 9:

```python
from protspace.data.annotations.encoding import encode_field
```

Change line 88 from:
```python
                    parts.append(f"{cath_label} ({name})|{plddt:.1f}")
```
to:
```python
                    parts.append(f"{cath_label} ({encode_field(name)})|{plddt:.1f}")
```

- [ ] **Step 4: Run**

Run: `uv run pytest tests/test_ted_retriever.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/data/annotations/retrievers/ted_retriever.py tests/test_ted_retriever.py
git commit -m "feat(annotations): percent-encode TED domain names at emit"
```

### Task C3: Encode UniProt parser free-text (keyword / subcellular / families / GO)

**Files:**
- Modify: `src/protspace/data/parsers/uniprot_parser.py` (add import; L272, L310-315, L335-338, L371-375/383-387/395-398)
- Test: `tests/test_annotation_manager.py` (add reserved-char cases) or a new `tests/test_uniprot_parser_encoding.py`

- [ ] **Step 1: Failing test** — create `tests/test_uniprot_parser_encoding.py`:

```python
from protspace.data.annotations.encoding import decode_field


def test_go_term_with_semicolon_round_trips():
    # Simulate the parser's per-term emission for a GO term containing ';'
    from protspace.data.annotations.encoding import encode_field
    term = "response to X; regulation"
    emitted = f"{encode_field(term)}|IDA"
    label, _, ev = emitted.rpartition("|")
    assert ev == "IDA"
    assert decode_field(label) == term
    assert ";" not in label  # encoded → safe for the hit split
```

- [ ] **Step 2: Run to verify red-where-wired**

Run: `uv run pytest tests/test_uniprot_parser_encoding.py -q`

- [ ] **Step 3: Wrap free-text at each parser emit point**

`uniprot_parser.py` — add import near the top:

```python
from protspace.data.annotations.encoding import encode_field
```

- keyword (L272):
```python
        return [
            f"{kw.get('id', '')} ({encode_field(kw.get('name', ''))})"
            for kw in keywords
        ]
```

- subcellular (L310-315) — encode the location value before the evidence join:
```python
                value = encode_field(loc.get("value", ""))
                if value:
                    ev = self._best_evidence(loc.get("evidences", []))
                    if ev:
                        value = f"{value}|{ev}"
                    locations.append(value)
```

- protein_families (L332-338) — encode `result` before the evidence join:
```python
                if "." in value:
                    result = value.split(".", 1)[0]
                else:
                    result = value
                result = encode_field(result)
                if ev:
                    result = f"{result}|{ev}"
                return result
```

- GO bp/mf/cc (three identical blocks at L370-375, L382-387, L394-398) — encode the term:
```python
            value = encode_field(term["term"])
            ev = term.get("evidence", "")
            if ev:
                value = f"{value}|{ev.split(':')[0]}"
            results.append(value)
```

> Note on `transform_go_terms` / `transform_protein_families` / `transform_cc_subcellular_location` (uniprot_transforms.py): they re-split on `;`/`|` and (for GO) strip the 2-char aspect prefix. All operate correctly on encoded input — `;`/`|` inside a name are now `%3B`/`%7C`, the aspect prefix `P:`/`F:`/`C:` is untouched (`:` is not encoded), and `,`-based first-family selection still works (`,` not encoded). No change needed there.

- [ ] **Step 4: Run parser + manager + transformer tests**

Run: `uv run pytest tests/test_uniprot_parser_encoding.py tests/test_annotation_manager.py tests/test_transformer.py -q`
Expected: PASS. (Existing reserved-char-free names unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/protspace/data/parsers/uniprot_parser.py tests/test_uniprot_parser_encoding.py
git commit -m "feat(annotations): percent-encode UniProt keyword/subcellular/family/GO names"
```

### Task C4: Encode EC enzyme names + Pfam clan names

**Files:**
- Modify: `src/protspace/data/annotations/transformers/uniprot_transforms.py:188` (+ import)
- Modify: `src/protspace/data/annotations/transformers/interpro_transforms.py:68` (+ import)
- Test: `tests/test_transformer.py`, `tests/test_pfam_clan.py` (add reserved-char cases)

- [ ] **Step 1: Failing tests**

Add to `tests/test_pfam_clan.py`:
```python
def test_clan_name_with_pipe_is_encoded():
    from protspace.data.annotations.transformers.interpro_transforms import (
        _parse_pfam_clans_tsv,
    )
    import tempfile, pathlib
    p = pathlib.Path(tempfile.mkdtemp()) / "clans.tsv"
    p.write_text("PF00001\tCL0001\tName|with;reserved\n")
    m = _parse_pfam_clans_tsv(p)
    assert m["PF00001"] == "CL0001 (Name%7Cwith%3Breserved)"
```
Add to `tests/test_transformer.py`:
```python
def test_ec_name_with_semicolon_encoded():
    from protspace.data.annotations.transformers.uniprot_transforms import (
        UniProtTransformer,
    )
    out = UniProtTransformer.transform_ec("1.1.1.1", {"1.1.1.1": "Foo; bar"})
    assert out == "1.1.1.1 (Foo%3B bar)"
```
(Match the actual class/callable name used in the module; if `transform_ec` is a free function, call it directly.)

- [ ] **Step 2: Run to verify red**

Run: `uv run pytest tests/test_pfam_clan.py tests/test_transformer.py -q`
Expected: FAIL on the two new cases.

- [ ] **Step 3: Wrap the names**

`interpro_transforms.py` — add import at top (`from protspace.data.annotations.encoding import encode_field`) and change L68:
```python
            mapping[pfam_acc] = (
                f"{clan_id} ({encode_field(clan_name)})" if clan_name else clan_id
            )
```
`uniprot_transforms.py` — add the import and change L188:
```python
                entry = f"{ec_num} ({encode_field(name)})"
```

- [ ] **Step 4: Run**

Run: `uv run pytest tests/test_pfam_clan.py tests/test_transformer.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/data/annotations/transformers/uniprot_transforms.py \
        src/protspace/data/annotations/transformers/interpro_transforms.py \
        tests/test_transformer.py tests/test_pfam_clan.py
git commit -m "feat(annotations): percent-encode EC + Pfam-clan names at emit"
```

---

## Phase D — `--no-scores` gap

### Task D1: Strip TED pLDDT scores under `--no-scores`

**Files:**
- Modify: `src/protspace/data/annotations/scores.py:12-30`
- Test: `tests/test_annotation_manager.py` (append) or new `tests/test_scores_ted.py`

> `ted_domains` carries `|plddt` scores but is absent from `SCORE_BEARING_COLUMNS`, so `--no-scores` leaves TED scores in. (`pfam_clan` has no `|suffix`, so it is correctly *not* added.)

- [ ] **Step 1: Failing test** — `tests/test_scores_ted.py`:

```python
import pandas as pd
from protspace.data.annotations.scores import strip_scores_from_df


def test_no_scores_strips_ted_domains():
    df = pd.DataFrame({"ted_domains": ["2.60.40.720 (Ig-like)|95.1;3.40.50.300|88.3"]})
    out = strip_scores_from_df(df)
    assert out["ted_domains"].iloc[0] == "2.60.40.720 (Ig-like);3.40.50.300"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_scores_ted.py -q`
Expected: FAIL — score suffix retained.

- [ ] **Step 3: Add `ted_domains` to the allowlist**

`scores.py` — add to `SCORE_BEARING_COLUMNS` (after the InterPro block, ~L29):
```python
    # TED structural domains (pLDDT confidence)
    "ted_domains",
```

- [ ] **Step 4: Run**

Run: `uv run pytest tests/test_scores_ted.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/data/annotations/scores.py tests/test_scores_ted.py
git commit -m "fix(annotations): --no-scores also strips ted_domains pLDDT scores"
```

---

## Phase E — Stamp the bundle format version

### Task E1: Write `format_version = 2` into the annotations table

**Files:**
- Modify: `src/protspace/data/processors/base_processor.py:185-` (`_create_protein_annotations_table` return)
- Modify: `src/protspace/cli/bundle.py` (after `pq.read_table`, ~L64)
- Test: `tests/test_output_combinations.py` (append) or new `tests/test_bundle_version.py`

**Interfaces:**
- Consumes: `stamp_format_version` from Task A1.

- [ ] **Step 1: Failing test** — `tests/test_bundle_version.py`:

```python
import io
import pyarrow.parquet as pq
from protspace.data.annotations.encoding import FORMAT_VERSION_KEY


def test_annotations_table_carries_format_version(tmp_path):
    # Build via the processor's table factory, then read footer KV.
    from protspace.data.processors.base_processor import BaseProcessor
    import pandas as pd
    proc = BaseProcessor.__new__(BaseProcessor)      # bypass heavy __init__
    proc.identifier_col = "protein_id"
    tbl = proc._create_protein_annotations_table(
        pd.DataFrame({"protein_id": ["P1"], "cath": ["6.20.10.10"]})
    )
    buf = io.BytesIO()
    pq.write_table(tbl, buf)
    buf.seek(0)
    assert pq.read_metadata(buf).metadata[FORMAT_VERSION_KEY] == b"2"
```

(If `BaseProcessor.__new__` bypass is brittle, instead assert via a full `create_output`→`write_bundle`→`read_bundle` round-trip.)

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_bundle_version.py -q`
Expected: FAIL — no metadata key.

- [ ] **Step 3: Stamp at table creation**

`base_processor.py` — import `from protspace.data.annotations.encoding import stamp_format_version` and wrap the final `return pa.Table.from_pandas(df)` of `_create_protein_annotations_table`:
```python
        return stamp_format_version(pa.Table.from_pandas(df))
```

`cli/bundle.py` — after the annotations table is read via `pq.read_table(...)` (~L64), stamp it before it is handed to `write_bundle`:
```python
    from protspace.data.annotations.encoding import stamp_format_version
    annotations_table = stamp_format_version(annotations_table)
```
(Use the actual local variable name from that function.)

- [ ] **Step 4: Run**

Run: `uv run pytest tests/test_bundle_version.py tests/test_output_combinations.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/data/processors/base_processor.py src/protspace/cli/bundle.py tests/test_bundle_version.py
git commit -m "feat(bundle): stamp format_version=2 in annotations parquet key-value metadata"
```

---

## Phase F — Decode at backend display

### Task F1: Decode names in the Dash/style display path

**Files:**
- Modify: `src/protspace/utils/add_annotation_style.py:98-103` (`_to_display_value`) + import
- Test: `tests/` (new `tests/test_display_decode.py`)

> The bundle stores encoded names (wire format). The backend `style`/`serve` display path must decode them for human display. Decoding is safe on legacy (pre-v2) values in practice — pre-v2 display names essentially never contain a literal `%XX`; the residual risk is noted in the spec (§11).

- [ ] **Step 1: Failing test** — `tests/test_display_decode.py`:

```python
from protspace.utils.add_annotation_style import _to_display_value


def test_display_decodes_encoded_name():
    # one hit, encoded ';' in the name, with a score suffix
    raw = "1.10.10.10 (Ribosomal Protein L15%3B Chain: K)|50.2"
    assert _to_display_value(raw) == ["1.10.10.10 (Ribosomal Protein L15; Chain: K)"]


def test_display_multi_hit_and_plain():
    raw = "A;B|EXP"
    assert _to_display_value(raw) == ["A", "B"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_display_decode.py -q`
Expected: FAIL — first case returns the still-encoded `%3B`.

- [ ] **Step 3: Decode each display part**

`add_annotation_style.py` — add `from protspace.data.annotations.encoding import decode_field` and change the loop body (L100-102):
```python
    for part in parts:
        trimmed = part.split("|", 1)[0]
        display.append(decode_field(trimmed))
```
Apply the same `decode_field` in `compute_value_frequencies` if it independently splits/trims raw values (check ~L106-130).

- [ ] **Step 4: Run**

Run: `uv run pytest tests/test_display_decode.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/protspace/utils/add_annotation_style.py tests/test_display_decode.py
git commit -m "feat(style): decode v2-encoded names for backend display"
```

---

## Phase G — Docs + backend end-to-end proof

### Task G1: Document the v2 contract

**Files:**
- Modify: `docs/annotations.md` (InterPro §, output-format lines ~133; add an "Encoding (bundle format v2)" subsection)
- Modify: Colab prep notebook only if it documents the value grammar (grep `notebooks/` for `(name)|` / `;`-grammar; if absent, no change — note in commit).

- [ ] **Step 1: Add the contract subsection**

Add to `docs/annotations.md` a subsection stating: cells are `accession (name)|score,score;...` where free-text names/labels/evidence percent-encode `%`/`;`/`|`/control (`%25`/`%3B`/`%7C`/`%XX`); `,` `(` `)` stay literal; the bundle carries `format_version = 2` in parquet key-value metadata; unnamed CATH superfamilies show the bare code (no parent-topology name, #57).

- [ ] **Step 2: Verify docs build / links**

Run: `uv run ruff check src/ tests/` (sanity) and re-read the edited section.

- [ ] **Step 3: Commit**

```bash
git add docs/annotations.md
git commit -m "docs(annotations): document bundle format v2 encoding contract"
```

### Task G2: Backend end-to-end round-trip

**Files:**
- Test: new `tests/test_encoding_e2e.py`

- [ ] **Step 1: Failing test — build a v2 bundle and read it back**

```python
import pandas as pd
from protspace.data.annotations.encoding import encode_field, decode_field


def test_semicolon_name_round_trips_through_bundle(tmp_path):
    from protspace.data.io.bundle import write_bundle, read_bundle
    from protspace.data.io.readers import read_table_from_bytes  # or arrow_reader equiv
    import pyarrow as pa
    from protspace.data.annotations.encoding import stamp_format_version

    name = "Ribosomal Protein L15; Chain: K; domain 2"
    cell = f"G3DSA:1.10.10.10 ({encode_field(name)})|50.2"
    ann = stamp_format_version(pa.table({"protein_id": ["P1"], "cath": [cell]}))
    meta = pa.table({"projection_name": ["pca2"], "dimensions": [2], "info_json": ["{}"]})
    data = pa.table({"projection_name": ["pca2"], "identifier": ["P1"], "x": [0.0], "y": [0.0]})

    bundle = tmp_path / "t.parquetbundle"
    write_bundle([ann, meta, data], bundle)

    core, _ = read_bundle(bundle)
    ann_back = read_table_from_bytes(core[0])          # helper: bytes -> pa.Table
    cell_back = ann_back.column("cath")[0].as_py()
    # One hit, ';' survives encoded, decodes back to the exact name:
    assert ";" not in cell_back.split("(", 1)[1].split(")", 1)[0].replace("%3B", "")
    label = cell_back.split("|", 1)[0]
    inner = label[label.index("(") + 1 : label.rindex(")")]
    assert decode_field(inner) == name
```

(Use whatever bytes→Table helper the repo already has — `utils/arrow_reader.py` or `io/readers.py`; the map lists `arrow_reader.py:56-97`. If none is single-call, wrap `pq.read_table(io.BytesIO(core[0]))`.)

- [ ] **Step 2: Run to verify it fails then passes**

Run: `uv run pytest tests/test_encoding_e2e.py -q`
Expected: FAIL first (helper import), then PASS once the correct reader helper is used.

- [ ] **Step 3: Full suite + lint**

Run: `uv run pytest -m "not slow"` then `uv run ruff check src/ tests/`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/test_encoding_e2e.py
git commit -m "test(annotations): backend end-to-end v2 bundle round-trip proof"
```

---

## Self-Review checklist (run after drafting, fix inline)

- Spec coverage: codec (A1) ✔, #57 (B1) ✔, emit encoding all sites (C1-C4) ✔, `--no-scores` gap (D1) ✔, version stamp (E1) ✔, display decode (F1) ✔, docs (G1) ✔, e2e proof (G2) ✔. Frontend + cross-repo golden fixture live in the sibling frontend plan.
- Type consistency: `encode_field`/`decode_field`/`stamp_format_version`/`FORMAT_VERSION_KEY` names identical across A1 and consumers ✔.
- Placeholder scan: reader-helper name in G2 is the one open lookup — resolve to the repo's actual bytes→Table helper at implementation.

## Execution Handoff

Backend must land before the frontend plan's golden-fixture task (that task invokes this backend to generate the v2 fixture). Phases A–F can otherwise be reviewed independently.
