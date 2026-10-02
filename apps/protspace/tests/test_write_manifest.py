"""Unit tests for scripts/generate_examples/write_manifest.py."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

SCRIPT_PATH = (
    Path(__file__).parent.parent / "scripts" / "generate_examples" / "write_manifest.py"
)
spec = importlib.util.spec_from_file_location("write_manifest", SCRIPT_PATH)
write_manifest = importlib.util.module_from_spec(spec)
sys.modules["write_manifest"] = write_manifest
spec.loader.exec_module(write_manifest)

DELIMITER = b"---PARQUET_DELIMITER---"


def _parquet(table: pa.Table) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


def _write_bundle(
    path: Path,
    *,
    ids: list[str],
    annotations: dict[str, list],
    projections: list[str],
    metadata: dict[str, str] | None = None,
    extra_parts: int = 0,
) -> Path:
    table = pa.table({"identifier": ids, **annotations})
    if metadata:
        table = table.replace_schema_metadata(metadata)
    meta = pa.table(
        {"projection_name": projections, "dimensions": [2] * len(projections)}
    )
    data = pa.table(
        {
            "projection_name": [p for p in projections for _ in ids],
            "identifier": ids * len(projections),
            "x": [0.0] * (len(ids) * len(projections)),
            "y": [0.0] * (len(ids) * len(projections)),
        }
    )
    parts = [_parquet(table), _parquet(meta), _parquet(data)] + [b""] * extra_parts
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(DELIMITER.join(parts))
    return path


def test_record_reads_everything_from_the_file(tmp_path):
    bundle = _write_bundle(
        tmp_path / "public" / "data.parquetbundle",
        ids=["P1", "P2", "P2"],
        annotations={"family": ["a", "b", "b"], "ec": ["1", None, None]},
        projections=["ProtT5 — UMAP 2", "ProtT5 — PCA 2"],
    )

    record = write_manifest.read_bundle_record(
        bundle, example_id="demo", file="data.parquetbundle", hosting="repo"
    )

    raw = bundle.read_bytes()
    assert record["bytes"] == len(raw)
    assert record["sha256"] == hashlib.sha256(raw).hexdigest()
    # Unique protein ids, as the web reader counts them.
    assert record["proteins"] == 2
    assert record["columns"] == ["family", "ec"]
    assert record["projections"] == ["ProtT5 — UMAP 2", "ProtT5 — PCA 2"]
    assert record["hosting"] == "repo"
    assert record["statistics"] is False
    assert record["releases"] == {"membership": None, "annotations": {}}
    assert record["protspaceVersion"] is None


def test_record_notes_a_statistics_part_only_when_it_has_content(tmp_path):
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle",
        ids=["P1"],
        annotations={"domain": ["Bacteria"]},
        projections=["UMAP_2"],
    )
    stats = _parquet(pa.table({"annotation": ["domain"], "value": [0.5]}))
    # Statistics but no settings: an empty settings slot keeps them fifth.
    bundle.write_bytes(DELIMITER.join([bundle.read_bytes(), b"", stats]))
    with_stats = write_manifest.read_bundle_record(
        bundle, example_id="x", file="b", hosting="repo"
    )

    empty = _write_bundle(
        tmp_path / "c.parquetbundle",
        ids=["P1"],
        annotations={"domain": ["Bacteria"]},
        projections=["UMAP_2"],
        extra_parts=2,
    )
    without_stats = write_manifest.read_bundle_record(
        empty, example_id="x", file="c", hosting="repo"
    )

    assert with_stats["statistics"] is True
    assert without_stats["statistics"] is False


# ---------------------------------------------------------------------------
# Container v3 (the format every bundle is written in since protspace 4.16)
# ---------------------------------------------------------------------------


def test_the_container_keys_are_protspaces():
    """write_manifest.py runs without protspace (CI: --no-project --with
    pyarrow), so it names the keys itself; they must be the writer's."""
    from protspace.data.io import bundle, bundle_v3

    assert write_manifest.DELIMITER == bundle.PARQUET_BUNDLE_DELIMITER
    assert write_manifest.CONTAINER_VERSION_KEY == bundle_v3.CONTAINER_VERSION_KEY
    assert write_manifest.V3_MANIFEST_KEY == bundle_v3.MANIFEST_KEY
    assert write_manifest.CONTAINER_VERSION == bundle_v3.CONTAINER_VERSION


def _v3_pair(tmp_path, *, statistics=True, metadata=None):
    """A legacy bundle and protspace's v3 conversion of it."""
    from protspace.data.io.bundle import convert_bundle

    legacy = _write_bundle(
        tmp_path / "legacy.parquetbundle",
        ids=["P1", "P2", "P3"],
        annotations={
            "family": ["a", "b", "a"],
            # Multi-valued: v3 stores it as a hit count plus payloads.
            "pfam": ["PF1 (x)|9.5;PF2 (y)|3.0", "PF1 (x)|8.0", ""],
            "length": ["120", "88", "301"],
        },
        projections=["ProtT5 — UMAP 2", "ProtT5 — PCA 2"],
        metadata={"protspace_format_version": "2", **(metadata or {})},
    )
    if statistics:
        stats = _parquet(pa.table({"annotation": ["family"], "value": [0.5]}))
        legacy.write_bytes(DELIMITER.join([legacy.read_bytes(), b"", stats]))
    converted = tmp_path / "converted.parquetbundle"
    convert_bundle(legacy, converted)
    return legacy, converted


def test_a_v3_record_is_the_legacy_files_record_but_for_the_bytes(tmp_path):
    legacy, converted = _v3_pair(
        tmp_path, metadata={"example_id": "x", "protspace_version": "4.15.0"}
    )
    assert len(converted.read_bytes().split(DELIMITER)) == 6

    old, new = (
        write_manifest.read_bundle_record(p, example_id="x", file="f", hosting="repo")
        for p in (legacy, converted)
    )

    raw = converted.read_bytes()
    assert new["bytes"] == len(raw)
    assert new["sha256"] == hashlib.sha256(raw).hexdigest()
    assert new["sha256"] != old["sha256"]
    for key in ("bytes", "sha256"):
        old.pop(key), new.pop(key)
    assert new == old
    # No physical v3 column (pfam__count) is an annotation.
    assert new["columns"] == ["family", "pfam", "length"]
    assert new["projections"] == ["ProtT5 — UMAP 2", "ProtT5 — PCA 2"]
    assert new["proteins"] == 3 and new["statistics"] is True
    assert new["protspaceVersion"] == "4.15.0"


def test_a_v3_record_matches_what_protspace_decodes(tmp_path):
    from protspace.data.io.bundle import read_tables

    _, converted = _v3_pair(tmp_path, statistics=False)
    record = write_manifest.read_bundle_record(
        converted, example_id="x", file="f", hosting="repo"
    )
    annotations, metadata, _ = read_tables(converted)

    assert record["columns"] == annotations.column_names[1:]
    assert record["projections"] == metadata.column("projection_name").to_pylist()
    assert record["proteins"] == annotations.num_rows
    # A v3 file always writes the settings and statistics slots, empty here.
    assert record["statistics"] is False


def test_the_part_count_and_the_container_key_must_agree(tmp_path):
    legacy, converted = _v3_pair(tmp_path, statistics=False)
    v3_parts = converted.read_bytes().split(DELIMITER)
    with pytest.raises(ValueError, match="5-part bundle declares container version"):
        write_manifest.split_bundle(DELIMITER.join(v3_parts[:5]))
    legacy_parts = legacy.read_bytes().split(DELIMITER)
    with pytest.raises(ValueError, match="must declare container version 3"):
        write_manifest.split_bundle(DELIMITER.join(legacy_parts + [b""] * 3))
    with pytest.raises(ValueError, match="3 to 6 bundle parts"):
        write_manifest.split_bundle(DELIMITER.join(v3_parts + [b""]))


def test_record_takes_the_first_column_as_ids_when_none_is_named(tmp_path):
    path = tmp_path / "b.parquetbundle"
    table = pa.table({"accession": ["P1"], "family": ["a"]})
    meta = pa.table({"projection_name": ["PCA_2"]})
    path.write_bytes(DELIMITER.join([_parquet(table), _parquet(meta), _parquet(meta)]))

    record = write_manifest.read_bundle_record(
        path, example_id="x", file="b", hosting="repo"
    )

    assert record["columns"] == ["family"]


def test_record_reads_provenance_metadata(tmp_path):
    bundle = _write_bundle(
        tmp_path / "swissprot_2026_03.parquetbundle",
        ids=["P1"],
        annotations={"domain": ["Bacteria"]},
        projections=["ProtT5 — UMAP 2"],
        metadata={
            "example_id": "swissprot",
            "protspace_version": "4.14.0",
            "git_sha": "abc123",
            "membership_release": "2025_04",
            # The flat {group: release} form of bundles built before the
            # showcase build's group objects.
            "uniprot_release": json.dumps({"uniprot": "2026_03", "ted": "2026_03"}),
            "built_at": "2026-10-01T12:00:00Z",
            "command": "protspace annotate ...",
            "zenodo_doi": "10.5281/zenodo.1",
        },
        extra_parts=2,
    )

    record = write_manifest.read_bundle_record(
        bundle, example_id="swissprot", file=bundle.name, hosting="release"
    )

    assert record["releases"] == {
        "membership": "2025_04",
        "annotations": {"uniprot": "2026_03", "ted": "2026_03"},
    }
    assert record["protspaceVersion"] == "4.14.0"
    assert record["gitSha"] == "abc123"
    assert record["builtAt"] == "2026-10-01T12:00:00Z"
    assert record["command"] == "protspace annotate ..."
    assert record["zenodoDoi"] == "10.5281/zenodo.1"


@pytest.mark.parametrize(
    ("command", "shown"),
    [
        (
            "build_showcase.py build --only demo --cli-root "
            "/private/tmp/claude-501/x/scratchpad/wt/cli-build",
            "build_showcase.py build --only demo --cli-root $CLI",
        ),
        (
            "build_showcase.py build --only demo --cli-root=/tmp/cli "
            "--out-root '/Users/someone/out dir'",
            "build_showcase.py build --only demo --cli-root=$CLI --out-root $OUT",
        ),
        (
            "build_showcase.py build --only demo --cli-root $CLI",
            "build_showcase.py build --only demo --cli-root $CLI",
        ),
        (
            "protspace embed -i /private/var/folders/ab/x.fasta -o /Users/me/out",
            "protspace embed -i $TMP -o ~/out",
        ),
    ],
)
def test_the_command_never_shows_a_machine_path(command, shown):
    assert write_manifest.redact_command(command) == shown


def test_a_stamped_scratch_path_is_redacted_in_the_record(tmp_path):
    bundle = _write_bundle(
        tmp_path / "demo.parquetbundle",
        ids=["P1"],
        annotations={"domain": ["Bacteria"]},
        projections=["ProtT5 — UMAP 2"],
        metadata={
            "example_id": "demo",
            "command": "build_showcase.py build --only demo --cli-root /private/tmp/c",
        },
    )
    record = write_manifest.read_bundle_record(
        bundle, example_id="demo", file=bundle.name, hosting="release"
    )
    assert record["command"] == "build_showcase.py build --only demo --cli-root $CLI"


def test_a_single_release_string_applies_to_every_column(tmp_path):
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle",
        ids=["P1"],
        annotations={"domain": ["Bacteria"]},
        projections=["UMAP_2"],
        metadata={"uniprot_release": "2026_03"},
    )
    record = write_manifest.read_bundle_record(
        bundle, example_id="x", file="b", hosting="repo"
    )
    assert record["releases"]["annotations"] == {"all": "2026_03"}


def test_a_bundle_stamped_for_another_example_is_refused(tmp_path):
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle",
        ids=["P1"],
        annotations={"domain": ["Bacteria"]},
        projections=["UMAP_2"],
        metadata={"example_id": "human-fly"},
    )
    with pytest.raises(ValueError, match="human-fly"):
        write_manifest.read_bundle_record(
            bundle, example_id="swissprot", file="b", hosting="release"
        )


def test_render_parse_round_trip(tmp_path):
    public = tmp_path / "public"
    demo = _write_bundle(
        public / "data.parquetbundle",
        ids=["P1"],
        annotations={"family": ["a"]},
        projections=["UMAP_2"],
    )
    manifest = write_manifest.build_manifest(
        repo=[("demo", demo)],
        release=[],
        release_tag=None,
        retained=[],
        public_dir=public,
    )

    text = write_manifest.render_manifest(manifest)

    assert text.startswith("// GENERATED")
    assert "export const EXAMPLE_MANIFEST: ExampleManifest = {" in text
    assert text.endswith("\n};\n")
    assert write_manifest.parse_manifest(text) == manifest
    assert manifest["release"] is None
    assert manifest["examples"]["demo"]["file"] == "data.parquetbundle"


def test_repo_files_are_named_relative_to_public(tmp_path):
    public = tmp_path / "public"
    bundle = _write_bundle(
        public / "data" / "5K.parquetbundle",
        ids=["P1"],
        annotations={"phylum": ["x"]},
        projections=["PCA_2"],
    )
    manifest = write_manifest.build_manifest(
        repo=[("5K", bundle)],
        release=[],
        release_tag=None,
        retained=[],
        public_dir=public,
    )
    assert manifest["examples"]["5K"]["file"] == "data/5K.parquetbundle"


def test_release_files_need_a_tag(tmp_path):
    bundle = _write_bundle(
        tmp_path / "x.parquetbundle",
        ids=["P1"],
        annotations={"a": ["b"]},
        projections=["P"],
    )
    with pytest.raises(SystemExit):
        write_manifest.build_manifest(
            repo=[], release=[("x", bundle)], release_tag=None, retained=[]
        )


def _release_manifest(release: str, retained: list | None = None) -> dict:
    return {
        "release": release,
        "retained": retained or [],
        "examples": {
            "demo": {
                "file": "data.parquetbundle",
                "hosting": "repo",
                "bytes": 1,
                "sha256": "d",
            },
            "swissprot": {
                "file": f"swissprot_{release}.parquetbundle",
                "hosting": "release",
                "bytes": 2,
                "sha256": "s",
            },
        },
    }


def test_a_new_release_retains_the_previous_release_files_for_one_cycle():
    previous = _release_manifest(
        "showcase-2026_03",
        retained=[
            {"release": "showcase-2025_04", "file": "old", "bytes": 3, "sha256": "o"}
        ],
    )

    retained = write_manifest.retained_after(previous, "showcase-2026_05")

    # The previous release's files are kept; what it retained itself is dropped,
    # and the repo-hosted demo is never retained.
    assert retained == [
        {
            "release": "showcase-2026_03",
            "file": "swissprot_showcase-2026_03.parquetbundle",
            "bytes": 2,
            "sha256": "s",
        }
    ]


def test_the_same_release_keeps_what_it_already_retains():
    retained_before = [
        {"release": "showcase-2025_04", "file": "old", "bytes": 3, "sha256": "o"}
    ]
    previous = _release_manifest("showcase-2026_03", retained=retained_before)

    assert (
        write_manifest.retained_after(previous, "showcase-2026_03") == retained_before
    )


def test_check_reports_a_stale_manifest(tmp_path, capsys):
    public = tmp_path / "public"
    out = tmp_path / "example-manifest.ts"
    demo = _write_bundle(
        public / "data.parquetbundle",
        ids=["P1"],
        annotations={"family": ["a"]},
        projections=["UMAP_2"],
    )
    args = ["--repo", f"demo={demo}", "--public-dir", str(public), "--out", str(out)]

    assert write_manifest.main(args) == 0
    assert write_manifest.main([*args, "--check"]) == 0
    assert (
        write_manifest.main(
            ["--refresh", "--public-dir", str(public), "--out", str(out), "--check"]
        )
        == 0
    )

    # The file changes under the manifest: both --check forms notice.
    _write_bundle(
        demo,
        ids=["P1", "P2"],
        annotations={"family": ["a", "b"]},
        projections=["UMAP_2"],
    )
    assert write_manifest.main([*args, "--check"]) == 1
    assert (
        write_manifest.main(
            ["--refresh", "--public-dir", str(public), "--out", str(out), "--check"]
        )
        == 1
    )
    assert "stale" in capsys.readouterr().err

    # --refresh rewrites it from the file.
    assert (
        write_manifest.main(
            ["--refresh", "--public-dir", str(public), "--out", str(out)]
        )
        == 0
    )
    manifest = write_manifest.parse_manifest(out.read_text())
    assert manifest["examples"]["demo"]["proteins"] == 2


def test_the_showcase_builds_group_objects_give_each_groups_release(tmp_path):
    # What build_showcase.py stamps (release_groups, stored by set_provenance as
    # sorted JSON): {group: {"release", "columns"}}, with a null release for the
    # computed columns. Those carry no UniProt release, so they are left out.
    groups = {
        "computed": {"columns": ["cluster_leiden"], "release": None},
        "paper": {"columns": ["family"], "release": "2025_03"},
        "refreshed": {"columns": ["ec", "pfam"], "release": "2026_03"},
        "withheld-truth": {"columns": ["ec_truth"], "release": "2026_03"},
    }
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle",
        ids=["P1"],
        annotations={
            "ec": ["1"],
            "pfam": ["PF1"],
            "family": ["f"],
            "ec_truth": ["1"],
            "cluster_leiden": ["3"],
        },
        projections=["UMAP_2"],
        metadata={"uniprot_release": json.dumps(groups, sort_keys=True)},
    )
    record = write_manifest.read_bundle_record(
        bundle, example_id="x", file="b", hosting="repo"
    )
    assert record["releases"]["annotations"] == {
        "paper": "2025_03",
        "refreshed": "2026_03",
        "withheld-truth": "2026_03",
    }


def test_group_objects_and_plain_releases_can_be_mixed(tmp_path):
    bundle = _write_bundle(
        tmp_path / "b.parquetbundle",
        ids=["P1"],
        annotations={"ec": ["1"]},
        projections=["UMAP_2"],
        metadata={
            "uniprot_release": json.dumps(
                {
                    "refreshed": {"columns": ["ec"], "release": "2026_03"},
                    "paper": "2025_03",
                    "eat": {"columns": ["ec_eat"]},
                }
            )
        },
    )
    record = write_manifest.read_bundle_record(
        bundle, example_id="x", file="b", hosting="repo"
    )
    assert record["releases"]["annotations"] == {
        "refreshed": "2026_03",
        "paper": "2025_03",
    }


def _release_bundle(directory: Path, name: str, family: str) -> Path:
    return _write_bundle(
        directory / name,
        ids=["P1"],
        annotations={"family": [family]},
        projections=["UMAP_2"],
    )


def test_a_retained_file_named_like_a_new_one_with_other_bytes_is_refused(tmp_path):
    new = _release_bundle(tmp_path, "swissprot_2026_03.parquetbundle", "new")
    retained = [
        {
            "release": "showcase-2026_03",
            "file": "swissprot_2026_03.parquetbundle",
            "bytes": 1,
            "sha256": "old",
        }
    ]
    with pytest.raises(SystemExit, match="new name"):
        write_manifest.build_manifest(
            repo=[],
            release=[("swissprot", new)],
            release_tag="showcase-2026_03b",
            retained=retained,
        )


def test_a_retained_file_identical_to_a_new_one_is_dropped_and_others_kept(tmp_path):
    same = _release_bundle(tmp_path, "venom-eat_2026_03.parquetbundle", "v")
    raw = same.read_bytes()
    retained = [
        {
            "release": "showcase-2026_03",
            "file": same.name,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
        {
            "release": "showcase-2026_03",
            "file": "old.parquetbundle",
            "bytes": 1,
            "sha256": "o",
        },
    ]
    manifest = write_manifest.build_manifest(
        repo=[],
        release=[("venom-eat", same)],
        release_tag="showcase-2026_05",
        retained=retained,
    )
    assert [entry["file"] for entry in manifest["retained"]] == ["old.parquetbundle"]


def test_the_zenodo_doi_survives_refresh_while_the_bytes_are_unchanged(tmp_path):
    public = tmp_path / "public"
    out = tmp_path / "example-manifest.ts"
    demo = _write_bundle(
        public / "data.parquetbundle",
        ids=["P1"],
        annotations={"family": ["a"]},
        projections=["UMAP_2"],
    )
    refresh = ["--refresh", "--public-dir", str(public), "--out", str(out)]
    assert (
        write_manifest.main(
            ["--repo", f"demo={demo}", "--public-dir", str(public), "--out", str(out)]
        )
        == 0
    )

    # The deposit is made after the build: the owner records its DOI...
    assert write_manifest.main([*refresh, "--zenodo-doi", "10.5281/zenodo.42"]) == 0

    def doi() -> str | None:
        return write_manifest.parse_manifest(out.read_text())["examples"]["demo"][
            "zenodoDoi"
        ]

    assert doi() == "10.5281/zenodo.42"
    # ...and CI's check, which re-reads the file, still passes.
    assert write_manifest.main([*refresh, "--check"]) == 0

    # A rebuilt file is not the deposited one: its DOI is not carried over.
    _write_bundle(
        demo,
        ids=["P1", "P2"],
        annotations={"family": ["a", "b"]},
        projections=["UMAP_2"],
    )
    assert write_manifest.main(refresh) == 0
    assert doi() is None
