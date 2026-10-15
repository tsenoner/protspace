"""How an HDF5 input gets its embedding name, and what a command says without one.

The name labels the projections and decides how several ``-i`` inputs combine
(same name: union, different names: intersection), so it may be inferred only
where that choice does not arise: one input, or a file whose name says which
model made it.
"""

from __future__ import annotations

import ast
import json
import logging
from pathlib import Path

import h5py
import numpy as np
import pyarrow.parquet as pq
import pytest
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.cli.common_options import EMBEDDER_MODELS
from protspace.data.loaders.h5 import (
    _model_from_file_name,
    load_h5,
    resolve_input_names,
)
from tests.cli_output import plain

NOTEBOOK_DIR = Path(__file__).resolve().parents[1] / "notebooks"


def _h5(path: Path, *, model_name: str | None = None, n: int = 12, seed: int = 0):
    rng = np.random.default_rng(seed)
    with h5py.File(path, "w") as f:
        if model_name:
            f.attrs["model_name"] = model_name
        for i in range(n):
            f.create_dataset(f"p{i}", data=rng.normal(size=8).astype(np.float32))
    return path


# --- The file-name rule ---------------------------------------------------------


@pytest.mark.parametrize(
    ("stem", "expected"),
    [
        ("esm2_650m", "esm2_650m"),
        ("seqs_esm2_650m", "esm2_650m"),
        ("Ss_mSCR_esm2_650m", "esm2_650m"),
        ("Ss_mSCR_ESM2_650M", "esm2_650m"),
        ("toxins_prot_t5", "prot_t5"),
        ("toxins_prost_t5", "prost_t5"),
        ("esm2_650m_subset", None),
        ("embeddings", None),
        ("mmseqs2", None),
    ],
)
def test_model_from_file_name(stem, expected):
    assert _model_from_file_name(stem) == expected


def test_longest_trailing_key_wins(monkeypatch):
    import protspace.data.loaders.h5 as h5

    monkeypatch.setitem(h5._KNOWN_MODELS, "large", "large")
    assert _model_from_file_name("seqs_ankh3_large") == "ankh3_large"


def test_every_embedder_is_recognised_from_a_file_name():
    """`prepare -e` and the embed cache name files after these keys."""
    assert {k: _model_from_file_name(f"seqs_{k}") for k in EMBEDDER_MODELS} == {
        k: k for k in EMBEDDER_MODELS
    }


def test_every_clickthrough_key_is_recognised_from_its_file_name():
    """The embeddings notebook writes `{fasta_stem}_{short_key}.h5`; files written
    before it stamped `model_name` rely on this rule alone."""
    nb = json.loads(
        (NOTEBOOK_DIR / "ClickThrough_GenerateEmbeddings.ipynb").read_text()
    )
    (keys,) = [
        ast.literal_eval(node.value)
        for cell in nb["cells"]
        if cell["cell_type"] == "code"
        for node in ast.walk(ast.parse("".join(cell["source"])))
        if isinstance(node, ast.Assign)
        and any(getattr(t, "id", None) == "MODEL_SHORT_KEYS" for t in node.targets)
    ]
    assert {k: _model_from_file_name(f"seqs_{k}") for k in keys.values()} == {
        k: k for k in keys.values()
    }


# --- load_h5 --------------------------------------------------------------------


def test_load_h5_explicit_name_beats_attribute(tmp_path):
    path = _h5(tmp_path / "seqs_esm2_650m.h5", model_name="prot_t5")
    assert load_h5([path], name_override="custom").name == "custom"


def test_load_h5_attribute_beats_file_name(tmp_path):
    path = _h5(tmp_path / "seqs_esm2_650m.h5", model_name="prot_t5")
    assert load_h5([path]).name == "prot_t5"


def test_load_h5_reads_the_model_from_the_file_name(tmp_path):
    assert load_h5([_h5(tmp_path / "seqs_esm2_650m.h5")]).name == "esm2_650m"


def test_load_h5_without_a_name_names_no_command_and_no_model(tmp_path):
    with pytest.raises(ValueError, match="no 'model_name' attribute") as exc:
        load_h5([_h5(tmp_path / "results.h5")])
    assert "protspace prepare" not in str(exc.value)
    assert "prot_t5" not in str(exc.value)


# --- resolve_input_names ----------------------------------------------------------


def test_single_unnamed_input_falls_back_to_its_stem(tmp_path, caplog):
    path = _h5(tmp_path / "results.h5")
    with caplog.at_level(logging.INFO, logger="protspace.data.loaders.h5"):
        (named,) = resolve_input_names([(path, None)], command="prepare")
    assert (named.name, named.from_file_name) == ("results", True)
    assert f"{path}:<model>" in caplog.text


def test_file_name_key_is_logged(tmp_path, caplog):
    path = _h5(tmp_path / "seqs_esm2_650m.h5")
    with caplog.at_level(logging.INFO, logger="protspace.data.loaders.h5"):
        (named,) = resolve_input_names([(path, None)], command="prepare")
    assert (named.name, named.from_file_name) == ("esm2_650m", True)
    assert "taken from the file name" in caplog.text


def test_stated_names_are_not_marked_as_inferred(tmp_path):
    attr = _h5(tmp_path / "a.h5", model_name="prot_t5")
    named = resolve_input_names(
        [(attr, None), (tmp_path / "b.h5", "esm2_650m")], command="prepare"
    )
    assert [(n.name, n.from_file_name) for n in named] == [
        ("prot_t5", False),
        ("esm2_650m", False),
    ]


@pytest.mark.parametrize("command", ["prepare", "stats", "project"])
def test_several_unnamed_inputs_are_refused_with_the_commands_example(
    tmp_path, command
):
    a, b = _h5(tmp_path / "a.h5"), _h5(tmp_path / "b.h5")
    with pytest.raises(ValueError) as exc:
        resolve_input_names([(a, None), (b, None)], command=command)
    message = str(exc.value)
    assert f"protspace {command} -i {a}:<model> -i {b}:<model>" in message
    assert "prot_t5 " not in message.replace("prot_t5, ", "")
    if command == "project":
        assert "labels each input's projections" in message
    else:
        assert "union" in message and "intersected" in message


def test_one_unnamed_input_beside_a_named_one_is_refused(tmp_path):
    a = _h5(tmp_path / "a.h5", model_name="prot_t5")
    b = _h5(tmp_path / "b.h5")
    with pytest.raises(ValueError) as exc:
        resolve_input_names([(a, None), (b, None)], command="prepare")
    assert f"-i {a} -i {b}:<model>" in str(exc.value)


def test_a_fasta_input_counts_as_an_input(tmp_path):
    """An unnamed HDF5 beside a FASTA would be unioned or intersected by a guess."""
    fasta = tmp_path / "seqs.fasta"
    fasta.write_text(">p0\nMKV\n")
    with pytest.raises(ValueError, match="No embedding name"):
        resolve_input_names(
            [(_h5(tmp_path / "results.h5"), None), (fasta, None)], command="prepare"
        )


def test_a_directory_is_named_by_its_files_then_its_own_name(tmp_path):
    agreeing = tmp_path / "embs"
    agreeing.mkdir()
    _h5(agreeing / "human_esm2_650m.h5")
    _h5(agreeing / "fly_esm2_650m.h5", seed=1)
    named_dir = tmp_path / "prot_t5"
    named_dir.mkdir()
    _h5(named_dir / "human.h5")

    named = resolve_input_names(
        [(agreeing, None), (named_dir, None)], command="prepare"
    )

    assert [n.name for n in named] == ["esm2_650m", "prot_t5"]


def test_a_directory_of_files_from_different_models_is_refused(tmp_path):
    """The Embeddings notebook writes `{fasta}_{model}.h5` beside the FASTA, so
    two runs leave two models in one folder. Read as one input, the second
    model's vectors were dropped as duplicates under the folder's name."""
    mixed = tmp_path / "embdir"
    mixed.mkdir()
    _h5(mixed / "seqs_prot_t5.h5")
    _h5(mixed / "seqs_prost_t5.h5", seed=1)

    with pytest.raises(ValueError, match="different models") as exc:
        resolve_input_names([(mixed, None)], command="prepare")

    assert "seqs_prot_t5.h5 (prot_t5)" in str(exc.value)
    assert "seqs_prost_t5.h5 (prost_t5)" in str(exc.value)
    with pytest.raises(ValueError, match="different models"):
        load_h5(sorted(mixed.glob("*.h5")))


# --- The commands -----------------------------------------------------------------


def _pipeline_names(monkeypatch):
    from protspace.data.processors import pipeline

    seen = []
    monkeypatch.setattr(
        pipeline.ReductionPipeline,
        "run",
        lambda self, sets: seen.append([s.name for s in sets]),
    )
    return seen


def test_prepare_runs_on_one_unnamed_file(tmp_path, monkeypatch):
    seen = _pipeline_names(monkeypatch)
    path = _h5(tmp_path / "results.h5")
    result = CliRunner().invoke(
        app, ["prepare", "-i", str(path), "-o", str(tmp_path / "out"), "--no-log"]
    )
    assert result.exit_code == 0, result.output
    assert seen == [["results"]]


def test_prepare_refuses_two_unnamed_files_before_loading(tmp_path, monkeypatch):
    seen = _pipeline_names(monkeypatch)
    a, b = _h5(tmp_path / "a.h5"), _h5(tmp_path / "b.h5")
    result = CliRunner().invoke(
        app,
        ["prepare", "-i", str(a), "-i", str(b), "-o", str(tmp_path / "out")],
    )
    assert result.exit_code == 1
    assert f"protspace prepare -i {a}:<model> -i {b}:<model>" in plain(result.output)
    assert seen == []


def _project(tmp_path, *inputs: str, out: str = "proj") -> Path:
    result = CliRunner().invoke(
        app,
        [
            "project",
            *[a for i in inputs for a in ("-i", i)],
            "-m",
            "pca2",
            "-o",
            str(tmp_path / out),
        ],
    )
    assert result.exit_code == 0, result.output
    return tmp_path / out


def test_project_labels_one_unnamed_file_by_its_stem(tmp_path):
    proj = _project(tmp_path, str(_h5(tmp_path / "results.h5")))
    meta = pq.read_table(proj / "projections_metadata.parquet").to_pydict()
    assert meta["projection_name"] == ["results — PCA 2"]
    assert meta["source"] == ["results"]


def test_project_refuses_two_unnamed_files(tmp_path):
    a, b = _h5(tmp_path / "a.h5"), _h5(tmp_path / "b.h5")
    result = CliRunner().invoke(
        app, ["project", "-i", str(a), "-i", str(b), "-o", str(tmp_path / "proj")]
    )
    assert result.exit_code != 0
    assert f"protspace project -i {a}:<model> -i {b}:<model>" in plain(result.output)


@pytest.mark.parametrize(
    "inputs",
    [
        ("human_esm2_650m.h5", "mouse_esm2_650m.h5"),
        ("human.h5:esm2_650m", "mouse.h5:esm2_650m"),
    ],
    ids=["from-file-names", "explicit"],
)
def test_project_refuses_two_inputs_of_the_same_name(tmp_path, inputs):
    """project does not merge same-name inputs as prepare does; it used to reach
    the projection table with two header lists and crash with an IndexError."""
    for spec, n in zip(inputs, (40, 20), strict=True):
        _h5(tmp_path / spec.split(":")[0], n=n)
    result = CliRunner().invoke(
        app,
        [
            "project",
            *[a for spec in inputs for a in ("-i", str(tmp_path / spec))],
            "-o",
            str(tmp_path / "proj"),
        ],
    )
    assert result.exit_code != 0
    assert result.exception is None or isinstance(result.exception, SystemExit)
    output = plain(result.output)
    assert "share an embedding name" in output
    assert "protspace prepare" in output


def _stats(tmp_path, spec: str, proj: Path):
    return CliRunner().invoke(
        app,
        ["stats", "-i", spec, "-p", str(proj), "-o", str(tmp_path / "s.parquet"), "-v"],
    )


def test_stats_adopts_the_single_source_for_a_file_named_input(tmp_path):
    built = _h5(tmp_path / "built.h5")
    proj = _project(tmp_path, f"{built}:esm2_650m")
    renamed = tmp_path / "seqs.h5"
    renamed.write_bytes(built.read_bytes())

    result = _stats(tmp_path, str(renamed), proj)

    assert result.exit_code == 0, result.output
    assert "Naming" in result.output and "'esm2_650m'" in result.output
    meta = pq.read_table(proj / "projections_metadata.parquet").to_pydict()
    assert "quality" in json.loads(meta["info_json"][0])


def test_stats_refuses_a_file_named_input_matching_none_of_several_sources(tmp_path):
    built = _h5(tmp_path / "built.h5")
    proj = _project(tmp_path, f"{built}:prot_t5", f"{built}:esm2_650m")

    result = _stats(tmp_path, str(built), proj)

    assert result.exit_code != 0
    output = plain(result.output)
    assert "esm2_650m, prot_t5" in output
    assert "matches none of them" in output


def test_stats_leaves_an_explicit_name_alone(tmp_path):
    built = _h5(tmp_path / "built.h5")
    proj = _project(tmp_path, f"{built}:esm2_650m")

    result = _stats(tmp_path, f"{built}:custom", proj)

    assert result.exit_code == 0, result.output
    assert "Naming" not in result.output


def test_transfer_needs_no_embedding_name(tmp_path):
    from tests.test_transfer_cli import _write_bundle_and_h5

    bundle, h5_path = _write_bundle_and_h5(tmp_path)
    with h5py.File(h5_path, "a") as f:
        del f.attrs["model_name"]
    out = tmp_path / "out.parquetbundle"
    result = CliRunner().invoke(
        app,
        [
            "transfer",
            "-b",
            str(bundle),
            "-e",
            str(h5_path),
            "-t",
            "protein_category",
            "-o",
            str(out),
        ],
    )
    assert result.exit_code == 0, result.output
    assert out.exists()
