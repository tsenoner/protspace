"""protspace stats — compute projection statistics for an existing project.

Loads the embedding H5(s) (for faithfulness) and the projection coordinates from
a project directory, computes the tidy statistics table, and writes it as a
parquet file — the optional fifth ``.parquetbundle`` part. Faithfulness and the
cluster-membership columns need no annotations; annotation-based validity and its
ARI/NMI agreement need ``-a/--annotations``. Best-effort: per-statistic failures
are isolated by the driver.
"""

import json
import logging
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import PANEL_STAGES, app, setup_logging
from protspace.cli.common_options import ClusterSelection, ClusterSpace, Opt_Verbose

logger = logging.getLogger(__name__)


def _resolve_id_col(frame) -> str:
    """The identifier column, by the rule `bundle -a` and custom annotation files use."""
    from protspace.data.processors.custom_annotations import resolve_id_column

    return resolve_id_column(list(frame.columns))


def _parse_info_json(raw) -> dict:
    """Parse a projection's ``info_json`` cell into a dict; empty/malformed → {}."""
    try:
        return json.loads(raw) if raw else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _atomic_write_table(table, path: Path) -> None:
    """Overwrite ``path`` with ``table`` atomically.

    Writes a sibling temp file then renames it into place, so an interrupted
    write (Ctrl-C / OOM / full disk) can never leave the user's existing parquet
    truncated — rename on the same filesystem is atomic.
    """
    import pyarrow.parquet as pq

    from protspace.data.io.atomic import staged_write

    with staged_write(path) as staged:
        pq.write_table(table, str(staged))


def _load_reductions(
    projections: Path, default_metric: str = "euclidean"
) -> list[dict]:
    """Reconstruct per-projection ``{name, data, ids, info, source}`` from a dir.

    Reads ``projections_data.parquet`` (long table of projection_name/identifier/
    x/y/z) into per-projection coordinate arrays + id order, and the reducer
    metric + source-embedding name from ``projections_metadata.parquet``.
    """
    import numpy as np
    import pyarrow.parquet as pq

    from protspace.data.io.bundle import (
        PROJECTIONS_DATA_FILENAME,
        PROJECTIONS_METADATA_FILENAME,
    )

    data_path = projections / PROJECTIONS_DATA_FILENAME
    meta_path = projections / PROJECTIONS_METADATA_FILENAME
    if not data_path.exists():
        raise typer.BadParameter(f"Missing: {data_path}")

    metric_by_name: dict[str, str] = {}
    dims_by_name: dict[str, int] = {}
    source_by_name: dict[str, str] = {}
    if meta_path.exists():
        mt = pq.read_table(str(meta_path)).to_pydict()
        names = mt.get("projection_name", [])
        infos = mt.get("info_json", [])
        dims_col = mt.get("dimensions", [])
        sources = mt.get("source", [])
        for i, nm in enumerate(names):
            info = _parse_info_json(infos[i] if i < len(infos) else None)
            metric_by_name[nm] = info.get("metric") or default_metric
            if i < len(dims_col):
                dims_by_name[nm] = int(dims_col[i])
            if i < len(sources) and sources[i]:
                source_by_name[nm] = sources[i]

    dt = pq.read_table(str(data_path)).to_pydict()
    pnames = dt["projection_name"]
    idents = dt["identifier"]
    xs, ys = dt["x"], dt["y"]
    zs = dt.get("z", [None] * len(pnames))

    grouped: dict[str, dict] = {}
    for i in range(len(pnames)):
        g = grouped.setdefault(pnames[i], {"ids": [], "x": [], "y": [], "z": []})
        g["ids"].append(idents[i])
        g["x"].append(xs[i])
        g["y"].append(ys[i])
        g["z"].append(zs[i])

    reductions: list[dict] = []
    three_d: list[str] = []
    for nm, g in grouped.items():
        # Fall back to the data itself when projection metadata is absent: a 3D
        # projection is identified by present z values, not defaulted to 2D (which
        # would silently drop the z coordinate from the statistics computation).
        has_z = any(v is not None for v in g["z"])
        dims = dims_by_name.get(nm) or (3 if has_z else 2)
        if dims == 3 and has_z:
            coords = np.array([g["x"], g["y"], g["z"]], dtype=float).T
            three_d.append(nm)
        else:
            coords = np.array([g["x"], g["y"]], dtype=float).T
        red = {
            "name": nm,
            "data": coords,
            "ids": list(g["ids"]),
            "info": {"metric": metric_by_name.get(nm, default_metric)},
        }
        if nm in source_by_name:
            red["source"] = source_by_name[nm]
        reductions.append(red)
    if three_d:
        from protspace.deprecations import THREE_D_PROJECTION_READ, warn

        warn(
            THREE_D_PROJECTION_READ,
            logger,
            name=str(projections),
            projections=", ".join(three_d),
        )
    return reductions


def _match_projection_source(named_input, reductions: list[dict]):
    """Name a single file-named input after the embedding its projections came from.

    A name read off the file name is a guess, and the projections were labelled
    when they were built, possibly under another name. With one embedding behind
    them, that one is this input; with several and no match, scoring every
    projection against this one embedding would be wrong, so refuse instead.
    """
    sources = {r["source"] for r in reductions if r.get("source")} - {"MMseqs2"}
    if not sources or named_input.name in sources:
        return named_input
    if len(sources) == 1:
        (source,) = sources
        logger.info(
            f"Naming {named_input.path} '{source}', the embedding its projections "
            f"were built from (its file name gave '{named_input.name}')."
        )
        return named_input._replace(name=source)
    raise typer.BadParameter(
        f"The projections come from several embeddings ({', '.join(sorted(sources))}) "
        f"and the name '{named_input.name}' taken from {named_input.path} matches none "
        f"of them. Name the input after the one it holds, e.g. "
        f"-i {named_input.path}:{min(sources)}"
    )


def _merge_quality_into_metadata(meta_path: Path, quality_by_name: dict) -> None:
    """Fold faithfulness ``quality`` objects into ``projections_metadata.parquet``.

    Rewrites the file in place, parsing each row's ``info_json``, injecting the
    matching projection's ``quality`` (preserving the reducer's existing info), and
    re-serialising — leaving every other column untouched. This is how the
    standalone ``stats`` path carries faithfulness into the bundle: a later
    ``protspace bundle -p`` reads the enriched metadata as the bundle's 2nd part.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    if not quality_by_name or not meta_path.exists():
        return
    table = pq.read_table(str(meta_path))
    if (
        "projection_name" not in table.column_names
        or "info_json" not in table.column_names
    ):
        return

    names = table.column("projection_name").to_pylist()
    infos = table.column("info_json").to_pylist()
    new_infos: list[str] = []
    for nm, raw in zip(names, infos, strict=False):
        info = _parse_info_json(raw)
        quality = quality_by_name.get(nm)
        if quality is not None:
            info["quality"] = quality
        new_infos.append(json.dumps(info))

    idx = table.column_names.index("info_json")
    table = table.set_column(idx, "info_json", pa.array(new_infos, type=pa.string()))
    _atomic_write_table(table, meta_path)


def _read_annotations(path: Path, reductions: list[dict]):
    """The ``-a`` table as a DataFrame, read as a parquet or a custom annotation file.

    A custom file comes back with one row per projected protein, so the proteins it does not
    annotate still get cluster columns. A parquet's id column is checked here too, so a table
    naming its ids twice is a usage error rather than a traceback later.
    """
    import pyarrow.parquet as pq
    from pyarrow import ArrowInvalid

    from protspace.data.processors.custom_annotations import (
        is_custom_annotation_file,
        load_custom_annotations,
    )

    try:
        if is_custom_annotation_file(path):
            ids = dict.fromkeys(i for r in reductions for i in r["ids"])
            return load_custom_annotations([path], list(ids))
        frame = pq.read_table(str(path)).to_pandas()
        _resolve_id_col(frame)
        return frame
    except ArrowInvalid as exc:
        raise typer.BadParameter(
            f"{path} is not a parquet file. -a takes an annotations parquet or a "
            ".csv/.tsv/.txt file.",
            param_hint="'-a/--annotations'",
        ) from exc
    except (FileNotFoundError, ValueError) as exc:
        raise typer.BadParameter(str(exc), param_hint="'-a/--annotations'") from exc


def _write_custom_annotations(frame, path: Path) -> None:
    """Write a custom file's frame, cluster columns included, as a stamped parquet."""
    import pyarrow as pa

    from protspace.data.annotations.encoding import stamp_format_version

    table = stamp_format_version(
        pa.Table.from_pandas(frame.fillna(""), preserve_index=False)
    )
    _atomic_write_table(table, path)


def _merge_annotations_with_columns(ann_path: Path, report, frame=None) -> list[str]:
    """Merge the report's per-protein ``AnnotationColumn``s into ``ann_path``.

    Rewrites the annotations parquet in place with the computed ``cluster_*``
    membership columns joined by identifier (each value a bare ``cluster N``
    label). Added columns are stringified
    (absent → empty) so they match the prepare path's all-string annotations and the
    frontend's content-based type inference. ``frame`` reuses an already-loaded
    DataFrame instead of re-reading ``ann_path``. Returns the names of columns added
    (columns that matched no ids are warned about and skipped in ``merge``).
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    from protspace.stats.carriage import merge_annotation_columns

    if not report.annotation_columns or not ann_path.exists():
        return []
    table = pq.read_table(str(ann_path))
    df = frame if frame is not None else table.to_pandas()
    added = merge_annotation_columns(report, df, id_col=_resolve_id_col(df))
    if not added:
        return []
    # Append ONLY the new string columns onto the ORIGINAL Arrow table (row order
    # preserved: `df` came from the same file). A full `pa.Table.from_pandas(df)`
    # round-trip would re-infer dtypes and silently rewrite untouched columns the
    # user owns (e.g. a nullable int64 → float64), so avoid it.
    for name in added:
        arr = pa.array(df[name].fillna("").astype(str).tolist(), type=pa.string())
        if name in table.column_names:
            table = table.set_column(table.column_names.index(name), name, arr)
        else:
            table = table.append_column(name, arr)
    _atomic_write_table(table, ann_path)
    return added


@app.command(rich_help_panel=PANEL_STAGES)
def stats(
    input: Annotated[
        list[str],
        typer.Option(
            "-i",
            "--input",
            help="HDF5 embedding file(s). Repeat for multi-embedding. Name override: -i file.h5:name",
            rich_help_panel="Input",
        ),
    ],
    projections: Annotated[
        Path,
        typer.Option(
            "-p",
            "--projections",
            help="Directory with projections_metadata.parquet and projections_data.parquet.",
            exists=True,
            rich_help_panel="Input",
        ),
    ],
    output: Annotated[
        Path,
        typer.Option(
            "-o",
            "--output",
            help="Output statistics.parquet path.",
            rich_help_panel="Output",
        ),
    ],
    annotations: Annotated[
        Path | None,
        typer.Option(
            "-a",
            "--annotations",
            help="Annotations parquet to enrich in place with per-protein "
            "cluster-membership columns, or a custom .csv/.tsv/.txt file, which is "
            "left as is: its columns and the cluster columns go to "
            "<file stem>.annotations.parquet in the projections directory. Omit to "
            "skip per-protein outputs.",
            rich_help_panel="Input",
        ),
    ] = None,
    settings_out: Annotated[
        Path | None,
        typer.Option(
            "--settings-out",
            help="Write auto-generated cluster-membership legend styles here (JSON) "
            "for `protspace bundle --settings`. Only with -a/--annotations.",
            rich_help_panel="Output",
        ),
    ] = None,
    seed: Annotated[
        int,
        typer.Option(
            "--seed", help="Random seed.", rich_help_panel="Clustering & scoring"
        ),
    ] = 42,
    metric: Annotated[
        str,
        typer.Option(
            "--metric",
            help="High-dim distance metric for faithfulness when the projection metadata omits one (e.g. PCA/MDS).",
            rich_help_panel="Clustering & scoring",
        ),
    ] = "euclidean",
    cluster_selection: Annotated[
        ClusterSelection,
        typer.Option(
            "--cluster-selection",
            help="How to choose the cluster count K: 'elbow' (default), 'silhouette' "
            "(max-silhouette K), or 'both' (emit both clusterings).",
            rich_help_panel="Clustering & scoring",
        ),
    ] = ClusterSelection.elbow,
    cluster_space: Annotated[
        ClusterSpace,
        typer.Option(
            "--cluster-space",
            help="Where to cluster: 'both' (default), 'projection' (one clustering "
            "per projection), or 'embedding' (one per embedding, shared by its "
            "projections, so cluster ids compare across them).",
            rich_help_panel="Clustering & scoring",
        ),
    ] = ClusterSpace.both,
    stats_annotation: Annotated[
        str,
        typer.Option(
            "--stats-annotation",
            help="Which annotation column(s) to score for cluster-validity: "
            "'auto' (all suitable categoricals) or a comma-separated list. "
            "Requires -a/--annotations.",
            rich_help_panel="Clustering & scoring",
        ),
    ] = "auto",
    verbose: Opt_Verbose = 0,
) -> None:
    """Score projection quality (cluster validity + faithfulness)."""
    setup_logging(verbose)

    # Cluster legend styles are only generated alongside the per-protein membership
    # columns, so --settings-out without -a would silently write nothing.
    if settings_out is not None and annotations is None:
        raise typer.BadParameter("--settings-out requires -a/--annotations.")
    if (
        stats_annotation
        and annotations is None
        and stats_annotation.strip().lower() != "auto"
    ):
        raise typer.BadParameter("--stats-annotation requires -a/--annotations.")

    import pyarrow.parquet as pq

    from protspace.cli.prepare import _parse_input_specs
    from protspace.data.io.bundle import PROJECTIONS_METADATA_FILENAME
    from protspace.data.loaders import load_h5, resolve_input_names
    from protspace.data.loaders.embedding_set import merge_same_name_sets
    from protspace.data.processors.custom_annotations import (
        is_custom_annotation_file,
    )
    from protspace.stats import compute_statistics
    from protspace.stats.annotation_select import build_annotation_labels
    from protspace.stats.carriage import (
        build_cluster_legend_settings,
        merge_annotation_columns,
        route_faithfulness_to_metadata,
    )

    try:
        named_inputs = resolve_input_names(
            _parse_input_specs(list(input)), command="stats"
        )
    except ValueError as e:
        raise typer.BadParameter(str(e)) from e
    reductions = _load_reductions(projections, default_metric=metric)
    if len(named_inputs) == 1 and named_inputs[0].from_file_name:
        named_inputs = [_match_projection_source(named_inputs[0], reductions)]

    # Union same-name inputs (e.g. two species sharing one embedding model), mirroring
    # the prepare pipeline — otherwise repeated same-name -i collapse to the last one.
    embedding_sets = merge_same_name_sets(
        [load_h5([path], name_override=name) for path, name, _ in named_inputs]
    )
    # Per-protein output (the cluster membership column, and the self-validity rows
    # gated on it) is only computed when there's an annotations file to land it in.
    params = {
        "cluster_selection": cluster_selection.value,
        "cluster_space": cluster_space.value,
    }
    if annotations is None:
        params["cluster_annotations"] = False

    annotation_labels = None
    ann_frame = None
    if annotations is not None:
        ann_frame = _read_annotations(annotations, reductions)
        annotation_labels = build_annotation_labels(
            ann_frame, stats_annotation, id_col=_resolve_id_col(ann_frame)
        )

    report = compute_statistics(
        embedding_sets,
        reductions,
        rng_seed=seed,
        params=params,
        default_metric=metric,
        annotations=annotation_labels,
    )

    # Route per-projection faithfulness into projections_metadata.info_json.quality
    # (rewritten in place); the aggregate fifth part keeps validity/meta rows only.
    route_faithfulness_to_metadata(report, reductions)
    quality_by_name = {
        r["name"]: r["info"]["quality"]
        for r in reductions
        if isinstance(r.get("info"), dict) and "quality" in r["info"]
    }
    _merge_quality_into_metadata(
        projections / PROJECTIONS_METADATA_FILENAME, quality_by_name
    )

    added_cols: list[str] = []
    if annotations is not None and is_custom_annotation_file(annotations):
        # The user's own file is not rewritten. The table it became is named after
        # it, not `selected_annotations.parquet`, which in an unbundled `prepare`
        # directory holds the fetched annotations.
        added_cols = merge_annotation_columns(
            report, ann_frame, id_col=_resolve_id_col(ann_frame)
        )
        enriched = projections / f"{annotations.stem}.annotations.parquet"
        _write_custom_annotations(ann_frame, enriched)
        typer.echo(
            f"Wrote {annotations.name} with the cluster columns to {enriched}; "
            "pass it to `protspace bundle -a`."
        )
    elif annotations is not None:
        # Reuse the frame already read for label-building — nothing has rewritten
        # the annotations parquet since (only projections_metadata was touched).
        added_cols = _merge_annotations_with_columns(
            annotations, report, frame=ann_frame
        )
    if settings_out is not None:
        # Style only the columns that actually landed values (id mismatches are
        # dropped in the merge), so we never write a legend for a phantom column.
        cluster_settings = build_cluster_legend_settings(report, columns=added_cols)
        settings_out.parent.mkdir(parents=True, exist_ok=True)
        settings_out.write_text(json.dumps(cluster_settings))
    n_cols = len(added_cols)

    table = report.to_arrow()
    output.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, str(output))
    typer.echo(
        f"Saved {table.num_rows} statistic row(s): {output}"
        f" (faithfulness → {len(quality_by_name)} projection(s);"
        f" {n_cols} computed annotation column(s))"
    )
