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

from protspace.cli.app import PANEL_REFINE, app, setup_logging
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


#: ``--max-distance auto``: the percentile of the references' distances to their
#: nearest other reference that becomes the cutoff.
AUTO_PERCENTILE = 95


def _auto_max_distance(column: str, ref_emb: np.ndarray, metric: str) -> float:
    """The cutoff ``--max-distance auto`` picks for one column's references.

    A query farther from every reference than 95% of the references are from
    their own nearest neighbour sits outside the reference set's spacing. The
    nearest *other* reference is found by index, not by distance: a duplicate
    embedding is also at distance ~0, and cosine self-distance is not exactly 0.
    """
    from protlabel.backends import nearest

    if ref_emb.shape[0] < 2:
        raise ValueError(
            f"--max-distance auto needs at least two references with a value "
            f"for {column!r}; found {ref_emb.shape[0]}"
        )
    idx, dist = nearest(ref_emb, ref_emb, k=2, metric=metric)
    is_self = idx[:, 0] == np.arange(ref_emb.shape[0])
    other = np.where(is_self, dist[:, 1], dist[:, 0])
    return float(np.percentile(other, AUTO_PERCENTILE))


def run_transfer(
    *,
    annotations: pa.Table,
    embeddings: dict[str, np.ndarray],
    transfer_columns: list[str],
    query_rule: Rule,
    reference_rule: Rule,
    k: int = 1,
    metric: str = "cosine",
    format_version: int = 2,
    report: list[dict] | None = None,
    max_distance: float | str | None = None,
    skip_distant: bool = False,
) -> pa.Table:
    """Pure core: classify, transfer per column, return the augmented table.

    ``embeddings`` maps protein id -> 1-D float32 vector. Proteins without an
    embedding cannot act as queries or references.

    ``report``, when given, receives one row per query and neighbour (see
    :func:`protspace.data.io.predictions.report_rows`); the table is the same
    either way.

    ``max_distance`` (a distance, or ``"auto"`` to calibrate one per column on
    the references) classes each query ``near`` or ``distant`` by the distance
    to its nearest reference and writes ``COL__neighbor``; ``skip_distant``
    then leaves the distant queries unpredicted.
    """
    from protlabel import eat
    from protspace.analysis.classification import classify
    from protspace.data.io.predictions import (
        add_overlay_columns,
        report_rows,
        set_neighbor_column,
    )

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
    total_queries = 0
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
            keep_neighbors=report is not None or max_distance is not None,
        )
        rows = (
            report_rows(column, preds, format_version=format_version)
            if report is not None
            else []
        )

        classes = None
        if max_distance is not None:
            cutoff = max_distance
            if cutoff == "auto":
                cutoff = _auto_max_distance(column, np.vstack(ref_vecs), metric)
                logger.info(
                    "Max distance for %r: %.6g (%dth percentile of %d references' "
                    "distance to their nearest other reference)",
                    column,
                    cutoff,
                    AUTO_PERCENTILE,
                    len(ref_ids),
                )
            # Near/distant is about the query's neighbourhood, so it reads the
            # nearest reference of any label, not the winning label's source.
            classes = {
                p.query_id: "near" if p.neighbors[0].distance <= cutoff else "distant"
                for p in preds
            }
            for row in rows:
                row["neighbor"] = classes[row["query_id"]]
                row["max_distance"] = cutoff
            if skip_distant:
                preds = [p for p in preds if classes[p.query_id] == "near"]
                if not preds:
                    logger.warning(
                        "Every query of %r is beyond --max-distance %.6g, so none "
                        "was predicted. Try --max-distance auto or a larger value.",
                        column,
                        cutoff,
                    )
        if report is not None:
            report.extend(rows)

        out = add_overlay_columns(
            out,
            column,
            preds,
            identifiers=all_ids,
            format_version=format_version,
        )
        out = set_neighbor_column(out, column, classes, identifiers=all_ids)
        total_queries += len(q_ids)
        logger.info("Transferred %r to %d quer(ies)", column, len(preds))
        if len(preds) < len(q_ids):
            logger.info(
                "Left %d distant quer(ies) of %r unpredicted",
                len(q_ids) - len(preds),
                column,
            )

    if total_queries == 0:
        logger.warning(
            "No annotations were transferred: the target column(s) have either "
            "no missing values to fill or no values to transfer from. If you "
            "passed --query-* / --reference-* filters, check they select the "
            "proteins you meant."
        )
    return out


def _parse_max_distance(value: str | None) -> float | str | None:
    """``--max-distance``: ``auto``, a non-negative number, or not given."""
    if value is None or value == "auto":
        return value
    try:
        cutoff = float(value)
    except ValueError:
        cutoff = float("nan")
    if not (cutoff >= 0 and np.isfinite(cutoff)):
        raise typer.BadParameter(
            f"--max-distance must be a non-negative number or 'auto', got {value!r}"
        )
    return cutoff


@app.command(rich_help_panel=PANEL_REFINE)
def transfer(
    bundle: Annotated[
        Path,
        typer.Option(
            "-b",
            "--bundle",
            help="Input .parquetbundle to annotate.",
            rich_help_panel="Input / Output",
        ),
    ],
    embeddings: Annotated[
        str,
        typer.Option(
            "-e",
            "--embeddings",
            help="HDF5 embeddings, optional :name suffix (e.g. emb.h5:prot_t5).",
            rich_help_panel="Input / Output",
        ),
    ],
    transfer_columns: Annotated[
        list[str],
        typer.Option(
            "-t",
            "--transfer",
            help="Annotation column to transfer (repeat).",
            rich_help_panel="Transfer",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(
            "-o",
            "--output",
            help="Output .parquetbundle path.",
            rich_help_panel="Input / Output",
        ),
    ],
    query_id_prefix: Annotated[
        list[str] | None,
        typer.Option(
            "--query-id-prefix",
            help="Restrict queries to IDs with this prefix (default: any protein missing a value).",
            rich_help_panel="Query filters (which proteins receive labels)",
        ),
    ] = None,
    query_where: Annotated[
        list[str] | None,
        typer.Option(
            "--query-where",
            help="Restrict queries to rows where col contains substr (col~substr, repeatable).",
            rich_help_panel="Query filters (which proteins receive labels)",
        ),
    ] = None,
    reference_id_prefix: Annotated[
        list[str] | None,
        typer.Option(
            "--reference-id-prefix",
            help="Restrict references to IDs with this prefix (default: any protein that has a value).",
            rich_help_panel="Reference filters (which proteins provide labels)",
        ),
    ] = None,
    reference_where: Annotated[
        list[str] | None,
        typer.Option(
            "--reference-where",
            help="Restrict references to rows where col contains substr (col~substr, repeatable).",
            rich_help_panel="Reference filters (which proteins provide labels)",
        ),
    ] = None,
    k: Annotated[
        int,
        typer.Option(
            "--k", help="Neighbours considered (default 1).", rich_help_panel="Transfer"
        ),
    ] = 1,
    metric: Annotated[
        str,
        typer.Option(
            "--metric",
            help="cosine | euclidean (default cosine).",
            rich_help_panel="Transfer",
        ),
    ] = "cosine",
    max_distance: Annotated[
        str | None,
        typer.Option(
            "--max-distance",
            help="Mark queries near/distant by the distance to their nearest reference (writes COL__neighbor); 'auto' calibrates it on the references.",
            rich_help_panel="Transfer",
        ),
    ] = None,
    skip_distant: Annotated[
        bool,
        typer.Option(
            "--skip-distant",
            help="Leave distant queries unpredicted (needs --max-distance).",
            rich_help_panel="Transfer",
        ),
    ] = False,
    report: Annotated[
        Path | None,
        typer.Option(
            "--report",
            help="Also write a TSV of every query's neighbours: label, source, distance, reliability.",
            rich_help_panel="Input / Output",
        ),
    ] = None,
    verbose: Opt_Verbose = 0,
) -> None:
    """Fill missing annotations from nearest neighbours (EAT).

    With no query/reference filters, transfer runs *within* the bundle: every
    protein missing a value in a --transfer column receives one from its
    nearest neighbour among the proteins that have one. Use the filters only to
    narrow that down (e.g. to label one species from another).
    """
    setup_logging(verbose)

    from protspace.analysis.classification import Rule
    from protspace.data.annotations.encoding import (
        read_format_version,
        upgrade_cell_grammar,
    )
    from protspace.data.io.bundle import read_tables, replace_annotations_in_bundle
    from protspace.data.io.predictions import write_report
    from protspace.data.loaders import load_h5, resolve_input_names, split_h5_spec

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
    cutoff = _parse_max_distance(max_distance)
    if skip_distant and cutoff is None:
        raise typer.BadParameter("--skip-distant needs --max-distance")
    # The report is written after the bundle, so a path that cannot hold a file
    # (a directory, or a file where a parent directory should be) fails first.
    if report is not None:
        if report.is_dir():
            raise typer.BadParameter(f"--report {report} is a directory")
        nearest = next(p for p in report.absolute().parents if p.exists())
        if not nearest.is_dir():
            raise typer.BadParameter(f"--report {report}: {nearest} is not a directory")

    # Load embeddings (optional ':name' override; colon/Windows-safe parsing). The
    # transfer reads only the vectors, so a single input always resolves a name.
    ((h5_path, name, _),) = resolve_input_names(
        [split_h5_spec(embeddings)], command="transfer"
    )
    emb_set = load_h5([h5_path], name_override=name)
    emb_map = {header: emb_set.data[i] for i, header in enumerate(emb_set.headers)}

    # Read the annotations part of the bundle.  read_tables hands back the v2
    # shape for a v3 container too, without the parquet round trip read_bundle
    # would do on the way out of the decoder.  A legacy bundle's rows are keyed
    # as the v2 browser keyed them (as `convert` does), so a repeated or null id
    # neither feeds the transfer a row the browser never showed nor fails the
    # v3 write at the end.
    annotations, _metadata, _projections = read_tables(bundle, keyed=True)
    input_format_version = read_format_version(annotations)

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
    neighbour_rows = [] if report is not None else None
    try:
        augmented = run_transfer(
            annotations=annotations,
            embeddings=emb_map,
            transfer_columns=transfer_columns,
            query_rule=query_rule,
            reference_rule=reference_rule,
            k=k,
            metric=metric,
            format_version=input_format_version,
            report=neighbour_rows,
            max_distance=cutoff,
            skip_distant=skip_distant,
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

    # The renames dropped the stamp, so restore the grammar from the version read
    # off the bundle: a v1 bundle's cells are migrated, v2 cells are re-stamped.
    augmented = upgrade_cell_grammar(augmented, input_format_version)

    # A legacy input the v3 encoder still refuses (projection sets that disagree
    # between metadata and data, ...) is a usage error, as in `convert` and
    # `style`, not a traceback; nothing is written.
    try:
        replace_annotations_in_bundle(bundle, output, augmented)
    except ValueError as exc:
        raise typer.BadParameter(f"cannot write {output}: {exc}") from exc
    logger.info("Wrote transferred bundle to %s", output)
    if report is not None:
        try:
            write_report(report, neighbour_rows)
        except OSError as exc:
            raise typer.BadParameter(
                f"cannot write --report {report} (the bundle was written): {exc}"
            ) from exc
        logger.info("Wrote %d neighbour row(s) to %s", len(neighbour_rows), report)
