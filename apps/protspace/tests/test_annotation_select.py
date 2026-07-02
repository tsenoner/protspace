import pandas as pd
import pytest

from protspace.stats.annotation_select import (
    build_annotation_labels,
    suitable_annotations,
)


def _frame():
    return pd.DataFrame(
        {
            "identifier": [f"p{i}" for i in range(6)],
            "major_group": ["a", "a", "b", "b", "c", "c"],  # suitable (3 cats)
            "all_unique": [f"u{i}" for i in range(6)],  # unsuitable (all unique)
            "constant": ["x"] * 6,  # unsuitable (1 cat)
            "count": [1, 2, 3, 4, 5, 6],  # unsuitable (numeric)
            "cluster_elbow_P": ["cluster 0"] * 3 + ["cluster 1"] * 3,  # excluded
        }
    )


def test_suitable_annotations_filters():
    names = suitable_annotations(_frame())
    assert names == ["major_group"]


def test_build_labels_auto():
    labels = build_annotation_labels(_frame(), "auto")
    assert set(labels) == {"major_group"}
    assert labels["major_group"]["p0"] == "a"
    assert len(labels["major_group"]) == 6


def test_build_labels_explicit_names_and_missing_dropped():
    frame = _frame()
    frame.loc[0, "major_group"] = "<NaN>"  # sentinel missing
    frame.loc[1, "major_group"] = ""  # empty
    labels = build_annotation_labels(frame, ["major_group"])
    assert "p0" not in labels["major_group"]  # <NaN> dropped
    assert "p1" not in labels["major_group"]  # empty dropped
    assert labels["major_group"]["p2"] == "b"


def test_build_labels_unknown_name_skipped():
    labels = build_annotation_labels(_frame(), ["does_not_exist"])
    assert labels == {}
