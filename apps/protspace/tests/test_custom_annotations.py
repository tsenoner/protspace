"""Custom annotation files (`-a table.csv`): one loader, the same rules in every command.

The loader cases run on `load_custom_annotations` directly; the command cases run the CLI on
small synthetic inputs with no network (a CSV-only `-a` fetches nothing).
"""

import json
import logging
import subprocess
import sys
import textwrap

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
from protspace.data.processors.custom_annotations import (
    load_custom_annotations,
    resolve_id_column,
    split_annotation_args,
)
from tests.cli_output import plain

HEADERS = ["P1", "P2", "P3", "P4"]


def _write(path, text: str) -> str:
    """Write *text* byte for byte, so CR and CRLF line endings survive."""
    path.write_bytes(text.encode())
    return str(path)


def _load(tmp_path, *texts, names=None, headers=HEADERS):
    names = names or [f"t{i}.csv" for i in range(len(texts))]
    paths = [_write(tmp_path / n, t) for n, t in zip(names, texts, strict=True)]
    return load_custom_annotations(paths, headers)


def _column(frame, name):
    return dict(zip(frame["identifier"], frame[name], strict=True))


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
    @pytest.mark.parametrize(
        "columns, expected",
        [
            (["family", "protein_id", "group"], "protein_id"),
            (["family", "identifier", "group"], "identifier"),
            (["family", "Protein_ID"], "Protein_ID"),
            (["family", "ID"], "ID"),
            (["ProteinID", "family"], "ProteinID"),
        ],
    )
    def test_rule(self, columns, expected):
        assert resolve_id_column(columns) == expected

    def test_identifier_and_protein_id_both_named_is_an_error(self):
        with pytest.raises(ValueError, match="identifier.*protein_id"):
            resolve_id_column(["identifier", "protein_id", "family"])

    def test_protein_id_not_first_reaches_the_output(self, tmp_path):
        frame = _load(tmp_path, "family,protein_id,group\na,P1,g\n")
        assert _column(frame, "family")["P1"] == "a"
        assert _column(frame, "group")["P1"] == "g"
        assert "protein_id" not in frame.columns

    def test_identifier_not_first(self, tmp_path):
        frame = _load(tmp_path, "family,identifier\na,P2\n")
        assert _column(frame, "family")["P2"] == "a"


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
        assert list(frame.columns) == ["identifier", "family", "group"]
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
        assert list(frame.columns) == ["identifier", "family"]


class TestCoverage:
    def test_rows_follow_the_input(self, tmp_path):
        frame = _load(tmp_path, "identifier,family\nP3,c\nP1,a\n")
        assert frame["identifier"].tolist() == HEADERS

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


def _invoke(*args):
    return CliRunner().invoke(app, [str(a) for a in args])


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
