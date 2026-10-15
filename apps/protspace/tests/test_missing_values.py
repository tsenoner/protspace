"""One definition of a missing annotation value: the web reader's.

The web app reads a cell as N/A through ``normalizeMissingValue``
(``packages/utils/src/visualization/missing-values.ts``). ``is_missing_value``
mirrors it, and the bundle contract suite (``tests/contract``) pins the two to the
same tokens and the same matching. These tests hold every Python reader of
annotation cells to ``is_missing_value``, and every category the producer writes
to never being spelled like a missing value: tsenoner/protspace#339 was TMbed's
negative prediction, written as ``none``, shown as N/A.
"""

import ast
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pyarrow as pa
import pytest

from protspace.analysis.classification import Rule
from protspace.cli.transfer import run_transfer
from protspace.core.constants import (
    MISSING_VALUE_TOKENS,
    is_missing_value,
    standardize_missing,
)
from protspace.data.annotations.encoding import (
    ARROW_BOOLEAN_LABELS,
    CANONICAL_BOOLEANS,
)
from protspace.data.annotations.retrievers.biocentral_retriever import (
    BiocentralPredictionRetriever,
)
from protspace.data.annotations.transformers.interpro_transforms import (
    InterProTransformer,
)
from protspace.data.annotations.transformers.uniprot_transforms import (
    UniProtTransformer,
)
from protspace.data.io.bundle import read_settings_from_bundle, write_bundle
from protspace.data.io.settings_converter import NA_INTERNAL, NA_PINNED_COLOR
from protspace.data.parsers.uniprot_parser import UniProtEntry
from protspace.data.processors.base_processor import BaseProcessor
from protspace.stats.annotation_select import build_annotation_labels
from protspace.utils.add_annotation_style import (
    add_annotation_styles,
    generate_template,
)

PACKAGE = Path(__file__).resolve().parents[1] / "src" / "protspace"

# Cells the web shows as N/A. Before this module, each Python reader missed a
# different subset of them (the cased and padded spellings, `__NA__`, a null).
MISSING_CELLS = [
    None,
    float("nan"),
    "",
    "  ",
    "N/A",
    "n/a",
    "NULL",
    "None",
    "NaN",
    " na ",
    "__NA__",
]
# Cells that are categories on both sides, some of them close to a token.
PRESENT_CELLS = ["A", "0", "False", "non-transmembrane", "nan%", "N/A;B", "unknown"]


# ---------------------------------------------------------------------------
# The definition itself
# ---------------------------------------------------------------------------


def test_tokens_are_stored_the_way_the_web_compares_them():
    # The web trims and lower-cases the cell before the lookup, and handles a
    # blank cell on its own, so an entry in any other shape could never match.
    assert MISSING_VALUE_TOKENS
    for token in MISSING_VALUE_TOKENS:
        assert token and token == token.strip().lower(), token


@pytest.mark.parametrize("value", MISSING_CELLS, ids=repr)
def test_a_missing_cell_is_missing(value):
    assert is_missing_value(value)


@pytest.mark.parametrize("value", PRESENT_CELLS, ids=repr)
def test_a_category_is_present(value):
    assert not is_missing_value(value)


@pytest.mark.parametrize(
    ("value", "missing"),
    [
        (float("inf"), True),
        (-float("inf"), True),
        (np.float32("nan"), True),
        (np.float64(1.5), False),
        (0, False),
        (np.int64(7), False),
        (False, False),
        (True, False),
    ],
    ids=repr,
)
def test_numbers_are_missing_only_when_not_finite(value, missing):
    # normalizeMissingValue: a number is missing when it is NaN or ±Infinity.
    assert is_missing_value(value) is missing


# ---------------------------------------------------------------------------
# Every Python reader of annotation cells agrees with it
# ---------------------------------------------------------------------------


def test_the_dash_plot_shows_every_missing_cell_as_na():
    cells = pd.Series(MISSING_CELLS + PRESENT_CELLS, dtype=object)

    shown = standardize_missing(cells).tolist()

    assert shown[: len(MISSING_CELLS)] == ["<N/A>"] * len(MISSING_CELLS)
    assert shown[len(MISSING_CELLS) :] == PRESENT_CELLS


def test_stats_leaves_every_missing_cell_out_of_the_categories():
    cells = MISSING_CELLS + ["a", "b", "a", "b"]
    frame = pd.DataFrame(
        {
            "identifier": [f"p{i}" for i in range(len(cells))],
            "group": pd.Series(cells, dtype=object),
        }
    )

    labels = build_annotation_labels(frame, ["group"])["group"]

    assert sorted(labels.values()) == ["a", "a", "b", "b"]


def test_transfer_fills_every_missing_cell_and_never_copies_one():
    # Each spelled-missing protein sits on the others, far from the only real
    # reference. Read as a category, one would be a reference for the rest and
    # hand them its spelling as a label.
    spelled = ["N/A", "NULL", "None", " na ", "__NA__", "n/a"]
    ids = [f"Q{i}" for i in range(len(spelled))] + ["R"]
    annotations = pa.table({"identifier": ids, "family": [*spelled, "neurotoxin"]})
    embeddings = {qid: np.zeros(2, dtype=np.float32) for qid in ids[:-1]}
    embeddings["R"] = np.array([5.0, 0.0], dtype=np.float32)

    out = run_transfer(
        annotations=annotations,
        embeddings=embeddings,
        transfer_columns=["family"],
        query_rule=Rule(),
        reference_rule=Rule(),
        k=1,
        metric="euclidean",
    )

    rows = {row["identifier"]: row for row in out.to_pylist()}
    for qid in ids[:-1]:
        assert rows[qid]["family__pred_value"] == "neurotoxin", qid
        assert rows[qid]["family__pred_source"] == "R", qid


def _bundle(tmp_path, organism: list, settings: dict | None = None) -> Path:
    ids = [f"P{i}" for i in range(len(organism))]
    tables = BaseProcessor({}, {}).create_output(
        pd.DataFrame({"identifier": ids, "organism": organism}),
        [
            {
                "name": "PCA_2",
                "dimensions": 2,
                "info": {},
                "data": np.zeros((len(ids), 2)),
            }
        ],
        ids,
    )
    path = tmp_path / "in.parquetbundle"
    write_bundle(
        [
            tables["protein_annotations"],
            tables["projections_metadata"],
            tables["projections_data"],
        ],
        path,
        settings=settings,
    )
    return path


def _styled(bundle: Path, styles: dict) -> dict:
    """The `organism` settings `protspace style` writes for *styles*."""
    out = bundle.with_name("styled.parquetbundle")
    add_annotation_styles(str(bundle), {"organism": styles}, str(out))
    return read_settings_from_bundle(out)["organism"]


@pytest.mark.parametrize(
    ("cell", "key"),
    [("N/A", "N/A"), ("null", NA_INTERNAL), ("none", "none"), (None, "N/A")],
    ids=["N/A-as-itself", "null-as-__NA__", "none-as-itself", "null-cell-as-N/A"],
)
def test_style_puts_an_na_colour_on_the_web_na_category(tmp_path, cell, key):
    # The web draws every missing cell as one legend entry and looks its style
    # up under __NA__; a style stored under the cell's own spelling never applies.
    bundle = _bundle(tmp_path, ["A", cell, "B", "A"])

    settings = _styled(bundle, {"colors": {key: "#FF0000", "A": "#00FF00"}})

    assert settings["categories"].keys() == {"A", NA_INTERNAL}
    assert settings["categories"][NA_INTERNAL]["color"] == "#FF0000"


@pytest.mark.parametrize("key", [NA_INTERNAL, "N/A", ""])
def test_restyling_na_replaces_the_stored_colour(tmp_path, key):
    stored = {
        "categories": {
            NA_INTERNAL: {"color": "#111111", "shape": "circle", "zOrder": 1},
            "A": {"color": "#00FF00", "shape": "circle", "zOrder": 0},
        }
    }
    bundle = _bundle(tmp_path, ["A", None, "A"], settings={"organism": stored})

    settings = _styled(bundle, {"colors": {key: "#FF0000"}})

    assert settings["categories"][NA_INTERNAL]["color"] == "#FF0000"


def test_style_hides_and_pins_na_by_any_spelling(tmp_path):
    bundle = _bundle(tmp_path, ["A", "N/A", "B", "A", "none"])

    settings = _styled(
        bundle,
        {
            "sortMode": "manual",
            "maxVisibleValues": 2,
            "pinnedValues": ["A", "N/A", "none"],
            "hiddenValues": ["N/A", "", "none"],
        },
    )

    assert settings["hiddenValues"] == [NA_INTERNAL]
    categories = settings["categories"]
    assert categories.keys() == {"A", NA_INTERNAL}
    assert categories[NA_INTERNAL]["zOrder"] == 1
    assert categories[NA_INTERNAL]["color"] == NA_PINNED_COLOR


def test_style_template_lists_na_once(tmp_path):
    template = generate_template(str(_bundle(tmp_path, ["A", None, "N/A", "null"])))

    assert list(template["organism"]["colors"]) == ["A", NA_INTERNAL]


# ---------------------------------------------------------------------------
# No producer writes a category spelled like a missing value
# ---------------------------------------------------------------------------


def _tmbed(topology: str) -> list:
    return [SimpleNamespace(model_name="TMbed", value=topology)]


# One TMbed topology per branch: helix, barrel, both, no membrane segment, and a
# signal peptide.
TMBED_TOPOLOGIES = ("ooHHHHoo", "ooBBBBoo", "oHHHoBBBo", "ooooiiii", "SSSSoooo")

# Every fixed vocabulary, produced by running its producer on inputs that each
# carry a definite answer, so a renamed category is caught without this file
# repeating the name.
PRODUCER_VOCABULARIES = {
    "predicted_transmembrane (TMbed)": {
        BiocentralPredictionRetriever._extract_transmembrane(_tmbed(t))
        for t in TMBED_TOPOLOGIES
    },
    "predicted_signal_peptide (TMbed)": {
        BiocentralPredictionRetriever._extract_signal_peptide(_tmbed(t))
        for t in TMBED_TOPOLOGIES
    },
    "signal_peptide (InterPro)": {
        InterProTransformer.transform_signal_peptide(v)
        for v in ("SIGNAL_PEPTIDE", "", "TRANSMEMBRANE")
    },
    "xref_pdb": {UniProtTransformer.transform_xref_pdb(v) for v in ("1ABC;2XYZ", "")},
    "fragment": {UniProtTransformer.transform_fragment("fragment")},
    "reviewed": {
        UniProtEntry({"entryType": t}).reviewed
        for t in ("UniProtKB reviewed (Swiss-Prot)", "UniProtKB unreviewed (TrEMBL)")
    },
    "boolean labels": {*CANONICAL_BOOLEANS, *ARROW_BOOLEAN_LABELS},
}


@pytest.mark.parametrize(
    "values", PRODUCER_VOCABULARIES.values(), ids=PRODUCER_VOCABULARIES.keys()
)
def test_no_producer_category_reads_as_missing(values):
    for value in values:
        # A definite prediction is never written as the blank missing value...
        assert value.strip(), values
        # ...nor as a cell, or a hit of a multi-hit cell, the web shows as N/A.
        for hit in (value, *value.split(";")):
            assert not is_missing_value(hit), f"{hit!r} reads as missing"


# Where the producer's annotation values are written. A string literal spelled
# like a missing value has no business here: a missing value is written as "".
PRODUCER_PACKAGES = ("data/annotations", "data/parsers")


def _missing_literals(path: Path):
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and node.value.strip()
            and is_missing_value(node.value)
        ):
            yield node.lineno, node.value


def test_no_producer_module_spells_a_missing_value():
    paths = [
        path
        for package in PRODUCER_PACKAGES
        for path in sorted((PACKAGE / package).rglob("*.py"))
    ]
    # A moved package would otherwise scan nothing and pass.
    assert {p.relative_to(PACKAGE).parts[1] for p in paths} == {
        "annotations",
        "parsers",
    }

    found = [
        f"{path.relative_to(PACKAGE)}:{line}: {value!r}"
        for path in paths
        for line, value in _missing_literals(path)
    ]

    assert not found, "the web shows these as N/A:\n" + "\n".join(found)
