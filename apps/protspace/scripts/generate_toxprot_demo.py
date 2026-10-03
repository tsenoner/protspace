#!/usr/bin/env python3
"""Regenerate the toxprot demo .parquetbundle from scratch.

Fetches UniProt sequences + signal-peptide positions, strips SPs, embeds
the mature peptides with ProtT5 and ESM2-650M, then runs DR + the
sequence-independent annotation sources via `protspace prepare`. The
sequence-based sources (InterPro, Biocentral) run separately through
`protspace annotate` on the FULL-LENGTH sequences: local FASTA sequences
take priority over UniProt's, so feeding them the mature peptides made
InterPro miss by MD5 (73 % empty Pfam) and made TMbed predict no signal
peptide for secreted toxins.

Finally the bundle keeps every annotation column (protein_families first),
replaces `length` with the mature length, and patches the settings JSON:
top-9 categories for pfam/ec/superfamily/cath are recomputed from the new
data; protein_families styling is preserved from the pinned demo fixture.

To refresh the annotations while keeping the published layout, use
`generate_examples/build_showcase.py build --only demo` instead.
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import logging
import re
import shlex
import subprocess
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import requests

from protspace.data.annotations.configuration import INTERNAL_ANNOTATIONS

logger = logging.getLogger(__name__)

TOXPROT_QUERY = (
    "(taxonomy_id:33208) AND "
    "(cc_tissue_specificity:venom OR cc_scl_term:SL-0177) AND "
    "(reviewed:true)"
)
UNIPROT_STREAM_URL = "https://rest.uniprot.org/uniprotkb/stream"
EMBEDDERS = "prot_t5,esm2_650m"
METHODS = "umap2:n_neighbors=50;min_dist=0.5,pca2"
# Sources that key on the accession (safe with the mature-peptide FASTA).
ANNOTATIONS = "uniprot,taxonomy,ted"
# Sources that read the sequence: run on the full-length FASTA instead.
SEQUENCE_ANNOTATIONS = "interpro,biocentral"
RANDOM_STATE = 42
SIGNAL_RE = re.compile(r"SIGNAL\s+(\d+)\.\.(\d+)")
# The curated legend styling comes from the demo as first published, pinned as a
# test fixture. The product demo at apps/web/public/data.parquetbundle is this
# script's output, so reading it would copy whatever the last run wrote.
DEFAULT_SOURCE_SETTINGS = (
    Path(__file__).resolve().parent.parent.parent
    / "web"
    / "tests"
    / "fixtures"
    / "demo_toxprot_7831.parquetbundle"
)

# Columns shown first, in this order; every other annotation column follows.
LEADING_ANNOTATION_COLUMNS: tuple[str, ...] = ("protein_id", "protein_families")
# Internal lookup columns and legacy length bins never reach the bundle.
DROPPED_ANNOTATION_COLUMNS: tuple[str, ...] = (
    *INTERNAL_ANNOTATIONS,
    "length_fixed",
    "length_quantile",
)

# Annotations whose top-9 categories are recomputed from the new data and
# styled with the Kelly's palette. `protein_families` is intentionally
# excluded — its hand-curated settings are preserved as-is.
RESTYLED_ANNOTATIONS: tuple[str, ...] = ("pfam", "ec", "superfamily", "cath")

# First nine Kelly's high-contrast colors (zOrder 0–8). zOrder 9 is __NA__.
KELLYS_PALETTE: tuple[str, ...] = (
    "#F3C300",
    "#875692",
    "#F38400",
    "#A1CAF1",
    "#BE0032",
    "#C2B280",
    "#008856",
    "#E68FAC",
    "#0067A5",
)
NA_COLOR = "#DDDDDD"


def parse_signal_peptides(tsv_path: Path) -> dict[str, int]:
    """Return {accession: sp_end} for entries with a single confidently-bounded SP.

    Skipped (treated as no SP):
      - Empty `ft_signal`.
      - Bounds containing `?`, `<`, or `>` (uncertain). Free-text notes within
        the field do not count — only the SIGNAL bounds do.
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
            if not entry:
                continue
            signal = fields[idx_signal] if idx_signal < len(fields) else ""

            if not signal.strip():
                continue

            matches = SIGNAL_RE.findall(signal)
            if len(matches) > 1:
                skipped_multiple += 1
                continue
            if not matches:
                # SP feature present but bounds aren't digit..digit → uncertain.
                if "SIGNAL" in signal:
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


def write_mature_fasta(
    tsv_path: Path,
    sp_map: dict[str, int],
    fasta_out: Path,
) -> dict[str, int]:
    """Write FASTA with SPs cleaved; return {accession: mature_length}.

    An empty ``sp_map`` cuts nothing: the full-length sequences.
    """
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


def fetch_toxprot_tsv(query: str, out_path: Path) -> Path:
    """Stream UniProt TSV (gzip on wire) to `out_path`. Cache hit on existing non-empty file.

    The cache key is `out_path` only — if the query changes, the caller must
    use a different path or delete the existing file to force a re-fetch.
    """
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

    if len(decompressed.splitlines()) <= 1:
        raise SystemExit(f"No proteins returned for query: {query!r}")

    out_path.write_text(decompressed, encoding="utf-8")
    logger.info("Wrote %d bytes to %s", out_path.stat().st_size, out_path)
    return out_path


def _merge_full_length_columns(
    annotations: pa.Table, full_length: pa.Table | None
) -> pa.Table:
    """Replace or add the sequence-based columns computed on full-length input.

    Joined by protein id (``annotate`` names it ``identifier``); the always-
    included name columns ``annotate`` adds are ignored, the bundle has them.
    """
    if full_length is None:
        return annotations
    id_col = "identifier" if "identifier" in full_length.column_names else "protein_id"
    rows = {pid: i for i, pid in enumerate(full_length.column(id_col).to_pylist())}
    ids = annotations.column("protein_id").to_pylist()
    take = pa.array([rows.get(pid) for pid in ids], type=pa.int64())
    skip = {id_col, "gene_name", "protein_name", "uniprot_kb_id"}
    skip |= set(DROPPED_ANNOTATION_COLUMNS)
    for name in full_length.column_names:
        if name in skip:
            continue
        column = full_length.column(name).take(take)
        if name in annotations.column_names:
            index = annotations.column_names.index(name)
            annotations = annotations.set_column(index, name, column)
        else:
            annotations = annotations.append_column(name, column)
    return annotations


def _drop_and_reorder_columns(annotations: pa.Table) -> pa.Table:
    """Keep every annotation column: ``LEADING_ANNOTATION_COLUMNS`` first, the
    rest in their existing order, minus ``DROPPED_ANNOTATION_COLUMNS``.
    """
    names = annotations.column_names
    lead = [c for c in LEADING_ANNOTATION_COLUMNS if c in names]
    rest = [c for c in names if c not in lead and c not in DROPPED_ANNOTATION_COLUMNS]
    return annotations.select(lead + rest)


def _extract_categories(cell: str | None) -> list[str]:
    """Split a multi-value annotation cell into clean category labels.

    Cells use ``;`` as a hard separator and ``|`` to attach a confidence
    score / evidence code to the value before it. The label is the part
    before the first ``|``.
    """
    if not cell:
        return []
    out: list[str] = []
    for piece in cell.split(";"):
        head = piece.split("|", 1)[0].strip()
        if head and head != "__NA__":
            out.append(head)
    return out


def _build_top_categories_styling(
    column: pa.ChunkedArray,
    *,
    template: dict,
) -> dict:
    """Recompute the manual top-9 + ``__NA__`` styling for an annotation.

    Returns a settings dict using the same metadata as ``template``
    (sortMode, palette, etc.) but with a fresh ``categories`` block built
    from the most common cleaned tokens in ``column``.
    """
    from collections import Counter

    counts: Counter[str] = Counter()
    n_na = 0
    for cell in column.to_pylist():
        cats = _extract_categories(cell)
        if not cats:
            n_na += 1
            continue
        counts.update(cats)

    new_categories: dict[str, dict] = {}
    for z, (label, _) in enumerate(counts.most_common(len(KELLYS_PALETTE))):
        new_categories[label] = {
            "zOrder": z,
            "color": KELLYS_PALETTE[z],
            "shape": "circle",
        }
    if n_na > 0:
        new_categories["__NA__"] = {
            "zOrder": len(KELLYS_PALETTE),
            "color": NA_COLOR,
            "shape": "circle",
        }

    out = dict(template)
    out["categories"] = new_categories
    return out


def _restyle_settings(annotations: pa.Table, source_settings: dict) -> dict:
    """Return a copy of ``source_settings`` with top-9 categories
    recomputed for ``RESTYLED_ANNOTATIONS`` (others passed through).
    """
    new_settings = dict(source_settings)
    for col in RESTYLED_ANNOTATIONS:
        if col not in annotations.column_names or col not in source_settings:
            continue
        new_settings[col] = _build_top_categories_styling(
            annotations.column(col), template=source_settings[col]
        )
    return new_settings


def postprocess_bundle(
    bundle_path: Path,
    mature_lengths: dict[str, int],
    source_settings_bundle: Path,
    full_length_annotations: pa.Table | None = None,
) -> None:
    """Patch the bundle: full-length sequence-based columns, mature lengths,
    column order, restyled top-9 categories, and the original
    ``protein_families`` settings.
    """
    from protspace.data.annotations.encoding import stamp_format_version
    from protspace.data.io.bundle import (
        read_settings_from_bundle,
        read_tables,
        write_bundle,
    )

    if not source_settings_bundle.exists():
        raise SystemExit(f"Source settings bundle not found: {source_settings_bundle}")

    annotations, metadata, data = read_tables(bundle_path)

    # Map by protein_id (not positional) — bundle row order is not guaranteed
    # to match FASTA order after EmbeddingSet merging and dedup in the prepare
    # pipeline.
    ids = annotations.column("protein_id").to_pylist()
    new_lengths = [mature_lengths.get(pid) for pid in ids]
    if any(v is None for v in new_lengths):
        missing = [pid for pid, v in zip(ids, new_lengths, strict=True) if v is None]
        raise SystemExit(
            f"{len(missing)} protein_ids in {bundle_path.name} not present in "
            f"mature_lengths ({len(mature_lengths)} keys). First 5: {missing[:5]}"
        )

    existing_type = annotations.column("length").type
    new_col = pa.array(new_lengths).cast(existing_type)
    annotations = annotations.set_column(
        annotations.schema.get_field_index("length"), "length", new_col
    )

    annotations = _merge_full_length_columns(annotations, full_length_annotations)
    annotations = stamp_format_version(_drop_and_reorder_columns(annotations))

    source_settings = read_settings_from_bundle(source_settings_bundle)
    if source_settings is None:
        raise SystemExit(
            f"Source settings bundle has no settings part: {source_settings_bundle}"
        )

    new_settings = _restyle_settings(annotations, source_settings)

    write_bundle([annotations, metadata, data], bundle_path, settings=new_settings)
    logger.info("Patched bundle %s (length, columns, restyled settings)", bundle_path)


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
        default=DEFAULT_SOURCE_SETTINGS,
        help=(
            "Bundle to copy settings JSON from (the pinned demo fixture). "
            f"Default: {DEFAULT_SOURCE_SETTINGS}"
        ),
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Verbose logging. Repeat for more (-v=INFO, -vv=DEBUG).",
    )
    args = parser.parse_args()

    from protspace.cli.app import setup_logging

    # Default to INFO so progress logs are visible during the long live run.
    # setup_logging maps 1 → INFO, 2+ → DEBUG.
    setup_logging(args.verbose + 1)

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
        "-i",
        str(fasta_path),
        "-e",
        EMBEDDERS,
        "-m",
        METHODS,
        "-a",
        ANNOTATIONS,
        "--random-state",
        str(RANDOM_STATE),
        "-o",
        str(out_dir),
        "-v",
    ]
    logger.info("Running: %s", shlex.join(cmd))
    subprocess.run(cmd, check=True)

    bundle_path = out_dir / "data.parquetbundle"
    if not bundle_path.exists():
        raise SystemExit(f"prepare did not produce {bundle_path}")

    # InterPro and Biocentral on the full-length sequences (see the docstring).
    full_fasta = tmp_dir / "toxprot_full_length.fasta"
    write_mature_fasta(tsv_path, {}, full_fasta)  # no signal peptide cut
    full_parquet = tmp_dir / "full_length_annotations.parquet"
    annotate = [
        "protspace",
        "annotate",
        "-i",
        str(full_fasta),
        "-a",
        SEQUENCE_ANNOTATIONS,
        "-o",
        str(full_parquet),
        "-v",
    ]
    logger.info("Running: %s", shlex.join(annotate))
    subprocess.run(annotate, check=True)

    postprocess_bundle(
        bundle_path=bundle_path,
        mature_lengths=mature_lengths,
        source_settings_bundle=args.source_settings,
        full_length_annotations=pq.read_table(full_parquet),
    )
    logger.info("Done: %s", bundle_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
