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
    # The reference rule deliberately matches P00002 as well: if P00001 were its
    # only match, precedence would empty the reference set and the run would be a
    # no-op, which is now its own error (see the explicit-rule tests below).
    q = Rule(id_prefixes=["P00001"])
    r = Rule(id_prefixes=["P0"])
    qi, ri = classify(_table(), q, r)
    assert 2 in qi
    assert 2 not in ri
    assert ri == [3]


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


def test_protein_matching_neither_rule_is_excluded():
    # P00002 / enzyme matches neither rule -> absent from both lists.
    q = Rule(id_prefixes=["TRINITY_"])
    r = Rule(where=[("protein_category", "neurotoxin")])
    qi, ri = classify(_table(), q, r)
    assert 3 not in qi
    assert 3 not in ri


def test_multiple_id_prefixes_use_or_semantics():
    q = Rule(id_prefixes=["TRINITY_", "P00001"])
    r = Rule(id_prefixes=["P00002"])
    qi, ri = classify(_table(), q, r)
    assert qi == [0, 1, 2]
    assert ri == [3]


# ── Open (unrestricted) rules ──────────────────────────────────────────────
#
# A rule with no clauses means "no restriction", not "match nothing". Both
# rules open is the self-transfer case (#393): every protein is a candidate on
# both sides, and `run_transfer` does the real partitioning per column on
# missing-vs-present, which is why the candidate sets are allowed to overlap.


def test_both_rules_open_makes_every_protein_a_candidate_on_both_sides():
    qi, ri = classify(_table(), Rule(), Rule())
    assert qi == [0, 1, 2, 3]
    assert ri == [0, 1, 2, 3]


def test_open_reference_rule_does_not_starve_references():
    # Query rule is explicit; an open reference rule must still offer EVERY protein
    # as a reference instead of returning an empty set — the query-matched ones
    # included, since `run_transfer`'s per-column missing-vs-present split is what
    # actually keeps the two sets disjoint.
    qi, ri = classify(_table(), Rule(id_prefixes=["TRINITY_"]), Rule())
    assert qi == [0, 1]
    assert ri == [0, 1, 2, 3]


def test_open_query_rule_does_not_starve_queries():
    qi, ri = classify(_table(), Rule(), Rule(id_prefixes=["P0"]))
    assert qi == [0, 1, 2, 3]
    assert ri == [2, 3]


def test_open_rule_does_not_consume_proteins_from_the_other_set():
    # The precedence rule applies only between two explicit rules. An open
    # rule that "matches" a protein must not remove it from the other set.
    _, ri = classify(_table(), Rule(), Rule(id_prefixes=["TRINITY_"]))
    assert ri == [0, 1]


def test_open_query_rule_on_empty_table_raises_a_rule_free_message():
    # An open rule cannot "match nothing" — it is the whole table — so the empty
    # table must blame neither side's filters.
    empty = pa.table({"identifier": [], "protein_category": []})
    with pytest.raises(ValueError, match="no proteins to use as queries"):
        classify(empty, Rule(), Rule())


# ── An explicit rule that matches nothing is an error, on either side ───────
#
# The query side always raised. The reference side used to return an empty set,
# which `run_transfer` turned into "skip every column" and the CLI into exit 0
# with the bundle written back unchanged — the same silent no-op #393 removed
# on the query side.


def test_explicit_reference_rule_matching_nothing_raises():
    with pytest.raises(ValueError, match="no reference proteins"):
        classify(_table(), Rule(), Rule(id_prefixes=["NOPE_"]))


def test_explicit_reference_rule_matching_nothing_raises_beside_a_query_rule():
    with pytest.raises(ValueError, match="no reference proteins"):
        classify(_table(), Rule(id_prefixes=["TRINITY_"]), Rule(id_prefixes=["NOPE_"]))


def test_query_rule_swallowing_every_reference_raises():
    # Both rules explicit and matching the same proteins: precedence hands them
    # all to the query set, leaving no references. Naming that beats exiting 0.
    with pytest.raises(ValueError, match="no reference proteins"):
        classify(_table(), Rule(id_prefixes=["P0"]), Rule(id_prefixes=["P0"]))
