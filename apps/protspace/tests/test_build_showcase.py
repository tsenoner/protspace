"""Unit tests for scripts/generate_examples/build_showcase.py."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = (
    Path(__file__).parent.parent / "scripts" / "generate_examples" / "build_showcase.py"
)
spec = importlib.util.spec_from_file_location("build_showcase", SCRIPT_PATH)
build_showcase = importlib.util.module_from_spec(spec)
sys.modules["build_showcase"] = build_showcase
spec.loader.exec_module(build_showcase)

# The former apps/web/public/data/datasets.json: the benchmark's default sweep.
FORMER_DEFAULT_SWEEP = [
    "venom_eat_stats",
    "5K",
    "40K",
    "7K_toxprot",
    "35K_ec_brenda",
    "105K_homoSapiens_drosophilaMelanogaster",
    "127K_beta_lactamase",
    "beta_lactamase_ec",
    "beta_lactamase_pn",
    "phosphatase",
]


def test_perf_datasets_keep_their_original_ids_and_default_sweep():
    datasets = build_showcase.PERF_DATASETS
    ids = [d.id for d in datasets]
    assert len(set(ids)) == len(ids)
    assert [d.id for d in datasets if d.default] == FORMER_DEFAULT_SWEEP
    # The eleven former public/data bundles plus the 113K and the 832.
    assert len(datasets) == 13
    assert {"573K_swissprot", "beta_lactamase_2026_stats", "phosphatase_eat"} <= set(
        ids
    )
    for dataset in datasets:
        assert dataset.file == f"{dataset.id}.parquetbundle"
        # Every source is pinned: a git blob id, or a checksum for a file outside git.
        assert (dataset.blob is None) != (dataset.sha256 is None)


def test_stage_perf_writes_files_checksums_and_the_manifest(tmp_path, monkeypatch):
    manifest_path = tmp_path / "datasets.manifest.json"
    monkeypatch.setattr(build_showcase, "PERF_MANIFEST", manifest_path)
    monkeypatch.setattr(build_showcase, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        build_showcase, "read_dataset", lambda dataset, _nm: dataset.id.encode()
    )
    out = tmp_path / "staged"

    records = build_showcase.stage_perf(out, tmp_path, write_manifest=True)

    first = build_showcase.PERF_DATASETS[0]
    digest = hashlib.sha256(first.id.encode()).hexdigest()
    assert (out / first.file).read_bytes() == first.id.encode()
    assert f"{digest}  {first.file}" in (out / "SHA256SUMS").read_text().splitlines()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["release"] == "perf-datasets"
    assert manifest["datasets"] == records
    assert records[0] == {
        "id": first.id,
        "file": first.file,
        "bytes": len(first.id),
        "sha256": digest,
        "default": True,
        "source": f"git blob {first.blob} ({first.path})",
    }


def test_a_workspace_file_with_the_wrong_checksum_is_refused(tmp_path):
    dataset = build_showcase.PerfDataset(
        "x", "data/x/data.parquetbundle", False, sha256="0" * 64
    )
    path = tmp_path / dataset.path
    path.parent.mkdir(parents=True)
    path.write_bytes(b"not the manuscript's bytes")

    with pytest.raises(SystemExit, match="expected"):
        build_showcase.read_dataset(dataset, tmp_path)


def test_publish_commands_name_the_release_and_every_asset(tmp_path):
    (tmp_path / "a.parquetbundle").write_bytes(b"a")
    (tmp_path / "SHA256SUMS").write_text("")

    create, upload = build_showcase.publish_commands(
        "perf-datasets", tmp_path, "T", "N"
    )

    assert create.startswith(
        "gh release create perf-datasets --repo tsenoner/protspace"
    )
    assert str(tmp_path / "a.parquetbundle") in create
    assert str(tmp_path / "SHA256SUMS") in create
    assert "--clobber" in upload
