"""Classify proteins as transfer queries vs annotated references.

Rules match by ID prefix and/or a case-insensitive metadata substring
(``column ~ substring``). No biology is hardcoded; an *explicit* rule that
matches nothing is an error, on either side.

A rule with no clauses is **open** — it restricts nothing and matches every
protein. Passing no rules at all therefore means "transfer within this
dataset": every protein is a candidate on both sides, and the caller splits
them per column into the ones missing a value (queries) and the ones holding
one (references).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pyarrow as pa


@dataclass
class Rule:
    """A classification rule. A protein matches if ANY clause matches.

    A rule with no clauses at all is *open*: it expresses "no restriction"
    rather than "match nothing" (see ``is_open``).
    """

    id_prefixes: list[str] = field(default_factory=list)
    where: list[tuple[str, str]] = field(default_factory=list)  # (column, substring)

    @property
    def is_open(self) -> bool:
        """True when the rule carries no clauses, so it matches every protein."""
        return not self.id_prefixes and not self.where


def _matches_explicit(
    rule: Rule, identifier: str, column_data: dict[str, list], i: int
) -> bool:
    """Match an *explicit* rule. Open rules must never be passed here: with no
    clauses to iterate this returns ``False``, the opposite of what they mean."""
    if any(identifier.startswith(p) for p in rule.id_prefixes):
        return True
    for column, substring in rule.where:
        value = column_data[column][i]
        if value is not None and substring.lower() in str(value).lower():
            return True
    return False


def _select(
    rule: Rule, identifiers: list[str], column_data: dict[str, list]
) -> list[int]:
    """Indices of the proteins matching an *explicit* rule."""
    return [
        i
        for i, identifier in enumerate(identifiers)
        if _matches_explicit(rule, identifier, column_data, i)
    ]


def classify(
    annotations: pa.Table,
    query_rule: Rule,
    reference_rule: Rule,
    *,
    identifiers: list[str] | None = None,
) -> tuple[list[int], list[int]]:
    """Return (query_indices, reference_indices) into the annotations table.

    Between two *explicit* rules, query classification takes precedence: a
    protein matching both is a query and never a reference. An **open** rule
    (no clauses) expresses no preference, so it never takes a protein away from
    the other set — which is what lets both sets cover the whole table when no
    rules are given. The two lists may therefore overlap; callers are expected
    to make the final, disjoint split themselves (``run_transfer`` does it per
    column on missing-vs-present).

    Raises ValueError if an explicit rule matches nothing — on either side,
    since an empty set on either makes the transfer a silent no-op.

    ``identifiers`` may be a pre-materialized list of the string identifier
    column (same order as ``annotations``) to avoid re-materializing it when the
    caller already has it.
    """
    columns = set(annotations.column_names)
    # Validate where-columns up front so an empty table still raises KeyError.
    for rule in (query_rule, reference_rule):
        for column, _ in rule.where:
            if column not in columns:
                raise KeyError(f"Classification column {column!r} not in annotations")

    # An open rule needs no row-by-row test: its answer is the whole table. Only
    # when BOTH rules are explicit does precedence have anything to arbitrate —
    # if either side is open it expresses no preference, so it must not consume
    # proteins away from the other set. (Otherwise two open rules would hand
    # every protein to the query list and leave references empty, and transfer
    # would silently do nothing.)
    #
    # With both rules open — the self-transfer default — nothing is matched on
    # either side, so answer from the row count alone rather than materializing
    # every identifier as a Python str (~570k entries at Swiss-Prot scale).
    if query_rule.is_open and reference_rule.is_open:
        every = list(
            range(annotations.num_rows if identifiers is None else len(identifiers))
        )
        query_indices, reference_indices = every, list(every)
    else:
        # Materialize only the columns the rules actually need (identifier + any
        # where-columns) instead of the whole table — the latter is ~GB-scale at
        # Swiss-Prot row counts.
        if identifiers is None:
            identifiers = [str(v) for v in annotations.column("identifier").to_pylist()]
        where_columns = {
            column for rule in (query_rule, reference_rule) for column, _ in rule.where
        }
        column_data = {c: annotations.column(c).to_pylist() for c in where_columns}

        if query_rule.is_open:
            query_indices = list(range(len(identifiers)))
            reference_indices = _select(reference_rule, identifiers, column_data)
        elif reference_rule.is_open:
            query_indices = _select(query_rule, identifiers, column_data)
            reference_indices = list(range(len(identifiers)))
        else:
            # Both explicit: a protein matching both is a query and never a reference.
            # The elif is what keeps this to one _matches_explicit call for most rows.
            query_indices, reference_indices = [], []
            for i, identifier in enumerate(identifiers):
                if _matches_explicit(query_rule, identifier, column_data, i):
                    query_indices.append(i)
                elif _matches_explicit(reference_rule, identifier, column_data, i):
                    reference_indices.append(i)

    if not query_indices:
        if query_rule.is_open:
            # Nothing to blame on the rules — the table itself is empty.
            raise ValueError("Classifier found no proteins to use as queries.")
        raise ValueError(
            "Classifier matched no query proteins; check --query-id-prefix / "
            "--query-where rules."
        )
    # Same rule on the reference side: an explicit rule selecting nobody makes the
    # whole run a no-op, since `run_transfer` then skips every column and writes
    # the bundle back unchanged.
    if not reference_indices and not reference_rule.is_open:
        raise ValueError(
            "Classifier matched no reference proteins; check --reference-id-prefix "
            "/ --reference-where rules. A protein matching both rules counts as a "
            "query, so an over-broad query rule can empty the reference set too."
        )
    return query_indices, reference_indices
