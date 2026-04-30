# Toxprot Demo Bundle Regeneration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the demo `.parquetbundle` from the toxprot UniProt query, with signal peptides stripped before embedding and ESMC-300m added alongside ProtT5; the bundle's `length` column reflects mature (post-cleavage) length, and styling is preserved byte-for-byte from the old web bundle.

**Architecture:** A single standalone Python script (`scripts/generate_toxprot_demo.py`) does the toxprot-specific work — fetches UniProt sequences + signal-peptide positions as TSV, strips SPs, writes a mature FASTA — then shells out to `protspace prepare` for embedding/DR/annotation/bundling. A final post-process step swaps the `length` column to mature lengths and patches in the source settings JSON.

**Tech Stack:** Python ≥3.10, `requests`, `pyarrow`, `h5py`, `pytest`, the existing `protspace.data.io.bundle` helpers, the existing `protspace prepare` CLI.

**Spec:** `docs/superpowers/specs/2026-04-30-toxprot-demo-regeneration-design.md`

---

## File structure

| Path                                                                    | Purpose                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| `scripts/generate_toxprot_demo.py`                                      | Single orchestration script (new)                  |
| `tests/test_toxprot_demo.py`                                            | Three unit tests for the pure-Python helpers (new) |
| `data/toxins/`                                                          | Wiped before first run; repopulated by the script  |
| `docs/superpowers/specs/2026-04-30-toxprot-demo-regeneration-design.md` | Approved design (already committed)                |

The script keeps all helpers in one file. They are small, share data, and there is no other consumer — splitting them into a package is YAGNI.

---

## Task 1: Scaffold script + test file

**Files:**

- Create: `scripts/generate_toxprot_demo.py`
- Create: `tests/test_toxprot_demo.py`

- [ ] **Step 1: Create script with constants and stub `main`**

Imports are kept minimal here — later tasks add `gzip`, `io`, `re`, `requests`, `pyarrow`, etc. as needed.

```python
#!/usr/bin/env python3
"""Regenerate the toxprot demo .parquetbundle.

Fetches UniProt sequences + signal-peptide positions, strips SPs, embeds
the mature peptides with ProtT5 and ESMC-300m, then runs DR + annotation
fetch via `protspace prepare`. Finally overrides the `length` column to
mature length and patches in the existing web-demo settings JSON.

See docs/superpowers/specs/2026-04-30-toxprot-demo-regeneration-design.md
"""

from __future__ import annotations

import logging
import sys

logger = logging.getLogger(__name__)

TOXPROT_QUERY = (
    "(taxonomy_id:33208) AND "
    "(cc_tissue_specificity:venom OR cc_scl_term:SL-0177) AND "
    "(reviewed:true)"
)
UNIPROT_STREAM_URL = "https://rest.uniprot.org/uniprotkb/stream"
EMBEDDERS = "prot_t5,esmc_300m"
METHODS = "umap2:n_neighbors=50;min_dist=0.5,pca2"
ANNOTATIONS = "default,interpro,taxonomy"
RANDOM_STATE = 42


def main() -> int:
    raise NotImplementedError


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Create test file with module loader only**

Per-test imports (`pyarrow`, `pyarrow.parquet`, `io`, `json`) are added in the tasks that use them.

```python
"""Unit tests for scripts/generate_toxprot_demo.py."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# Load the script as a module so tests can import its helpers.
SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "generate_toxprot_demo.py"
spec = importlib.util.spec_from_file_location("generate_toxprot_demo", SCRIPT_PATH)
toxprot_demo = importlib.util.module_from_spec(spec)
sys.modules["generate_toxprot_demo"] = toxprot_demo
spec.loader.exec_module(toxprot_demo)
```

- [ ] **Step 3: Verify both files import without error**

Run: `uv run python -c "import importlib.util, sys; spec = importlib.util.spec_from_file_location('m', 'scripts/generate_toxprot_demo.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print('OK')"`
Expected: `OK`

Run: `uv run pytest tests/test_toxprot_demo.py -v`
Expected: `no tests ran` (empty file is fine)

- [ ] **Step 4: Lint**

Run: `uv run ruff check scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py`
Expected: `All checks passed!`

- [ ] **Step 5: Commit**

```bash
git add scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py
git commit -m "$(cat <<'EOF'
feat(scripts): scaffold generate_toxprot_demo

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `parse_signal_peptides`

**Files:**

- Modify: `scripts/generate_toxprot_demo.py`
- Modify: `tests/test_toxprot_demo.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_toxprot_demo.py`:

```python
def _write_tsv(path: Path, rows: list[dict]) -> Path:
    cols = ["Entry", "Sequence", "Signal peptide"]
    with path.open("w") as f:
        f.write("\t".join(cols) + "\n")
        for row in rows:
            f.write("\t".join(row.get(c, "") for c in cols) + "\n")
    return path


def test_parse_signal_peptides_keeps_only_clean_bounds(tmp_path):
    tsv = _write_tsv(
        tmp_path / "in.tsv",
        [
            {"Entry": "P1", "Sequence": "MMMAAA", "Signal peptide": 'SIGNAL 1..3; /evidence="X"'},
            {"Entry": "P2", "Sequence": "MMMAAA", "Signal peptide": ""},
            {"Entry": "P3", "Sequence": "MMMAAA", "Signal peptide": "SIGNAL ?..30"},
            {"Entry": "P4", "Sequence": "MMMAAA", "Signal peptide": "SIGNAL <1..25"},
            {"Entry": "P5", "Sequence": "MMMAAA", "Signal peptide": "SIGNAL >20..30"},
        ],
    )
    sp_map = toxprot_demo.parse_signal_peptides(tsv)
    assert sp_map == {"P1": 3}


def test_parse_signal_peptides_skips_multiple_features(tmp_path):
    tsv = _write_tsv(
        tmp_path / "in.tsv",
        [
            {
                "Entry": "P1",
                "Sequence": "MMM",
                "Signal peptide": "SIGNAL 1..3; SIGNAL 5..10",
            }
        ],
    )
    assert toxprot_demo.parse_signal_peptides(tsv) == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_toxprot_demo.py -v`
Expected: `AttributeError: module 'generate_toxprot_demo' has no attribute 'parse_signal_peptides'`

- [ ] **Step 3: Implement `parse_signal_peptides`**

Add imports at the top of `scripts/generate_toxprot_demo.py` (after the existing `import sys`):

```python
import re
from pathlib import Path
```

And add this constant alongside the others (after `RANDOM_STATE`):

```python
SIGNAL_RE = re.compile(r"SIGNAL\s+(\d+)\.\.(\d+)")
```

Then append the function above `main`:

```python
def parse_signal_peptides(tsv_path: Path) -> dict[str, int]:
    """Return {accession: sp_end} for entries with a single confidently-bounded SP.

    Skipped (treated as no SP):
      - Empty `ft_signal`.
      - Bounds containing `?`, `<`, or `>` (uncertain).
      - Multiple SP features on a single entry.
    """
    sp_map: dict[str, int] = {}
    skipped_uncertain = 0
    skipped_multiple = 0
    total = 0

    with tsv_path.open() as f:
        header = f.readline().rstrip("\n").split("\t")
        idx_entry = header.index("Entry")
        idx_signal = header.index("Signal peptide")

        for line in f:
            total += 1
            fields = line.rstrip("\n").split("\t")
            entry = fields[idx_entry]
            signal = fields[idx_signal] if idx_signal < len(fields) else ""

            if not signal.strip():
                continue

            matches = SIGNAL_RE.findall(signal)
            if len(matches) > 1:
                skipped_multiple += 1
                continue
            if not matches:
                if any(c in signal for c in ("?", "<", ">")):
                    skipped_uncertain += 1
                continue
            if any(c in signal for c in ("?", "<", ">")):
                skipped_uncertain += 1
                continue

            sp_map[entry] = int(matches[0][1])

    logger.info(
        "Parsed signal peptides: %d total, %d with confirmed SP, "
        "%d skipped (uncertain bounds), %d skipped (multiple features)",
        total,
        len(sp_map),
        skipped_uncertain,
        skipped_multiple,
    )
    return sp_map
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_toxprot_demo.py -v`
Expected: 2 passed.

- [ ] **Step 5: Lint**

Run: `uv run ruff check scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py`
Expected: `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py
git commit -m "$(cat <<'EOF'
feat(toxprot-demo): parse signal peptides from UniProt TSV

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `write_mature_fasta`

**Files:**

- Modify: `scripts/generate_toxprot_demo.py`
- Modify: `tests/test_toxprot_demo.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_toxprot_demo.py`:

```python
def test_write_mature_fasta_strips_correctly(tmp_path):
    tsv = _write_tsv(
        tmp_path / "in.tsv",
        [
            {"Entry": "P1", "Sequence": "AAABBBCCC", "Signal peptide": "SIGNAL 1..3"},
            {"Entry": "P2", "Sequence": "XYZ", "Signal peptide": ""},
        ],
    )
    out = tmp_path / "mature.fasta"
    sp_map = {"P1": 3}
    lengths = toxprot_demo.write_mature_fasta(tsv, sp_map, out)

    assert lengths == {"P1": 6, "P2": 3}
    text = out.read_text()
    assert ">P1\nBBBCCC" in text
    assert ">P2\nXYZ" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_toxprot_demo.py::test_write_mature_fasta_strips_correctly -v`
Expected: `AttributeError: ... write_mature_fasta`

- [ ] **Step 3: Implement `write_mature_fasta`**

Append to `scripts/generate_toxprot_demo.py` (above `main`):

```python
def write_mature_fasta(
    tsv_path: Path,
    sp_map: dict[str, int],
    fasta_out: Path,
) -> dict[str, int]:
    """Write FASTA with SPs cleaved; return {accession: mature_length}."""
    fasta_out.parent.mkdir(parents=True, exist_ok=True)
    lengths: dict[str, int] = {}

    with tsv_path.open() as fin, fasta_out.open("w") as fout:
        header = fin.readline().rstrip("\n").split("\t")
        idx_entry = header.index("Entry")
        idx_seq = header.index("Sequence")

        for line in fin:
            fields = line.rstrip("\n").split("\t")
            if len(fields) <= max(idx_entry, idx_seq):
                continue
            acc = fields[idx_entry]
            seq = fields[idx_seq]
            if not acc or not seq:
                continue

            sp_end = sp_map.get(acc, 0)
            mature = seq[sp_end:]
            lengths[acc] = len(mature)
            fout.write(f">{acc}\n{mature}\n")

    return lengths
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_toxprot_demo.py -v`
Expected: 3 passed.

- [ ] **Step 5: Lint**

Run: `uv run ruff check scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py`
Expected: `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py
git commit -m "$(cat <<'EOF'
feat(toxprot-demo): write mature FASTA with SPs cleaved

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `fetch_toxprot_tsv`

No unit test — this hits the live UniProt API, which is verified by the end-to-end run in Task 7.

**Files:**

- Modify: `scripts/generate_toxprot_demo.py`

- [ ] **Step 1: Implement `fetch_toxprot_tsv`**

Add imports at the top of `scripts/generate_toxprot_demo.py`:

```python
import gzip
import io

import requests
```

Then append the function above `main`:

```python
def fetch_toxprot_tsv(query: str, out_path: Path) -> Path:
    """Stream UniProt TSV (gzip on wire) to `out_path`. Cache hit on existing non-empty file."""
    if out_path.exists() and out_path.stat().st_size > 0:
        logger.info("Reusing cached TSV at %s", out_path)
        return out_path

    out_path.parent.mkdir(parents=True, exist_ok=True)
    params = {
        "query": query,
        "format": "tsv",
        "fields": "accession,sequence,ft_signal",
        "compressed": "true",
    }

    logger.info("Streaming UniProt TSV: %s", query)
    response = requests.get(UNIPROT_STREAM_URL, params=params, stream=True, timeout=300)
    response.raise_for_status()

    raw = io.BytesIO()
    for chunk in response.iter_content(chunk_size=8192):
        if chunk:
            raw.write(chunk)
    raw.seek(0)

    decompressed = gzip.decompress(raw.read()).decode("utf-8")

    if decompressed.count("\n") <= 1:
        raise SystemExit(f"No proteins returned for query: {query!r}")

    out_path.write_text(decompressed)
    logger.info("Wrote %d bytes to %s", out_path.stat().st_size, out_path)
    return out_path
```

- [ ] **Step 2: Lint**

Run: `uv run ruff check scripts/generate_toxprot_demo.py`
Expected: `All checks passed!`

- [ ] **Step 3: Commit**

```bash
git add scripts/generate_toxprot_demo.py
git commit -m "$(cat <<'EOF'
feat(toxprot-demo): stream UniProt TSV with sequence + signal_peptide

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `postprocess_bundle`

**Files:**

- Modify: `scripts/generate_toxprot_demo.py`
- Modify: `tests/test_toxprot_demo.py`

- [ ] **Step 1: Write failing test**

Add these imports at the top of `tests/test_toxprot_demo.py` (after the existing imports):

```python
import io

import pyarrow as pa
import pyarrow.parquet as pq
```

Then append to the file:

```python
def _make_synthetic_bundle(path: Path, settings: dict | None = None) -> Path:
    from protspace.data.io.bundle import write_bundle

    annotations = pa.table(
        {
            "protein_id": ["P1", "P2"],
            "length": [100, 200],
            "ec": ["3.4.21.-", "__NA__"],
        }
    )
    metadata = pa.table(
        {
            "projection_name": ["PCA_2"],
            "dimensions": [2],
            "info_json": ["{}"],
        }
    )
    data = pa.table(
        {
            "projection_name": ["PCA_2", "PCA_2"],
            "identifier": ["P1", "P2"],
            "x": [0.0, 1.0],
            "y": [0.0, 1.0],
        }
    )
    write_bundle([annotations, metadata, data], path, settings=settings)
    return path


def test_postprocess_bundle_replaces_length_and_settings(tmp_path):
    from protspace.data.io.bundle import read_bundle

    target = _make_synthetic_bundle(tmp_path / "target.parquetbundle")
    source_settings = {"pfam": {"sortMode": "manual", "categories": {}}}
    source = _make_synthetic_bundle(
        tmp_path / "source.parquetbundle", settings=source_settings
    )

    toxprot_demo.postprocess_bundle(
        bundle_path=target,
        mature_lengths={"P1": 50, "P2": 150},
        source_settings_bundle=source,
    )

    parts, settings = read_bundle(target)
    annotations = pq.read_table(io.BytesIO(parts[0])).to_pydict()
    assert annotations["protein_id"] == ["P1", "P2"]
    assert annotations["length"] == [50, 150]
    assert settings == source_settings
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_toxprot_demo.py::test_postprocess_bundle_replaces_length_and_settings -v`
Expected: `AttributeError: ... postprocess_bundle`

- [ ] **Step 3: Implement `postprocess_bundle`**

Add these imports at the top of `scripts/generate_toxprot_demo.py`:

```python
import pyarrow as pa
import pyarrow.parquet as pq
```

(`io` was already added in Task 4.) Then append the function above `main`:

```python
def postprocess_bundle(
    bundle_path: Path,
    mature_lengths: dict[str, int],
    source_settings_bundle: Path,
) -> None:
    """Override the `length` column with mature lengths and patch settings JSON."""
    from protspace.data.io.bundle import read_bundle, write_bundle

    if not source_settings_bundle.exists():
        raise SystemExit(
            f"Source settings bundle not found: {source_settings_bundle}"
        )

    parts, _ = read_bundle(bundle_path)
    annotations = pq.read_table(io.BytesIO(parts[0]))
    metadata = pq.read_table(io.BytesIO(parts[1]))
    data = pq.read_table(io.BytesIO(parts[2]))

    ids = annotations.column("protein_id").to_pylist()
    new_lengths = [mature_lengths.get(pid) for pid in ids]
    if any(v is None for v in new_lengths):
        missing = [pid for pid, v in zip(ids, new_lengths, strict=True) if v is None]
        raise SystemExit(
            f"{len(missing)} protein_ids missing from mature_lengths "
            f"(first 5: {missing[:5]})"
        )

    existing_type = annotations.column("length").type
    new_col = pa.array(new_lengths).cast(existing_type)
    new_annotations = annotations.set_column(
        annotations.schema.get_field_index("length"), "length", new_col
    )

    _, source_settings = read_bundle(source_settings_bundle)
    if source_settings is None:
        raise SystemExit(
            f"Source settings bundle has no settings part: {source_settings_bundle}"
        )

    write_bundle(
        [new_annotations, metadata, data], bundle_path, settings=source_settings
    )
    logger.info("Patched bundle %s (length + settings)", bundle_path)
```

- [ ] **Step 4: Run all tests to verify pass**

Run: `uv run pytest tests/test_toxprot_demo.py -v`
Expected: 4 passed.

- [ ] **Step 5: Lint**

Run: `uv run ruff check scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py`
Expected: `All checks passed!`

- [ ] **Step 6: Commit**

```bash
git add scripts/generate_toxprot_demo.py tests/test_toxprot_demo.py
git commit -m "$(cat <<'EOF'
feat(toxprot-demo): post-process bundle with mature length + settings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `main()` orchestration

**Files:**

- Modify: `scripts/generate_toxprot_demo.py`

- [ ] **Step 1: Replace stub `main()` with real implementation**

Add these imports at the top of `scripts/generate_toxprot_demo.py`:

```python
import argparse
import json
import subprocess
```

Then in `scripts/generate_toxprot_demo.py`, replace the `def main()` body with:

```python
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/toxins"),
        help="Output directory for the bundle and tmp/ cache.",
    )
    parser.add_argument(
        "--source-settings",
        type=Path,
        default=Path("../protspace_web/app/public/data.parquetbundle"),
        help="Bundle to copy settings JSON from (the existing web demo).",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Verbose logging."
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    out_dir: Path = args.output
    tmp_dir = out_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    tsv_path = fetch_toxprot_tsv(TOXPROT_QUERY, tmp_dir / "toxprot.tsv")
    sp_map = parse_signal_peptides(tsv_path)
    fasta_path = tmp_dir / "toxprot_mature.fasta"
    mature_lengths = write_mature_fasta(tsv_path, sp_map, fasta_path)
    (tmp_dir / "mature_lengths.json").write_text(json.dumps(mature_lengths))

    cmd = [
        "protspace",
        "prepare",
        "-i", str(fasta_path),
        "-e", EMBEDDERS,
        "-m", METHODS,
        "-a", ANNOTATIONS,
        "--random-state", str(RANDOM_STATE),
        "-o", str(out_dir),
        "-v",
    ]
    logger.info("Running: %s", " ".join(cmd))
    subprocess.run(cmd, check=True)

    bundle_path = out_dir / "data.parquetbundle"
    if not bundle_path.exists():
        raise SystemExit(f"prepare did not produce {bundle_path}")

    postprocess_bundle(
        bundle_path=bundle_path,
        mature_lengths=mature_lengths,
        source_settings_bundle=args.source_settings,
    )
    logger.info("Done: %s", bundle_path)
    return 0
```

- [ ] **Step 2: Smoke-test argparse (no live calls)**

Run: `uv run python scripts/generate_toxprot_demo.py --help`
Expected: Usage line + flag descriptions print; exit code 0.

- [ ] **Step 3: Lint**

Run: `uv run ruff check scripts/generate_toxprot_demo.py`
Expected: `All checks passed!`

- [ ] **Step 4: Commit**

```bash
git add scripts/generate_toxprot_demo.py
git commit -m "$(cat <<'EOF'
feat(toxprot-demo): wire main orchestration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: End-to-end run + verification

This task runs the full pipeline against the live UniProt + Biocentral APIs. No code changes; it produces the actual bundle and verifies it.

**Expected runtime:** ~10–30 minutes depending on Biocentral queue + network. Embeddings dominate.

- [ ] **Step 1: Wipe legacy data**

Run: `rm -rf data/toxins`
Expected: Directory removed.

- [ ] **Step 2: Run end-to-end**

Run: `uv run python scripts/generate_toxprot_demo.py -v`
Expected:

- TSV streamed (~2–5 MB)
- Mature FASTA written to `data/toxins/tmp/toxprot_mature.fasta`
- `protspace prepare` runs: embeddings × 2, then PCA + UMAP × 2, then UniProt + InterPro + taxonomy fetches
- `data/toxins/data.parquetbundle` produced
- Final log: `Done: data/toxins/data.parquetbundle`

If the run dies mid-way, re-running picks up via the `tmp/` cache.

- [ ] **Step 3: Verify the new bundle structurally**

Run: `uv run python scripts/inspect_bundle.py data/toxins/data.parquetbundle`
Expected:

- `selected_annotations`: rows ≈ 7K (current toxprot count), 18 columns including `length` (numeric).
- `projections_metadata`: 4 rows (PCA_2 + UMAP_2 for each of prot_t5, esmc_300m).
- `projections_data`: rows ≈ 4 × 7K, with float `x`, `y` and null `z`.
- `settings`: 5 top-level keys → `['pfam', 'ec', 'superfamily', 'protein_families', 'cath']`.

- [ ] **Step 4: Verify mature length override**

Run:

```bash
uv run python -c "
import io, json
from pathlib import Path
import pyarrow.parquet as pq
from protspace.data.io.bundle import read_bundle

parts, _ = read_bundle(Path('data/toxins/data.parquetbundle'))
annotations = pq.read_table(io.BytesIO(parts[0])).to_pandas()
mature = json.loads(Path('data/toxins/tmp/mature_lengths.json').read_text())
sample = annotations[['protein_id', 'length']].head(5)
print(sample)
print('first row matches mature:', int(sample.iloc[0]['length']) == mature[sample.iloc[0]['protein_id']])
"
```

Expected: Sample shows `length` integers; final line prints `first row matches mature: True`.

- [ ] **Step 5: Final lint + tests**

Run: `uv run ruff check scripts/ tests/`
Expected: `All checks passed!`

Run: `uv run pytest tests/test_toxprot_demo.py -v`
Expected: 4 passed.

- [ ] **Step 6: Stop — do not commit `data/toxins/`**

`data/` is data, not source. The `data/toxins/data.parquetbundle` is the artifact; the user will copy it manually to `protspace_web/app/public/data.parquetbundle`.

If `data/toxins/` is not git-ignored, do NOT add or commit it. Verify with:
Run: `git status`
Expected: working tree clean (no staged or untracked files under `data/toxins/`); if files appear, add them to `.gitignore` in a separate task and discuss with the user first.

---

## Self-review notes

- **Spec coverage:** Each design section maps to a task — fetch (Task 4), parse SP (Task 2), write FASTA (Task 3), postprocess (Task 5), orchestration (Task 6), end-to-end verification (Task 7). The annotations argument matches the spec's corrected value (`default,interpro,taxonomy`).
- **No placeholders:** every step shows actual code, exact commands, and expected output.
- **Type/name consistency:** `parse_signal_peptides`, `write_mature_fasta`, `postprocess_bundle`, `fetch_toxprot_tsv` — same names used in tests, implementations, and `main`. Constants (`TOXPROT_QUERY`, `EMBEDDERS`, `METHODS`, `ANNOTATIONS`, `RANDOM_STATE`, `SIGNAL_RE`, `UNIPROT_STREAM_URL`) defined once in Task 1.
- **DRY/YAGNI:** all helpers in one script (single user, single domain). No CLI changes. No retry/fallback logic.
- **TDD:** Tasks 2, 3, 5 are strict red→green. Task 4 (live HTTP) and Task 6 (subprocess) verified by Task 7 end-to-end run.
