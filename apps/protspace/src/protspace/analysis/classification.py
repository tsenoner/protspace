"""Classify proteins as transfer queries vs annotated references.

Rules match by ID prefix and/or a case-insensitive metadata substring
(``column ~ substring``). No biology is hardcoded; a query rule that matches
nothing is an error.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pyarrow as pa


@dataclass
class Rule:
    """A classification rule. A protein matches if ANY clause matches."""

    id_prefixes: list[str] = field(default_factory=list)
    where: list[tuple[str, str]] = field(default_factory=list)  # (column, substring)


def _matches(rule: Rule, identifier: str, row: dict[str, str]) -> bool:
    if any(identifier.startswith(p) for p in rule.id_prefixes):
        return True
    for column, substring in rule.where:
        if column not in row:
            raise KeyError(f"Classification column {column!r} not in annotations")
        value = row[column]
        if value is not None and substring.lower() in str(value).lower():
            return True
    return False


def classify(
    annotations: pa.Table, query_rule: Rule, reference_rule: Rule
) -> tuple[list[int], list[int]]:
    """Return (query_indices, reference_indices) into the annotations table.

    Query classification takes precedence: a protein matching both rules is a
    query. Raises ValueError if the query rule matches nothing.
    """
    columns = set(annotations.column_names)
    # Validate where-columns up front so an empty table still raises KeyError.
    for rule in (query_rule, reference_rule):
        for column, _ in rule.where:
            if column not in columns:
                raise KeyError(f"Classification column {column!r} not in annotations")

    rows = annotations.to_pylist()
    identifiers = [str(r["identifier"]) for r in rows]

    query_indices: list[int] = []
    reference_indices: list[int] = []
    for i, (identifier, row) in enumerate(zip(identifiers, rows, strict=True)):
        if _matches(query_rule, identifier, row):
            query_indices.append(i)
        elif _matches(reference_rule, identifier, row):
            reference_indices.append(i)

    if not query_indices:
        raise ValueError(
            "Classifier matched no query proteins; check --query-id-prefix / "
            "--query-where rules."
        )
    return query_indices, reference_indices
