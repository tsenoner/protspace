"""Unit tests for scripts/generate_toxprot_demo.py."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

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
