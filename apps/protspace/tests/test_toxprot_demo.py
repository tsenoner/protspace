"""Unit tests for scripts/generate_toxprot_demo.py."""

from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

# Load the script as a module so tests can import its helpers.
SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "generate_toxprot_demo.py"
spec = importlib.util.spec_from_file_location("generate_toxprot_demo", SCRIPT_PATH)
toxprot_demo = importlib.util.module_from_spec(spec)
sys.modules["generate_toxprot_demo"] = toxprot_demo
spec.loader.exec_module(toxprot_demo)


def _write_tsv(path: Path, rows: list[dict]) -> Path:
    cols = ["Entry", "Sequence", "Signal peptide"]
    with path.open("w") as f:
        f.write("\t".join(cols) + "\n")
        for row in rows:
            f.write("\t".join(row.get(c, "") for c in cols) + "\n")
    return path


def test_parse_signal_peptides_keeps_only_clean_bounds(tmp_path):
    tsv = _write_tsv(
        tmp_path / "in.tsv",
        [
            {
                "Entry": "P1",
                "Sequence": "MMMAAA",
                "Signal peptide": 'SIGNAL 1..3; /evidence="X"',
            },
            {"Entry": "P2", "Sequence": "MMMAAA", "Signal peptide": ""},
            {"Entry": "P3", "Sequence": "MMMAAA", "Signal peptide": "SIGNAL ?..30"},
            {"Entry": "P4", "Sequence": "MMMAAA", "Signal peptide": "SIGNAL <1..25"},
            {"Entry": "P5", "Sequence": "MMMAAA", "Signal peptide": "SIGNAL >20..30"},
        ],
    )
    sp_map = toxprot_demo.parse_signal_peptides(tsv)
    assert sp_map == {"P1": 3}


def test_parse_signal_peptides_skips_multiple_features(tmp_path):
    tsv = _write_tsv(
        tmp_path / "in.tsv",
        [
            {
                "Entry": "P1",
                "Sequence": "MMM",
                "Signal peptide": "SIGNAL 1..3; SIGNAL 5..10",
            }
        ],
    )
    assert toxprot_demo.parse_signal_peptides(tsv) == {}


def test_parse_signal_peptides_keeps_sp_with_freetext_uncertainty(tmp_path):
    """Spec: only the *bounds* should trigger uncertain-skip.

    UniProt notes can include `?`, `<`, `>` in evidence/comment fields. Those
    must not poison a cleanly-bounded SP record.
    """
    tsv = _write_tsv(
        tmp_path / "in.tsv",
        [
            {
                "Entry": "P1",
                "Sequence": "MMMAAA",
                "Signal peptide": 'SIGNAL 1..23; /evidence="ECO:0000269"; /note="confidence > 99%"',
            },
        ],
    )
    assert toxprot_demo.parse_signal_peptides(tsv) == {"P1": 23}


def test_write_mature_fasta_strips_correctly(tmp_path):
    tsv = _write_tsv(
        tmp_path / "in.tsv",
        [
            {"Entry": "P1", "Sequence": "AAABBBCCC", "Signal peptide": "SIGNAL 1..3"},
            {"Entry": "P2", "Sequence": "XYZ", "Signal peptide": ""},
        ],
    )
    out = tmp_path / "mature.fasta"
    sp_map = {"P1": 3}
    lengths = toxprot_demo.write_mature_fasta(tsv, sp_map, out)

    assert lengths == {"P1": 6, "P2": 3}
    text = out.read_text()
    assert ">P1\nBBBCCC" in text
    assert ">P2\nXYZ" in text


def _make_synthetic_bundle(path: Path, settings: dict | None = None) -> Path:
    from protspace.data.io.bundle import write_bundle

    annotations = pa.table(
        {
            "protein_id": ["P1", "P2"],
            "length": [100, 200],
            "ec": ["3.4.21.-", "__NA__"],
            "signal_peptide": ["yes", ""],
            "protein_families": ["fam_a", "fam_b"],
        }
    )
    metadata = pa.table(
        {
            "projection_name": ["PCA_2"],
            "dimensions": [2],
            "info_json": ["{}"],
        }
    )
    data = pa.table(
        {
            "projection_name": ["PCA_2", "PCA_2"],
            "identifier": ["P1", "P2"],
            "x": [0.0, 1.0],
            "y": [0.0, 1.0],
        }
    )
    write_bundle([annotations, metadata, data], path, settings=settings)
    return path


def test_postprocess_bundle_replaces_length_drops_extras_and_reorders(tmp_path):
    from protspace.data.io.bundle import read_bundle

    target = _make_synthetic_bundle(tmp_path / "target.parquetbundle")
    source_settings = {"pfam": {"sortMode": "manual", "categories": {}}}
    source = _make_synthetic_bundle(
        tmp_path / "source.parquetbundle", settings=source_settings
    )

    toxprot_demo.postprocess_bundle(
        bundle_path=target,
        mature_lengths={"P1": 50, "P2": 150},
        source_settings_bundle=source,
    )

    parts, settings = read_bundle(target)
    annotations = pq.read_table(io.BytesIO(parts[0]))
    pyd = annotations.to_pydict()
    assert pyd["protein_id"] == ["P1", "P2"]
    assert pyd["length"] == [50, 150]
    # Drop list applied: signal_peptide removed.
    assert "signal_peptide" not in annotations.column_names
    # Reorder applied: protein_families is the first non-id column.
    assert annotations.column_names[:2] == ["protein_id", "protein_families"]
    # Settings preserved when there's nothing to restyle (synthetic bundle has
    # no `pfam` column).
    assert settings == source_settings


def test_drop_and_reorder_columns_filters_and_orders():
    table = pa.table(
        {
            # Out of order, with an unwanted column in the middle.
            "ec": ["a"],
            "signal_peptide": ["x"],
            "length": [1],
            "protein_id": ["P1"],
            "protein_families": ["fam"],
        }
    )
    out = toxprot_demo._drop_and_reorder_columns(table)
    assert out.column_names == [
        "protein_id",
        "protein_families",
        "ec",
        "length",
    ]


def test_extract_categories_splits_and_cleans():
    extract = toxprot_demo._extract_categories
    # Confidence scores after `|` are stripped.
    assert extract("PF21947 (Toxin_cobra-type)|41.8") == ["PF21947 (Toxin_cobra-type)"]
    # `;` separates multiple values; each value's `|score` is stripped.
    assert extract("1.10.405.10|625.3;3.50.50.60 (FAD)|625.3") == [
        "1.10.405.10",
        "3.50.50.60 (FAD)",
    ]
    # Evidence-code suffix (e.g. "EXP") also stripped.
    assert extract("1.4.3.2 (L-amino-acid oxidase)|EXP") == [
        "1.4.3.2 (L-amino-acid oxidase)"
    ]
    # Empty / NA cells yield no categories.
    assert extract("") == []
    assert extract(None) == []
    assert extract("__NA__") == []


def test_restyle_settings_recomputes_top_categories():
    # 3× "PF_A", 2× "PF_B", 1× "PF_C", 1 NA.
    annotations = pa.table(
        {
            "protein_id": ["P1", "P2", "P3", "P4", "P5", "P6", "P7"],
            "pfam": [
                "PF_A|10",
                "PF_A|11",
                "PF_A|12",
                "PF_B|10",
                "PF_B|10",
                "PF_C|10",
                "",
            ],
        }
    )
    template = {
        "sortMode": "manual",
        "selectedPaletteId": "kellys",
        "categories": {"old_label": {"zOrder": 0, "color": "#000", "shape": "circle"}},
    }
    new = toxprot_demo._restyle_settings(annotations, {"pfam": template})
    cats = new["pfam"]["categories"]

    # Old categories wiped, new ones in frequency order.
    assert "old_label" not in cats
    assert cats["PF_A"]["zOrder"] == 0
    assert cats["PF_A"]["color"] == toxprot_demo.KELLYS_PALETTE[0]
    assert cats["PF_B"]["zOrder"] == 1
    assert cats["PF_C"]["zOrder"] == 2
    # __NA__ pinned at zOrder 9 because there's at least one empty cell.
    assert cats["__NA__"]["zOrder"] == len(toxprot_demo.KELLYS_PALETTE)
    assert cats["__NA__"]["color"] == toxprot_demo.NA_COLOR
    # Other template metadata passes through.
    assert new["pfam"]["sortMode"] == "manual"
    assert new["pfam"]["selectedPaletteId"] == "kellys"


def test_restyle_settings_preserves_protein_families():
    annotations = pa.table(
        {
            "protein_id": ["P1"],
            "protein_families": ["something|else"],
            "pfam": ["PF_A"],
        }
    )
    pf_settings = {
        "sortMode": "manual",
        "categories": {
            "hand_curated": {"zOrder": 0, "color": "#abc", "shape": "circle"}
        },
    }
    pfam_template = {"sortMode": "manual", "categories": {}}
    new = toxprot_demo._restyle_settings(
        annotations, {"protein_families": pf_settings, "pfam": pfam_template}
    )
    # protein_families left untouched.
    assert new["protein_families"] == pf_settings
    # pfam recomputed.
    assert "PF_A" in new["pfam"]["categories"]
