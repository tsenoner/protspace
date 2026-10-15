"""Custom annotation files (`-a table.csv`): one loader, the same rules in every command.

The loader cases run on `load_custom_annotations` directly; the command cases run the CLI on
small synthetic inputs with no network (a CSV-only `-a` fetches nothing).
"""

import json
import logging
import re
import subprocess
import sys
import textwrap
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.retrievers.uniprot_retriever import (
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.io.bundle import read_tables
from protspace.data.io.ids import keyed_on_protein_id
from protspace.data.processors.custom_annotations import (
    CUSTOM_ANNOTATION_SUFFIXES,
    RESERVED_COLUMNS,
    load_custom_annotations,
    split_annotation_args,
)
from tests.cli_output import plain

HEADERS = ["P1", "P2", "P3", "P4"]
REPO_ROOT = Path(__file__).resolve().parents[3]
GUIDE = REPO_ROOT / "docs" / "guide" / "python-cli.md"


def _write(path, text: str) -> str:
    """Write *text* byte for byte, so CR and CRLF line endings survive."""
    path.write_bytes(text.encode())
    return str(path)


def _load(tmp_path, *texts, names=None, headers=HEADERS):
    names = names or [f"t{i}.csv" for i in range(len(texts))]
    paths = [_write(tmp_path / n, t) for n, t in zip(names, texts, strict=True)]
    return load_custom_annotations(paths, headers)


def _column(frame, name):
    return dict(zip(frame["protein_id"], frame[name], strict=True))


# ---------------------------------------------------------------------------
# Which -a values are files
# ---------------------------------------------------------------------------


class TestSplitAnnotationArgs:
    def test_suffixes_any_case_are_files(self):
        names, files = split_annotation_args(["a.CSV", "b.txt,default", "c.Tsv"])
        assert names == ["default"]
        assert [f.name for f in files] == ["a.CSV", "b.txt", "c.Tsv"]

    def test_names_stay_names(self):
        assert split_annotation_args(["default,pfam", " ec "]) == (
            ["default", "pfam", "ec"],
            [],
        )

    def test_a_name_that_is_also_a_file_stays_a_name(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        (tmp_path / "default").write_text("x")
        assert split_annotation_args(["default"]) == (["default"], [])

    def test_an_existing_file_of_another_type_is_refused(self, tmp_path):
        xlsx = tmp_path / "labels.xlsx"
        xlsx.write_bytes(b"PK")
        with pytest.raises(ValueError, match=r"\.csv, \.tsv or \.txt"):
            split_annotation_args([str(xlsx)])

    def test_a_comma_in_a_file_name_does_not_split_it(self, tmp_path):
        csv = tmp_path / "labels, v2.csv"
        csv.write_text("identifier,x\nP1,a\n")
        assert split_annotation_args([str(csv)]) == ([], [csv])
        # A value that names no file is still a comma-separated list.
        names, files = split_annotation_args([f"default,{tmp_path / 'b.csv'}"])
        assert names == ["default"] and [f.name for f in files] == ["b.csv"]


def test_the_guide_lists_the_accepted_suffixes():
    section = GUIDE.read_text().split("### Custom annotation files")[1]
    bullet = section.split("**File type.**")[1].split("\n- ")[0]
    listed = set(re.findall(r"`(\.\w+)`", bullet))
    assert listed - {".xlsx"} == set(CUSTOM_ANNOTATION_SUFFIXES)


def test_the_guide_lists_the_reserved_names():
    section = GUIDE.read_text().split("### Custom annotation files")[1]
    bullet = section.split("**Reserved names.**")[1].split("\n- ")[0]
    listed = set(re.findall(r"`(\w+)`", bullet.split("(exactly")[0]))
    assert listed == RESERVED_COLUMNS


def test_the_guide_and_the_notebook_state_the_first_column_rule():
    section = GUIDE.read_text().split("### Custom annotation files")[1]
    assert "The first column holds the protein ids" in section
    notebook = (
        REPO_ROOT / "apps/protspace/notebooks/ProtSpace_Preparation.ipynb"
    ).read_text()
    hint = notebook.split("Optional: a CSV/TSV with custom annotations")[1][:80]
    assert "first column, whatever its name" in hint


# ---------------------------------------------------------------------------
# Parsing one file
# ---------------------------------------------------------------------------


class TestDelimiter:
    @pytest.mark.parametrize("sep", ["\t", ";", ","])
    def test_sniffed_whatever_the_extension(self, tmp_path, sep):
        text = sep.join(["identifier", "family"]) + "\n" + sep.join(["P1", "a"]) + "\n"
        frame = _load(tmp_path, text, names=["labels.csv"])
        assert _column(frame, "family")["P1"] == "a"

    def test_data_rows_do_not_vote(self, tmp_path):
        # Commas and semicolons inside tab-separated cells are text, not delimiters.
        text = "identifier\tspecies\nP1\tHomo sapiens, human; adult\n"
        frame = _load(tmp_path, text, names=["labels.txt"])
        assert _column(frame, "species")["P1"] == "Homo sapiens, human; adult"

    def test_one_column_warns(self, tmp_path, caplog):
        with caplog.at_level(logging.WARNING):
            _load(tmp_path, "identifier family\nP1 a\n")
        assert "single column" in caplog.text


class TestIdColumn:
    """The first column holds the ids, whatever its header; no name outranks it."""

    @pytest.mark.parametrize(
        "header, kept",
        [
            ("family,protein_id,group", ["protein_id_annotation", "group"]),
            ("seq,identifier,group", ["identifier_annotation", "group"]),
            ("accession,id,family", ["id_annotation", "family"]),
            ("ProteinID,family", ["family"]),
            ("protein_id,identifier", ["identifier_annotation"]),
            ("id,family", ["family"]),
        ],
    )
    def test_the_first_column_is_the_id(self, tmp_path, header, kept):
        row = ",".join(["P1", "a", "b"][: len(kept) + 1])
        frame = _load(tmp_path, f"{header}\n{row}\n")
        assert list(frame.columns) == ["protein_id", *kept]
        assert frame["protein_id"].tolist() == HEADERS
        assert _column(frame, kept[0])["P1"] == "a"

    def test_a_reserved_name_is_renamed_with_a_warning(self, tmp_path, caplog):
        with caplog.at_level(logging.WARNING):
            _load(tmp_path, "seq,protein_id\nP1,x\n", names=["labels.csv"])
        assert "'protein_id' is kept as the annotation 'protein_id_annotation'" in (
            caplog.text
        )
        assert "labels.csv" in caplog.text and "'seq'" in caplog.text

    def test_two_reserved_names_are_both_kept(self, tmp_path):
        frame = _load(tmp_path, "accession,identifier,protein_id\nP1,a,b\n")
        assert _column(frame, "identifier_annotation")["P1"] == "a"
        assert _column(frame, "protein_id_annotation")["P1"] == "b"

    def test_a_taken_new_name_is_numbered(self, tmp_path):
        frame = _load(tmp_path, "seq,id,id_annotation\nP1,a,b\n")
        assert list(frame.columns) == ["protein_id", "id_annotation_2", "id_annotation"]
        assert _column(frame, "id_annotation_2")["P1"] == "a"

    @pytest.mark.parametrize("name", ["Protein_ID", "ID", "Identifier", "ids"])
    def test_names_that_collide_with_nothing_are_kept(self, tmp_path, name, caplog):
        with caplog.at_level(logging.WARNING):
            frame = _load(tmp_path, f"seq,{name}\nP1,a\n")
        assert list(frame.columns) == ["protein_id", name]
        assert "reserves" not in caplog.text


class TestParquetIdColumn:
    """A parquet keeps the name-based rule: every table ProtSpace writes names its ids."""

    @pytest.mark.parametrize(
        "columns, expected",
        [
            (["family", "protein_id", "group"], "protein_id"),
            (["family", "identifier"], "identifier"),
            (["ProteinID", "family"], "ProteinID"),
            (["family", "id"], "family"),
            (["family", "Protein_ID"], "family"),
        ],
    )
    def test_rule(self, columns, expected):
        table = keyed_on_protein_id(pa.table({c: [c] for c in columns}))
        assert table.column("protein_id").to_pylist() == [expected]

    def test_protein_id_wins_over_identifier(self):
        table = keyed_on_protein_id(
            pa.table({"identifier": ["alias"], "protein_id": ["P1"], "family": ["f"]})
        )
        assert table.to_pydict() == {
            "identifier": ["alias"],
            "protein_id": ["P1"],
            "family": ["f"],
        }

    def test_no_columns_is_refused(self):
        with pytest.raises(ValueError, match="no columns"):
            keyed_on_protein_id(pa.table({}))


class TestCells:
    def test_empty_cells_stay_empty(self, tmp_path):
        frame = _load(tmp_path, "identifier,family,note\nP1,,x\nP2,NA,\n")
        assert _column(frame, "family") == {"P1": "", "P2": "NA", "P3": "", "P4": ""}
        assert "nan" not in frame.to_numpy().ravel().tolist()

    @pytest.mark.parametrize("newline", ["\r\n", "\r", "mixed"])
    def test_line_endings(self, tmp_path, newline):
        lines = ["identifier,family,group", "P1,a,x", "P2,b,y"]
        if newline == "mixed":
            text = lines[0] + "\r\n" + lines[1] + "\r" + lines[2] + "\n"
        else:
            text = newline.join(lines) + newline
        frame = _load(tmp_path, text)
        assert list(frame.columns) == ["protein_id", "family", "group"]
        assert _column(frame, "group") == {"P1": "x", "P2": "y", "P3": "", "P4": ""}

    def test_byte_order_mark(self, tmp_path):
        frame = _load(tmp_path, "﻿identifier,family\nP1,a\n")
        assert _column(frame, "family")["P1"] == "a"

    def test_plain_text_is_encoded_as_bundle_reads_a_hand_written_table(self, tmp_path):
        frame = _load(tmp_path, 'identifier,loc\nP1,"Membrane (single-pass; type I)"\n')
        # One value, the semicolon inside the parentheses escaped (v2 grammar).
        assert _column(frame, "loc")["P1"] == "Membrane (single-pass%3B type I)"

    def test_repeated_id_keeps_the_first_row(self, tmp_path, caplog):
        with caplog.at_level(logging.WARNING):
            frame = _load(tmp_path, "identifier,family\nP1,a\nP1,b\n")
        assert _column(frame, "family")["P1"] == "a"
        assert "1 repeated" in caplog.text


# ---------------------------------------------------------------------------
# Several files, coverage
# ---------------------------------------------------------------------------


class TestSeveralFiles:
    def test_a_second_file_adds_its_columns(self, tmp_path):
        frame = _load(
            tmp_path,
            "identifier,family\nP1,a\nP2,b\n",
            "identifier\tneighbor\nP2\tnear\nP3\tfar\n",
            names=["meta.csv", "neighbor.csv"],
        )
        assert _column(frame, "family") == {"P1": "a", "P2": "b", "P3": "", "P4": ""}
        assert _column(frame, "neighbor") == {
            "P1": "",
            "P2": "near",
            "P3": "far",
            "P4": "",
        }

    def test_a_column_in_two_files_is_an_error(self, tmp_path):
        with pytest.raises(ValueError, match=r"family.*a\.csv.*b\.csv"):
            _load(
                tmp_path,
                "identifier,family\nP1,a\n",
                "identifier,family\nP1,b\n",
                names=["a.csv", "b.csv"],
            )

    def test_the_same_file_twice_is_read_once(self, tmp_path):
        path = _write(tmp_path / "a.csv", "identifier,family\nP1,a\n")
        frame = load_custom_annotations([path, path], HEADERS)
        assert list(frame.columns) == ["protein_id", "family"]


class TestCoverage:
    def test_rows_follow_the_input(self, tmp_path):
        frame = _load(tmp_path, "identifier,family\nP3,c\nP1,a\n")
        assert frame["protein_id"].tolist() == HEADERS

    def test_unmatched_ids_warn_with_examples(self, tmp_path, caplog):
        headers = ["sp|P60000|TX0_CONSP", "sp|P60001|TX1_CONSP", "Ss_1"]
        with caplog.at_level(logging.WARNING):
            frame = _load(
                tmp_path,
                "identifier,family\nP60000,a\nP60001,b\nSs_1,c\n",
                headers=headers,
            )
        assert "2 of 3 ids" in caplog.text
        assert "P60000" in caplog.text
        assert "sp|P60000|TX0_CONSP" in caplog.text
        assert _column(frame, "family")["Ss_1"] == "c"

    def test_partial_coverage_does_not_warn(self, tmp_path, caplog):
        with caplog.at_level(logging.WARNING):
            _load(tmp_path, "identifier,family\nP1,a\n")
        assert caplog.text == ""


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def _h5(tmp_path, headers=HEADERS, dim=6, seed=0):
    rng = np.random.default_rng(seed)
    path = tmp_path / "emb.h5"
    with h5py.File(path, "w") as f:
        for header in headers:
            f.create_dataset(header, data=rng.normal(size=dim).astype(np.float32))
    return path


def _forbid_uniprot(monkeypatch):
    def fail(_retriever):
        raise AssertionError("UniProt must not be called")

    monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fail)


# Wide enough that Rich does not wrap a message inside a long temporary path,
# which `plain` would rejoin with a space; turbo runs tests without COLUMNS.
_WIDE = {"COLUMNS": "1000"}


def _invoke(*args):
    return CliRunner().invoke(app, [str(a) for a in args], env=_WIDE)


def _bundle_annotations(path) -> pd.DataFrame:
    annotations, _, _ = read_tables(path)
    return annotations.to_pandas().set_index("protein_id")


class TestPrepare:
    def test_two_files_both_reach_the_bundle(self, tmp_path, monkeypatch):
        _forbid_uniprot(monkeypatch)
        meta = _write(tmp_path / "meta.csv", "protein_id,family\nP1,a\nP2,\n")
        nb = _write(tmp_path / "nb.CSV", "id;neighbor\nP2;near\n")
        out = tmp_path / "out"
        result = _invoke(
            "prepare",
            "-i",
            f"{_h5(tmp_path)}:E",
            "-a",
            meta,
            "-a",
            nb,
            "-m",
            "pca2",
            "--no-log",
            "-o",
            out,
        )
        assert result.exit_code == 0, result.output
        frame = _bundle_annotations(out / "data.parquetbundle")
        assert frame.loc["P1", "family"] == "a"
        assert frame.loc["P2", "neighbor"] == "near"
        assert frame.loc["P2", "family"] == ""
        assert "nan" not in frame.to_numpy().ravel().tolist()

    def test_a_column_in_two_files_fails_the_run(self, tmp_path, monkeypatch):
        _forbid_uniprot(monkeypatch)
        a = _write(tmp_path / "a.csv", "identifier,family\nP1,a\n")
        b = _write(tmp_path / "b.csv", "identifier,family\nP1,b\n")
        result = _invoke(
            "prepare",
            "-i",
            f"{_h5(tmp_path)}:E",
            "-a",
            a,
            "-a",
            b,
            "--no-log",
            "-o",
            tmp_path / "out",
        )
        assert result.exit_code == 1
        assert "family" in plain(result.output)

    def test_a_comma_in_a_file_name_reaches_the_bundle(self, tmp_path, monkeypatch):
        _forbid_uniprot(monkeypatch)
        csv = _write(tmp_path / "labels, v2.csv", "identifier,family\nP1,a\n")
        out = tmp_path / "out"
        result = _invoke(
            "prepare", "-i", f"{_h5(tmp_path)}:E", "-a", csv, "--no-log", "-o", out
        )
        assert result.exit_code == 0, result.output
        frame = _bundle_annotations(out / "data.parquetbundle")
        assert frame.loc["P1", "family"] == "a"

    @pytest.mark.parametrize("reserved", ["identifier", "protein_id"])
    def test_a_later_id_named_column_reaches_the_bundle(
        self, tmp_path, monkeypatch, reserved
    ):
        # Once a duplicate-column error: the first column becomes `protein_id`, the
        # name the bundle is written with.
        _forbid_uniprot(monkeypatch)
        csv = _write(tmp_path / "labels.csv", f"seq,{reserved},group\nP1,x,g\n")
        out = tmp_path / "out"
        result = _invoke(
            "prepare", "-i", f"{_h5(tmp_path)}:E", "-a", csv, "--no-log", "-o", out
        )
        assert result.exit_code == 0, result.output
        frame = _bundle_annotations(out / "data.parquetbundle")
        assert frame.loc["P1", f"{reserved}_annotation"] == "x"
        assert frame.loc["P1", "group"] == "g"
        assert reserved == "protein_id" or reserved not in frame.columns

    def test_a_missing_file_fails_before_anything_is_embedded(
        self, tmp_path, monkeypatch
    ):
        def fail(*_args, **_kwargs):
            raise AssertionError("nothing must be embedded")

        monkeypatch.setattr("protspace.cli.prepare._embed_all", fail)
        fasta = tmp_path / "seqs.fasta"
        fasta.write_text(">P1\nMKV\n")
        result = _invoke(
            "prepare",
            "-i",
            fasta,
            "-a",
            tmp_path / "typo.csv",
            "--no-log",
            "-o",
            tmp_path / "out",
        )
        assert result.exit_code == 2
        assert "typo.csv" in plain(result.output)


class TestAnnotate:
    def test_a_csv_alone_fetches_nothing(self, tmp_path, monkeypatch):
        _forbid_uniprot(monkeypatch)
        csv = _write(tmp_path / "labels.tsv", "identifier\tfamily\nP1\ta\n")
        output = tmp_path / "ann.parquet"
        result = _invoke("annotate", "-i", _h5(tmp_path), "-a", csv, "-o", output)
        assert result.exit_code == 0, result.output
        frame = pd.read_parquet(output)
        assert frame["protein_id"].tolist() == HEADERS
        assert frame["family"].tolist() == ["a", "", "", ""]
        # Stamped v2, so `bundle -a` passes the cells through.
        meta = pq.read_schema(output).metadata
        assert meta[b"protspace_format_version"] == b"2"

    def test_a_file_column_overrides_a_fetched_one(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            UniProtRetriever,
            "fetch_annotations",
            lambda self: [
                ProteinAnnotations(identifier=h, annotations={"length": "10"})
                for h in self.headers
            ],
        )
        csv = _write(tmp_path / "labels.csv", "identifier,length\nP1,99\n")
        output = tmp_path / "ann.parquet"
        result = _invoke(
            "annotate", "-i", _h5(tmp_path), "-a", f"length,{csv}", "-o", output
        )
        assert result.exit_code == 0, result.output
        lengths = pd.read_parquet(output).set_index("protein_id")["length"]
        assert lengths["P1"] == "99"

    def test_a_later_protein_id_column_is_kept_renamed(self, tmp_path, monkeypatch):
        _forbid_uniprot(monkeypatch)
        csv = _write(tmp_path / "labels.csv", "seq,protein_id\nP2,x\n")
        output = tmp_path / "ann.parquet"
        result = _invoke("annotate", "-i", _h5(tmp_path), "-a", csv, "-o", output)
        assert result.exit_code == 0, result.output
        frame = pd.read_parquet(output)
        assert list(frame.columns) == ["protein_id", "protein_id_annotation"]
        assert frame.set_index("protein_id").loc["P2", "protein_id_annotation"] == "x"

    def test_an_unknown_source_is_a_usage_error(self, tmp_path):
        result = _invoke("annotate", "-i", _h5(tmp_path), "-a", "not_a_source")
        assert result.exit_code == 2
        assert "Unknown annotation 'not_a_source'" in plain(result.output)
        assert "Traceback" not in result.output


def _project(tmp_path, n=40):
    """An HDF5 and the `project` directory built from it."""
    headers = [f"p{i}" for i in range(n)]
    h5 = _h5(tmp_path, headers=headers)
    proj = tmp_path / "proj"
    result = _invoke("project", "-i", f"{h5}:E", "-m", "pca2", "-o", proj)
    assert result.exit_code == 0, result.output
    return h5, proj, headers


class TestStats:
    def test_a_csv_is_scored_and_written_beside_the_projections(self, tmp_path):
        h5, proj, headers = _project(tmp_path)
        rows = "".join(f"{h},{'ab'[i % 2]}\n" for i, h in enumerate(headers[:30]))
        csv = tmp_path / "labels.csv"
        _write(csv, "identifier,grp\n" + rows)
        before = csv.read_bytes()
        result = _invoke(
            "stats",
            "-i",
            f"{h5}:E",
            "-p",
            proj,
            "-a",
            csv,
            "-o",
            proj / "statistics.parquet",
            "--settings-out",
            proj / "styles.json",
        )
        assert result.exit_code == 0, result.output
        assert csv.read_bytes() == before
        written = pd.read_parquet(proj / "labels.annotations.parquet")
        assert sorted(written["protein_id"]) == sorted(headers)
        cluster = [c for c in written.columns if c.startswith("cluster_elbow_")]
        assert cluster and (written[cluster[0]] != "").all()
        assert written.set_index("protein_id").loc["p35", "grp"] == ""
        assert json.loads((proj / "styles.json").read_text())

        # The step route ends in a bundle carrying both.
        bundle = tmp_path / "out.parquetbundle"
        result = _invoke(
            "bundle",
            "-p",
            proj,
            "-a",
            proj / "labels.annotations.parquet",
            "-s",
            proj / "statistics.parquet",
            "-o",
            bundle,
        )
        assert result.exit_code == 0, result.output
        assert {"grp", cluster[0]} <= set(_bundle_annotations(bundle).columns)

    def test_a_later_protein_id_column_survives_stats_and_bundle(self, tmp_path):
        # stats writes the ids to `protein_id`; the file's own `protein_id` column,
        # kept beside them under that name, would give the table two of them.
        h5, proj, headers = _project(tmp_path)
        rows = "".join(f"{h},v{i},{'ab'[i % 2]}\n" for i, h in enumerate(headers))
        csv = _write(tmp_path / "labels.csv", "seq,protein_id,grp\n" + rows)
        result = _invoke(
            "stats", "-i", f"{h5}:E", "-p", proj, "-a", csv, "-o", proj / "s.parquet"
        )
        assert result.exit_code == 0, result.output
        enriched = proj / "labels.annotations.parquet"
        written = pd.read_parquet(enriched)
        assert list(written.columns[:2]) == ["protein_id", "protein_id_annotation"]
        assert (
            written.set_index("protein_id").loc["p3", "protein_id_annotation"] == "v3"
        )
        bundle = tmp_path / "out.parquetbundle"
        result = _invoke("bundle", "-p", proj, "-a", enriched, "-o", bundle)
        assert result.exit_code == 0, result.output
        frame = _bundle_annotations(bundle)
        assert frame.loc["p1", "grp"] == "b"
        assert frame.loc["p1", "protein_id_annotation"] == "v1"
        assert any(c.startswith("cluster_elbow_") for c in frame.columns)

    def test_a_csv_leaves_the_directory_annotations_alone(self, tmp_path):
        # An unbundled `prepare` directory keeps its fetched annotations under this name.
        h5, proj, headers = _project(tmp_path)
        fetched = proj / "selected_annotations.parquet"
        pq.write_table(pa.table({"protein_id": headers, "pfam": ["PF1"] * 40}), fetched)
        before = fetched.read_bytes()
        csv = _write(tmp_path / "labels.csv", "identifier,grp\np0,a\np1,b\n")
        result = _invoke(
            "stats", "-i", f"{h5}:E", "-p", proj, "-a", csv, "-o", proj / "s.parquet"
        )
        assert result.exit_code == 0, result.output
        assert fetched.read_bytes() == before
        assert (proj / "labels.annotations.parquet").exists()

    def test_a_non_parquet_file_is_a_usage_error(self, tmp_path):
        h5, proj, _ = _project(tmp_path)
        junk = tmp_path / "labels.json"
        junk.write_text("{}")
        result = _invoke(
            "stats", "-i", f"{h5}:E", "-p", proj, "-a", junk, "-o", tmp_path / "s.pq"
        )
        assert result.exit_code == 2
        assert ".csv" in plain(result.output)
        assert "Traceback" not in result.output


class TestBundle:
    def test_a_csv_is_bundled(self, tmp_path):
        _, proj, headers = _project(tmp_path)
        csv = _write(tmp_path / "labels.csv", f"protein_id;family\n{headers[0]};a\n")
        bundle = tmp_path / "out.parquetbundle"
        result = _invoke("bundle", "-p", proj, "-a", csv, "-o", bundle)
        assert result.exit_code == 0, result.output
        frame = _bundle_annotations(bundle)
        assert frame.loc[headers[0], "family"] == "a"
        assert frame.loc[headers[1], "family"] == ""

    def test_a_non_parquet_file_is_a_usage_error(self, tmp_path):
        _, proj, _ = _project(tmp_path)
        junk = tmp_path / "labels.json"
        junk.write_text("{}")
        result = _invoke("bundle", "-p", proj, "-a", junk, "-o", tmp_path / "o")
        assert result.exit_code == 2
        assert ".csv" in plain(result.output)

    def test_stats_and_bundle_key_a_parquet_alike(self, tmp_path):
        h5, proj, headers = _project(tmp_path)
        ann = tmp_path / "ann.parquet"
        groups = ["ab"[i % 2] for i in range(len(headers))]
        pq.write_table(pa.table({"ProteinID": headers, "grp": groups}), ann)
        result = _invoke(
            "stats", "-i", f"{h5}:E", "-p", proj, "-a", ann, "-o", tmp_path / "s.pq"
        )
        assert result.exit_code == 0, result.output
        bundle = tmp_path / "out.parquetbundle"
        result = _invoke("bundle", "-p", proj, "-a", ann, "-o", bundle)
        assert result.exit_code == 0, result.output
        frame = _bundle_annotations(bundle)
        assert frame.loc[headers[1], "grp"] == "b"
        assert any(c.startswith("cluster_elbow_") for c in frame.columns)

    def test_a_parquet_with_both_id_names_keys_on_protein_id(self, tmp_path):
        # The bundle contract's coverage variant builds this table.
        _, proj, headers = _project(tmp_path)
        ann = tmp_path / "ann.parquet"
        aliases = [f"alias-{h}" for h in headers]
        pq.write_table(pa.table({"identifier": aliases, "protein_id": headers}), ann)
        bundle = tmp_path / "out.parquetbundle"
        result = _invoke("bundle", "-p", proj, "-a", ann, "-o", bundle)
        assert result.exit_code == 0, result.output
        assert _bundle_annotations(bundle).loc[headers[1], "identifier"] == aliases[1]


class TestProject:
    @pytest.mark.parametrize("option", [["-a", "labels.csv"], ["--stats"]])
    def test_annotation_and_stats_options_point_elsewhere(self, tmp_path, option):
        result = _invoke(
            "project", "-i", f"{_h5(tmp_path)}:E", *option, "-o", tmp_path / "proj"
        )
        assert result.exit_code == 2
        message = plain(result.output)
        assert "protspace prepare" in message
        assert "protspace bundle" in message
        assert not (tmp_path / "proj").exists()

    def test_help_names_prepare_and_hides_the_options(self):
        result = _invoke("project", "--help")
        assert "prepare" in plain(result.output)
        assert "--annotations" not in result.output
        assert "--stats" not in result.output


# ---------------------------------------------------------------------------
# Embedding options with nothing to embed
# ---------------------------------------------------------------------------


class TestEmbeddingOptionsOnHdf5:
    def _prepare(self, tmp_path, monkeypatch, *extra):
        _forbid_uniprot(monkeypatch)
        csv = _write(tmp_path / "labels.csv", "identifier,family\nP1,a\n")
        return _invoke(
            "prepare",
            "-i",
            f"{_h5(tmp_path)}:E",
            "-a",
            csv,
            "--no-log",
            "-o",
            tmp_path / "out",
            *extra,
        )

    @pytest.mark.parametrize(
        "extra, flag",
        [
            (["-b", "local"], "-b/--backend"),
            (["--max-length", "100"], "--max-length"),
            (["--batch-size", "4"], "--batch-size"),
        ],
    )
    def test_a_given_option_warns_and_the_run_completes(
        self, tmp_path, monkeypatch, extra, flag
    ):
        result = self._prepare(tmp_path, monkeypatch, *extra)
        assert result.exit_code == 0, result.output
        message = plain(result.output)
        assert flag in message
        assert "no effect" in message

    def test_defaults_do_not_warn(self, tmp_path, monkeypatch):
        result = self._prepare(tmp_path, monkeypatch)
        assert result.exit_code == 0, result.output
        assert "no effect" not in result.output


def test_hdf5_only_prepare_imports_no_embedding_backend(tmp_path):
    """Run in a fresh interpreter: this one has imported the backends already."""
    csv = _write(tmp_path / "labels.csv", "identifier,family\nP1,a\n")
    script = textwrap.dedent(
        f"""
        import sys
        from typer.testing import CliRunner
        from protspace.cli.app import app

        result = CliRunner().invoke(app, [
            "prepare", "-i", {f"{_h5(tmp_path)}:E"!r}, "-a", {csv!r}, "-b", "local",
            "-m", "pca2", "--no-log", "-o", {str(tmp_path / "out")!r},
        ])
        assert result.exit_code == 0, result.output
        loaded = ("protspace.data.embedding", "biocentral_api", "torch")
        print(",".join(m for m in loaded if m in sys.modules))
        """
    )
    run = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, check=False
    )
    assert run.returncode == 0, run.stderr
    assert run.stdout.strip().splitlines()[-1:] in ([], [""]), run.stdout
