"""protspace transfer — fill missing annotation values from nearest references.

Embedding Annotation Transfer (EAT): for each query protein with a missing
value in a target column, transfer the value of its nearest annotated
reference in pLM embedding space, with a reliability-index confidence.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

import numpy as np
import pyarrow as pa
import typer

from protspace.cli.app import app, setup_logging
from protspace.cli.common_options import Opt_Verbose

logger = logging.getLogger(__name__)


def _is_missing(value) -> bool:
    return value is None or str(value).strip() == ""


def run_transfer(
    *,
    annotations: pa.Table,
    embeddings: dict[str, np.ndarray],
    transfer_columns: list[str],
    query_rule,
    reference_rule,
    k: int = 1,
    metric: str = "euclidean",
) -> pa.Table:
    """Pure core: classify, transfer per column, return the augmented table.

    ``embeddings`` maps protein id -> 1-D float32 vector. Proteins without an
    embedding cannot act as queries or references.
    """
    from protlabel import eat
    from protspace.analysis.classification import classify
    from protspace.data.io.predictions import add_overlay_columns

    # Restrict classification to proteins that actually have an embedding.
    has_emb = pa.array(
        [str(v) in embeddings for v in annotations.column("identifier").to_pylist()]
    )
    embedded = annotations.filter(has_emb)

    if embedded.num_rows == 0:
        raise ValueError(
            "No proteins in the bundle have a matching embedding "
            "(check that the --embeddings ids match the bundle identifiers)."
        )

    query_idx, ref_idx = classify(embedded, query_rule, reference_rule)
    rows = embedded.to_pylist()

    out = annotations
    for column in transfer_columns:
        if column not in annotations.column_names:
            raise KeyError(f"Transfer column {column!r} not in annotations table")

        # References: classified refs that HAVE a value in this column.
        ref_ids, ref_labels, ref_vecs = [], [], []
        for i in ref_idx:
            value = rows[i].get(column)
            if not _is_missing(value):
                rid = str(rows[i]["identifier"])
                ref_ids.append(rid)
                ref_labels.append(str(value))
                ref_vecs.append(embeddings[rid])
        if not ref_ids:
            logger.warning("No references with a value for %r; skipping", column)
            continue

        # Queries: classified queries MISSING a value in this column.
        q_ids, q_vecs = [], []
        for i in query_idx:
            if _is_missing(rows[i].get(column)):
                qid = str(rows[i]["identifier"])
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
        out = add_overlay_columns(out, column, preds)
        logger.info("Transferred %r to %d quer(ies)", column, len(preds))

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
        str, typer.Option("--metric", help="euclidean | cosine.")
    ] = "euclidean",
    verbose: Opt_Verbose = 0,
) -> None:
    """Transfer annotations to query proteins from nearest reference neighbours."""
    setup_logging(verbose)

    import io

    import pyarrow.parquet as pq

    from protspace.analysis.classification import Rule
    from protspace.data.io.bundle import read_bundle, replace_annotations_in_bundle
    from protspace.data.loaders import load_h5

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

    # Load embeddings (name override after ':').
    h5_spec = embeddings.split(":", 1)
    h5_path = Path(h5_spec[0])
    name_override = h5_spec[1] if len(h5_spec) == 2 else None
    emb_set = load_h5([h5_path], name_override=name_override)
    emb_map = {header: emb_set.data[i] for i, header in enumerate(emb_set.headers)}

    # Read the annotations part of the bundle.
    parts, _settings = read_bundle(bundle)
    annotations = pq.read_table(io.BytesIO(parts[0]))

    # Real bundles name the id column "protein_id"; run_transfer works on "identifier".
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

    augmented = run_transfer(
        annotations=annotations,
        embeddings=emb_map,
        transfer_columns=transfer_columns,
        query_rule=query_rule,
        reference_rule=reference_rule,
        k=k,
        metric=metric,
    )

    # Rename id column back so the written bundle keeps its original name
    # (the web frontend expects "protein_id").
    if id_col != "identifier":
        augmented = augmented.rename_columns(
            [id_col if n == "identifier" else n for n in augmented.column_names]
        )

    replace_annotations_in_bundle(bundle, output, augmented)
    logger.info("Wrote transferred bundle to %s", output)
