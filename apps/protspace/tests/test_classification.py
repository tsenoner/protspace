"""Tests for the query/reference classifier."""

import pyarrow as pa
import pytest

from protspace.analysis.classification import Rule, classify


def _table():
    return pa.table(
        {
            "identifier": ["TRINITY_1", "TRINITY_2", "P00001", "P00002"],
            "protein_category": ["mSCR", "mSCR", "neurotoxin", "enzyme"],
        }
    )


def test_prefix_rule_selects_queries():
    q = Rule(id_prefixes=["TRINITY_"])
    r = Rule(where=[("protein_category", "neurotoxin")])
    qi, ri = classify(_table(), q, r)
    assert qi == [0, 1]
    assert ri == [2]


def test_where_substring_is_case_insensitive():
    q = Rule(where=[("protein_category", "MSCR")])
    r = Rule(id_prefixes=["P0"])
    qi, ri = classify(_table(), q, r)
    assert qi == [0, 1]
    assert ri == [2, 3]


def test_query_takes_precedence_over_reference():
    # A protein matching both rules is classified as a query, never a reference.
    q = Rule(id_prefixes=["P00001"])
    r = Rule(where=[("protein_category", "neurotoxin")])
    qi, ri = classify(_table(), q, r)
    assert 2 in qi
    assert 2 not in ri


def test_empty_query_match_raises():
    q = Rule(id_prefixes=["NOPE_"])
    r = Rule(id_prefixes=["P0"])
    with pytest.raises(ValueError, match="no query"):
        classify(_table(), q, r)


def test_missing_where_column_raises():
    q = Rule(where=[("not_a_column", "x")])
    r = Rule(id_prefixes=["P0"])
    with pytest.raises(KeyError):
        classify(_table(), q, r)
