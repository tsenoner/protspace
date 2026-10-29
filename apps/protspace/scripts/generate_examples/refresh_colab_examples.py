#!/usr/bin/env python
"""Rebuild the Colab notebooks' example bundles as v3, with today's annotations.

The ``examples`` release holds, for each dataset in ``datasets.toml``, the
ProtT5 embeddings (``<name>_prot_t5.h5``) the Preparation notebook's Example
tab runs on, and a ready-made bundle (``<name>.parquetbundle``) the Transfer
notebook and the reuse path of the Example tab read. Those bundles were
mirrored from the pre-monorepo release: legacy v1 files, whose reading ends in
protspace 5.0.0, holding values from an older parser.

For each dataset this keeps the old bundle's projections (the embeddings have
not changed, and beta-lactamase's ESM2 and globin's MMseqs2 projections have no
published input to recompute them from), fetches the annotations of the same
proteins with the installed protspace (the dataset's ``annotations`` set from
``datasets.toml``, through ``protspace annotate``), and writes
``<name>_v3.parquetbundle`` with ``protspace bundle``. A protein UniProt has
deleted since keeps its row, with the values a fresh fetch gives it: its
UniParc ``length`` and nothing else.

Usage (from apps/protspace; the inputs are the release's files):

    gh release download examples --repo tsenoner/protspace -D <in>
    uv run python scripts/generate_examples/refresh_colab_examples.py \\
        --input-dir <in> --output-dir <out> [--dataset snake_toxin ...]
    gh release upload examples <out>/*_v3.parquetbundle --repo tsenoner/protspace
"""

import argparse
import subprocess
import sys
import tomllib
from pathlib import Path

import h5py

from protspace.data.io.bundle import extract_bundle_to_dir, read_bundle_contents

SCRIPT_DIR = Path(__file__).parent
TOML_PATH = SCRIPT_DIR / "datasets.toml"
# The CLI of the interpreter running this script, so the bundles come from the
# protspace checked out here, not whichever is first on PATH.
PROTSPACE = str(Path(sys.executable).with_name("protspace"))


def _run(*args: str) -> None:
    print("$ protspace", " ".join(args), flush=True)
    subprocess.run([PROTSPACE, *args], check=True)


def refresh(name: str, annotations: str, input_dir: Path, output_dir: Path) -> Path:
    """Write ``<name>_v3.parquetbundle`` in *output_dir*; return its path."""
    old_bundle = input_dir / f"{name}.parquetbundle"
    h5 = input_dir / f"{name}_prot_t5.h5"
    work = output_dir / "work" / name
    projections = work / "projections"
    annotation_file = work / "annotations.parquet"
    out = output_dir / f"{name}_v3.parquetbundle"

    with h5py.File(h5) as f:
        proteins = set(f.keys())

    extract_bundle_to_dir(old_bundle, projections)
    _run(
        "annotate",
        "-i",
        str(h5),
        "-a",
        annotations,
        "-o",
        str(annotation_file),
        "--cache-dir",
        str(work / "cache"),
    )
    _run(
        "bundle",
        "-p",
        str(projections),
        "-a",
        str(annotation_file),
        "-o",
        str(out),
    )

    contents = read_bundle_contents(out)
    if contents.container_version is None:
        raise SystemExit(f"{out.name} is not a v3 bundle")
    annotation_table, metadata = contents.annotations, contents.metadata
    bundled = set(annotation_table.column("protein_id").to_pylist())
    if bundled != proteins:
        raise SystemExit(
            f"{out.name}: {len(bundled)} proteins, the embeddings hold "
            f"{len(proteins)}; they must be the same set"
        )
    names = metadata.column("projection_name").to_pylist()
    columns = [c for c in annotation_table.column_names if c != "protein_id"]
    print(
        f"[OK] {out.name}: {len(bundled):,} proteins, "
        f"{len(names)} projections ({', '.join(names)}), "
        f"{len(columns)} annotations ({', '.join(columns)})",
        flush=True,
    )
    return out


def main() -> None:
    with open(TOML_PATH, "rb") as f:
        datasets = tomllib.load(f)
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--dataset",
        action="append",
        choices=sorted(datasets),
        help="Refresh only these (repeatable); default: every dataset.",
    )
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name in args.dataset or list(datasets):
        cfg = datasets[name]
        refresh(
            name, cfg.get("annotations", "default"), args.input_dir, args.output_dir
        )


if __name__ == "__main__":
    main()
