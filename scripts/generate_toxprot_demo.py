#!/usr/bin/env python3
"""Regenerate the toxprot demo .parquetbundle.

Fetches UniProt sequences + signal-peptide positions, strips SPs, embeds
the mature peptides with ProtT5 and ESMC-300m, then runs DR + annotation
fetch via `protspace prepare`. Finally overrides the `length` column to
mature length and patches in the existing web-demo settings JSON.

See docs/superpowers/specs/2026-04-30-toxprot-demo-regeneration-design.md
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
SIGNAL_RE = re.compile(r"SIGNAL\s+(\d+)\.\.(\d+)")
DEFAULT_SOURCE_SETTINGS = (
    Path(__file__).resolve().parent.parent.parent
    / "protspace_web"
    / "app"
    / "public"
    / "data.parquetbundle"
)


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


def postprocess_bundle(
    bundle_path: Path,
    mature_lengths: dict[str, int],
    source_settings_bundle: Path,
) -> None:
    """Override the `length` column with mature lengths and patch settings JSON."""
    from protspace.data.io.bundle import read_bundle, write_bundle

    if not source_settings_bundle.exists():
        raise SystemExit(f"Source settings bundle not found: {source_settings_bundle}")

    parts, _ = read_bundle(bundle_path)
    annotations = pq.read_table(io.BytesIO(parts[0]))
    metadata = pq.read_table(io.BytesIO(parts[1]))
    data = pq.read_table(io.BytesIO(parts[2]))

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
            "Bundle to copy settings JSON from (the existing web demo). "
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

    postprocess_bundle(
        bundle_path=bundle_path,
        mature_lengths=mature_lengths,
        source_settings_bundle=args.source_settings,
    )
    logger.info("Done: %s", bundle_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
