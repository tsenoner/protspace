#!/usr/bin/env python
"""Generate ProtSpace example datasets from datasets.toml.

Thin wrapper around `protspace prepare` — reads the TOML registry and
runs the CLI for each dataset. Intermediates (FASTA, H5, annotations)
are cached in {output}/tmp/ for resumability.

Usage:
    python scripts/generate_examples/generate.py --all
    python scripts/generate_examples/generate.py --dataset three_finger_toxin
    python scripts/generate_examples/generate.py --dataset globin --dataset phosphatase
"""

import subprocess
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib  # Python < 3.11

SCRIPT_DIR = Path(__file__).parent
TOML_PATH = SCRIPT_DIR / "datasets.toml"
OUTPUT_ROOT = Path("data/examples")


def load_datasets() -> dict:
    with open(TOML_PATH, "rb") as f:
        return tomllib.load(f)


def generate_dataset(name: str, cfg: dict, skip_existing: bool = False) -> bool:
    """Run protspace prepare for a single dataset. Returns True on success."""
    output_dir = OUTPUT_ROOT / name
    bundle_path = output_dir / "data.parquetbundle"

    if skip_existing and bundle_path.exists():
        print(f"[skip] {name}: {bundle_path} already exists")
        return True

    cmd = [
        "protspace",
        "prepare",
        "-q", cfg["query"],
        "-e", cfg["embedder"],
        "-m", cfg["methods"],
        "-a", cfg.get("annotations", "default"),
        "-o", str(output_dir),
        "-v",
    ]

    if cfg.get("similarity", False):
        cmd.append("-s")

    print(f"\n{'='*60}")
    print(f"Generating: {name}")
    print(f"  Query:      {cfg['query']}")
    print(f"  Embedder:   {cfg['embedder']}")
    print(f"  Methods:    {cfg['methods']}")
    print(f"  Similarity: {cfg.get('similarity', False)}")
    print(f"  Output:     {output_dir}")
    print(f"  Command:    {' '.join(cmd)}")
    print(f"{'='*60}\n")

    result = subprocess.run(cmd)

    if result.returncode != 0:
        print(f"\n[FAIL] {name}: exit code {result.returncode}")
        return False

    if bundle_path.exists():
        size_mb = bundle_path.stat().st_size / (1024 * 1024)
        print(f"\n[OK] {name}: {bundle_path} ({size_mb:.1f} MB)")
        return True
    else:
        print(f"\n[FAIL] {name}: {bundle_path} not created")
        return False


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Generate ProtSpace example datasets")
    parser.add_argument(
        "--dataset", action="append", default=None,
        help="Dataset name(s) to generate. Repeat for multiple. Default: all.",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Generate all datasets.",
    )
    parser.add_argument(
        "--skip-existing", action="store_true",
        help="Skip datasets where .parquetbundle already exists.",
    )
    parser.add_argument(
        "--list", action="store_true",
        help="List available datasets and exit.",
    )
    args = parser.parse_args()

    datasets = load_datasets()

    if args.list:
        for name, cfg in datasets.items():
            print(f"  {name:25s} {cfg.get('description', '')}")
        return

    if not args.dataset and not args.all:
        parser.error("Specify --dataset NAME or --all")

    names = list(datasets.keys()) if args.all else args.dataset

    # Validate names
    for name in names:
        if name not in datasets:
            print(f"Unknown dataset: '{name}'. Available: {', '.join(datasets)}")
            sys.exit(1)

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    results = {}
    for name in names:
        results[name] = generate_dataset(
            name, datasets[name], skip_existing=args.skip_existing
        )

    # Summary
    print(f"\n{'='*60}")
    print("Summary:")
    for name, ok in results.items():
        status = "OK" if ok else "FAIL"
        print(f"  [{status}] {name}")

    if not all(results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
