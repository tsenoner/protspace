#!/usr/bin/env python3
"""Stage the ``perf-datasets`` release: the WebGL perf harness's bundles.

Copies every bundle of :data:`PERF_DATASETS` into ``--out`` with a
``SHA256SUMS``, rewrites ``perf/datasets.manifest.json`` (what ``pnpm
perf:fetch`` verifies against and the perf spec serves from; ``--no-manifest``
leaves it alone) and prints the owner's ``gh release`` commands. It publishes
nothing: creating and uploading a release is the repository owner's step.

The bundles are read from their pinned git blobs, so staging works after the
files left the working tree, and the manuscript's 113K β-lactamase bundle from
``--nm-dir`` (default: the parent of showcase.toml's ``[paths] nm_data``),
checked against its sha256::

    uv run python apps/protspace/scripts/generate_examples/stage_perf.py --out /tmp/perf-datasets
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shlex
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]


def showcase():
    """``build_showcase.py`` next to this file (its config, paths and output
    guard). Loaded from the file: the scripts are not a package."""
    module = sys.modules.get("build_showcase")
    if module is None:
        spec = importlib.util.spec_from_file_location(
            "build_showcase", SCRIPT_DIR / "build_showcase.py"
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules["build_showcase"] = module
        spec.loader.exec_module(module)
    return module


PERF_RELEASE = "perf-datasets"
PERF_MANIFEST = REPO_ROOT / "perf" / "datasets.manifest.json"
PUBLIC_DATA = "apps/web/public/data"


@dataclass(frozen=True)
class PerfDataset:
    """One perf-datasets asset: where its bytes come from, and its default-sweep flag."""

    id: str
    #: The path the file is read from: a git blob committed at this path, or,
    #: with ``blob=None``, a file under ``--nm-dir``.
    path: str
    #: In the benchmark's default sweep (the former ``apps/web/public/data/datasets.json``).
    default: bool
    #: Full git blob id. The blob outlives the working-tree file and pins its bytes.
    blob: str | None = None
    #: For a file outside git: the sha256 its bytes must have.
    sha256: str | None = None

    @property
    def file(self) -> str:
        return f"{self.id}.parquetbundle"


# The perf-datasets release (W4/G18). The benchmark's default sweep keeps the
# order of the former datasets.json; the rest run only when named in
# PERF_DATASETS. The eleven former public/data bundles are read from their git
# blobs, so staging works after the files leave the working tree.
PERF_DATASETS: tuple[PerfDataset, ...] = (
    PerfDataset(
        "venom_eat_stats",
        f"{PUBLIC_DATA}/venom_eat_stats.parquetbundle",
        True,
        blob="248577935716fdb678a02ed4f13fa3ca79b8b42c",
    ),
    PerfDataset(
        "5K",
        f"{PUBLIC_DATA}/5K.parquetbundle",
        True,
        blob="f5939dec86b5cacf140728a67543f4cb337aa7e7",
    ),
    PerfDataset(
        "40K",
        f"{PUBLIC_DATA}/40K.parquetbundle",
        True,
        blob="694c555903bd2ccbd4f203f9889811b53b634b12",
    ),
    PerfDataset(
        "7K_toxprot",
        f"{PUBLIC_DATA}/7K_toxprot.parquetbundle",
        True,
        blob="b5db479a7ca7d827fc4f345568c715eb9f249bce",
    ),
    PerfDataset(
        "35K_ec_brenda",
        f"{PUBLIC_DATA}/35K_ec_brenda.parquetbundle",
        True,
        blob="7c5c8818e9dd85a479e0a66b94f484079294b048",
    ),
    PerfDataset(
        "105K_homoSapiens_drosophilaMelanogaster",
        f"{PUBLIC_DATA}/105K_homoSapiens_drosophilaMelanogaster.parquetbundle",
        True,
        blob="2ac5fd185ba0c94af76e865a9905acf3b0e75607",
    ),
    PerfDataset(
        "127K_beta_lactamase",
        f"{PUBLIC_DATA}/127K_beta_lactamase.parquetbundle",
        True,
        blob="ca7e52ac7bd9053a82aa71b98fa83513992034be",
    ),
    PerfDataset(
        "beta_lactamase_ec",
        f"{PUBLIC_DATA}/beta_lactamase_ec.parquetbundle",
        True,
        blob="7b0ca5a560eff29b88a146694e695eb1ae150b34",
    ),
    PerfDataset(
        "beta_lactamase_pn",
        f"{PUBLIC_DATA}/beta_lactamase_pn.parquetbundle",
        True,
        blob="b034774911713af2f21025d90f03c8869ab57949",
    ),
    PerfDataset(
        "phosphatase",
        f"{PUBLIC_DATA}/phosphatase.parquetbundle",
        True,
        blob="8f27860d1f18b2eb4312935e7fef07f3f500f477",
    ),
    PerfDataset(
        "573K_swissprot",
        f"{PUBLIC_DATA}/573K_swissprot.parquetbundle",
        False,
        blob="217cf859982302e59404935fa2907c19799b9d31",
    ),
    # The manuscript's Fig. 3 bundle. Named after its directory, because its own
    # file name is data.parquetbundle. Not in git: read from the manuscript
    # workspace and checked against the checksum the manuscript records.
    PerfDataset(
        "beta_lactamase_2026_stats",
        "data/beta_lactamase_2026_stats/data.parquetbundle",
        False,
        sha256="58c60e6074d6afcdeff400d13e383e07d4d59bd082404c851925352417cef6b0",
    ),
    PerfDataset(
        "phosphatase_eat",
        "apps/web/tests/fixtures/phosphatase_eat.parquetbundle",
        False,
        blob="f13e1c9026aad1e1919138ed8e10c0018ca74e86",
    ),
)


def read_blob(blob: str) -> bytes:
    """A git blob's bytes; the blob outlives the working-tree file it came from."""
    result = subprocess.run(
        ["git", "cat-file", "blob", blob],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"git has no blob {blob}: {result.stderr.decode().strip()}")
    return result.stdout


def read_dataset(dataset: PerfDataset, nm_dir: Path) -> bytes:
    if dataset.blob:
        return read_blob(dataset.blob)
    path = nm_dir / dataset.path
    if not path.exists():
        raise SystemExit(f"{dataset.id}: {path} not found (pass --nm-dir)")
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if dataset.sha256 and actual != dataset.sha256:
        raise SystemExit(
            f"{dataset.id}: {path} has sha256 {actual}, expected {dataset.sha256}"
        )
    return data


def stage_perf(out: Path, nm_dir: Path, write_manifest: bool) -> list[dict]:
    """Stage the perf-datasets assets with SHA256SUMS; rewrite perf/datasets.manifest.json.

    The manifest (``{release, datasets: [{id, file, bytes, sha256, default,
    source}]}``) is what ``pnpm perf:fetch`` verifies against and the perf spec
    serves from.
    """
    out.mkdir(parents=True, exist_ok=True)
    records = []
    sums = []
    for dataset in PERF_DATASETS:
        data = read_dataset(dataset, nm_dir)
        digest = hashlib.sha256(data).hexdigest()
        (out / dataset.file).write_bytes(data)
        sums.append(f"{digest}  {dataset.file}")
        records.append(
            {
                "id": dataset.id,
                "file": dataset.file,
                "bytes": len(data),
                "sha256": digest,
                "default": dataset.default,
                "source": (
                    f"git blob {dataset.blob} ({dataset.path})"
                    if dataset.blob
                    else f"protspace_publication/nm_2026/{dataset.path}"
                ),
            }
        )
        print(f"staged {dataset.file} ({len(data):,} bytes)")
    (out / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    if write_manifest:
        manifest = {"release": PERF_RELEASE, "datasets": records}
        PERF_MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"wrote {PERF_MANIFEST.relative_to(REPO_ROOT)}")
    return records


def publish_commands(release: str, out: Path, title: str, notes: str) -> list[str]:
    repo = showcase().GITHUB_REPO
    assets = " ".join(
        shlex.quote(str(path)) for path in sorted(out.glob("*.parquetbundle"))
    )
    sums = shlex.quote(str(out / "SHA256SUMS"))
    return [
        f"gh release create {release} --repo {repo} --latest=false "
        f"--title {shlex.quote(title)} --notes {shlex.quote(notes)} {assets} {sums}",
        f"# or, to replace assets on an existing release:\n"
        f"gh release upload {release} --repo {repo} --clobber {assets} {sums}",
    ]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0], allow_abbrev=False
    )
    parser.add_argument("--out", type=Path, required=True, help="staging directory")
    parser.add_argument(
        "--nm-dir",
        type=Path,
        help="the manuscript workspace (default: the parent of [paths] nm_data)",
    )
    parser.add_argument(
        "--no-manifest",
        action="store_true",
        help=f"do not rewrite {PERF_MANIFEST.relative_to(REPO_ROOT)}",
    )
    parser.add_argument(
        "--config", type=Path, help="showcase recipes (default: showcase.toml)"
    )
    parser.add_argument(
        "--path",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help="override a [paths] entry",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    bs = showcase()
    try:
        overrides = dict(item.split("=", 1) for item in args.path)
        config = bs.Config.load(args.config or bs.DEFAULT_CONFIG, overrides)
        nm_dir = args.nm_dir or config.path("{nm_data}").parent
        bs.check_output_location(args.out, config, "--out")
        stage_perf(args.out, nm_dir, write_manifest=not args.no_manifest)
    except (bs.BuildError, SystemExit) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print("\nThe repository owner publishes the staged files with:\n")
    for command in publish_commands(
        PERF_RELEASE,
        args.out,
        "Perf datasets",
        "Bundles for the WebGL perf harness (pnpm perf:fetch), byte-identical "
        "to the files the ProtSpace manuscript measured. See perf/README.md.",
    ):
        print(command)
    return 0


if __name__ == "__main__":
    sys.exit(main())
