"""protspace transfer — fill missing annotation values from nearest references.

Embedding Annotation Transfer (EAT): for each query protein with a missing
value in a target column, transfer the value of its nearest annotated
reference in pLM embedding space, with a reliability-index confidence.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, get_args

import numpy as np
import pyarrow as pa
import typer

from protspace.cli.app import app, setup_logging
from protspace.cli.common_options import Opt_Verbose
from protspace.core.constants import MISSING_VALUE_TOKENS
from protspace.utils.constants import METRIC_TYPES

if TYPE_CHECKING:
    from protspace.analysis.classification import Rule

logger = logging.getLogger(__name__)

# Reuse the shared missing-value vocabulary ("", "nan", "none", "null", "NA",
# "NaN") so transfer's notion of "missing" can't drift from the rest of
# protspace.  This also makes a real float NaN missing (``str(nan) == "nan"``),
# which a bare ``== ""`` check would treat as a present value.
_MISSING = frozenset(MISSING_VALUE_TOKENS)


def _is_missing(value) -> bool:
    return value is None or str(value).strip() in _MISSING


def run_transfer(
    *,
    annotations: pa.Table,
    embeddings: dict[str, np.ndarray],
    transfer_columns: list[str],
    query_rule: Rule,
    reference_rule: Rule,
    k: int = 1,
    metric: str = "cosine",
) -> pa.Table:
    """Pure core: classify, transfer per column, return the augmented table.

    ``embeddings`` maps protein id -> 1-D float32 vector. Proteins without an
    embedding cannot act as queries or references.
    """
    from protlabel import eat
    from protspace.analysis.classification import classify
    from protspace.data.io.predictions import add_overlay_columns

    # Full-table identifiers, materialized once: reused both for the has-embedding
    # filter and for aligning every column's overlay (invariant across columns).
    all_ids = [str(v) for v in annotations.column("identifier").to_pylist()]

    # Restrict classification to proteins that actually have an embedding.
    has_emb = pa.array([i in embeddings for i in all_ids])
    embedded = annotations.filter(has_emb)

    if embedded.num_rows == 0:
        raise ValueError(
            "No proteins in the bundle have a matching embedding "
            "(check that the --embeddings ids match the bundle identifiers)."
        )

    # Materialize the embedded id column once (not the whole table); per-column
    # values are pulled inside the loop. Avoids GB-scale Python lists at
    # Swiss-Prot size, and is reused by both classify() and the transfer loop.
    id_list = [str(v) for v in embedded.column("identifier").to_pylist()]
    query_idx, ref_idx = classify(
        embedded, query_rule, reference_rule, identifiers=id_list
    )

    out = annotations
    total_transferred = 0
    for column in transfer_columns:
        if column not in annotations.column_names:
            raise KeyError(f"Transfer column {column!r} not in annotations table")

        col_vals = embedded.column(column).to_pylist()

        # References: classified refs that HAVE a value in this column.
        ref_ids, ref_labels, ref_vecs = [], [], []
        for i in ref_idx:
            value = col_vals[i]
            if not _is_missing(value):
                rid = id_list[i]
                ref_ids.append(rid)
                ref_labels.append(str(value))
                ref_vecs.append(embeddings[rid])
        if not ref_ids:
            logger.warning("No references with a value for %r; skipping", column)
            continue

        # Queries: classified queries MISSING a value in this column.
        q_ids, q_vecs = [], []
        for i in query_idx:
            if _is_missing(col_vals[i]):
                qid = id_list[i]
                q_ids.append(qid)
                q_vecs.append(embeddings[qid])
        if not q_ids:
            logger.warning("No queries missing %r; nothing to transfer", column)
            continue

        preds = eat(
            np.vstack(q_vecs),
            q_ids,
            np.vstack(ref_vecs),
            ref_ids,
            ref_labels,
            k=k,
            metric=metric,
        )
        out = add_overlay_columns(out, column, preds, identifiers=all_ids)
        total_transferred += len(preds)
        logger.info("Transferred %r to %d quer(ies)", column, len(preds))

    if total_transferred == 0:
        logger.warning(
            "No annotations were transferred. Check the --reference-* rules and "
            "that query proteins have missing values in the target column(s)."
        )
    return out


@app.command()
def transfer(
    bundle: Annotated[
        Path,
        typer.Option("-b", "--bundle", help="Input .parquetbundle to annotate."),
    ],
    embeddings: Annotated[
        str,
        typer.Option(
            "-e",
            "--embeddings",
            help="HDF5 embeddings, optional :name suffix (e.g. emb.h5:prot_t5).",
        ),
    ],
    transfer_columns: Annotated[
        list[str],
        typer.Option(
            "-t", "--transfer", help="Annotation column to transfer (repeat)."
        ),
    ],
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output .parquetbundle path."),
    ],
    query_id_prefix: Annotated[
        list[str] | None, typer.Option("--query-id-prefix")
    ] = None,
    query_where: Annotated[
        list[str] | None,
        typer.Option("--query-where", help="col~substr"),
    ] = None,
    reference_id_prefix: Annotated[
        list[str] | None, typer.Option("--reference-id-prefix")
    ] = None,
    reference_where: Annotated[
        list[str] | None,
        typer.Option("--reference-where", help="col~substr"),
    ] = None,
    k: Annotated[
        int, typer.Option("--k", help="Neighbours considered (default 1).")
    ] = 1,
    metric: Annotated[
        str, typer.Option("--metric", help="cosine | euclidean (default cosine).")
    ] = "cosine",
    verbose: Opt_Verbose = 0,
) -> None:
    """Transfer annotations to query proteins from nearest reference neighbours."""
    setup_logging(verbose)

    import io

    import pyarrow.parquet as pq

    from protspace.analysis.classification import Rule
    from protspace.data.io.bundle import read_bundle, replace_annotations_in_bundle
    from protspace.data.loaders import load_h5, split_h5_spec

    def _parse_where(items: list[str] | None) -> list[tuple[str, str]]:
        clauses = []
        for item in items or []:
            if "~" not in item:
                raise typer.BadParameter(f"--*-where must be col~substr, got {item!r}")
            col, sub = item.split("~", 1)
            clauses.append((col, sub))
        return clauses

    query_rule = Rule(
        id_prefixes=query_id_prefix or [], where=_parse_where(query_where)
    )
    reference_rule = Rule(
        id_prefixes=reference_id_prefix or [], where=_parse_where(reference_where)
    )

    allowed_metrics = get_args(METRIC_TYPES)
    if metric not in allowed_metrics:
        raise typer.BadParameter(
            f"--metric must be one of {', '.join(allowed_metrics)}"
        )
    if k < 1:
        raise typer.BadParameter("--k must be >= 1")

    # Load embeddings (optional ':name' override; colon/Windows-safe parsing).
    h5_path, name_override = split_h5_spec(embeddings)
    emb_set = load_h5([h5_path], name_override=name_override)
    emb_map = {header: emb_set.data[i] for i, header in enumerate(emb_set.headers)}

    # Read the annotations part of the bundle.
    parts, _settings = read_bundle(bundle)
    annotations = pq.read_table(io.BytesIO(parts[0]))

    # Real bundles name the id column "protein_id"; run_transfer works on "identifier".
    if (
        "protein_id" in annotations.column_names
        and "identifier" in annotations.column_names
    ):
        raise typer.BadParameter(
            "Bundle annotations contain both 'protein_id' and 'identifier' columns; "
            "cannot determine the id column unambiguously."
        )
    id_col = "protein_id" if "protein_id" in annotations.column_names else "identifier"
    if id_col != "identifier":
        annotations = annotations.rename_columns(
            ["identifier" if n == id_col else n for n in annotations.column_names]
        )

    for col in transfer_columns:
        if col not in annotations.column_names:
            raise typer.BadParameter(
                f"--transfer column {col!r} not found in the bundle annotations"
            )

    # Validate classification --*-where columns up front for a clean error.
    available = set(annotations.column_names)
    for col, _ in query_rule.where + reference_rule.where:
        if col not in available:
            raise typer.BadParameter(
                f"--*-where column {col!r} not found in the bundle annotations"
            )

    # Translate input-driven errors from the core into clean CLI errors rather
    # than leaking raw KeyError/ValueError tracebacks to the user.
    try:
        augmented = run_transfer(
            annotations=annotations,
            embeddings=emb_map,
            transfer_columns=transfer_columns,
            query_rule=query_rule,
            reference_rule=reference_rule,
            k=k,
            metric=metric,
        )
    except (KeyError, ValueError) as exc:
        # Use the raw message (KeyError stringifies with repr quotes) rather than
        # stripping quotes off the rendered string, which could mangle messages.
        message = exc.args[0] if exc.args else str(exc)
        raise typer.BadParameter(str(message)) from exc

    # Rename id column back so the written bundle keeps its original name
    # (the web frontend expects "protein_id").
    if id_col != "identifier":
        augmented = augmented.rename_columns(
            [id_col if n == "identifier" else n for n in augmented.column_names]
        )

    replace_annotations_in_bundle(bundle, output, augmented)
    logger.info("Wrote transferred bundle to %s", output)
