"""protspace stats — compute projection statistics for an existing project.

Loads the embedding H5(s) (for faithfulness) and the projection coordinates from
a project directory, computes the tidy statistics table, and writes it as a
parquet file — the optional fifth ``.parquetbundle`` part. No annotations are
needed. Best-effort: per-statistic failures are isolated by the driver.
"""

import json
import logging
from pathlib import Path
from typing import Annotated

import typer

from protspace.cli.app import app, setup_logging

logger = logging.getLogger(__name__)


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

    data_path = projections / "projections_data.parquet"
    meta_path = projections / "projections_metadata.parquet"
    if not data_path.exists():
        raise typer.BadParameter(f"Missing: {data_path}")

    metric_by_name: dict[str, str] = {}
    dims_by_name: dict[str, int] = {}
    source_by_name: dict[str, str] = {}
    if meta_path.exists():
        mt = pq.read_table(str(meta_path)).to_pydict()
        names = mt.get("projection_name", [])
        infos = mt.get("info_json", [])
        dims = mt.get("dimensions", [])
        sources = mt.get("source", [])
        for i, nm in enumerate(names):
            try:
                info = json.loads(infos[i]) if i < len(infos) and infos[i] else {}
            except (json.JSONDecodeError, TypeError):
                info = {}
            metric_by_name[nm] = info.get("metric") or default_metric
            if i < len(dims):
                dims_by_name[nm] = int(dims[i])
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
    for nm, g in grouped.items():
        dims = dims_by_name.get(nm, 2)
        if dims == 3 and any(v is not None for v in g["z"]):
            coords = np.array([g["x"], g["y"], g["z"]], dtype=float).T
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
    return reductions


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
        try:
            info = json.loads(raw) if raw else {}
        except (json.JSONDecodeError, TypeError):
            info = {}
        quality = quality_by_name.get(nm)
        if quality is not None:
            info["quality"] = quality
        new_infos.append(json.dumps(info))

    idx = table.column_names.index("info_json")
    table = table.set_column(idx, "info_json", pa.array(new_infos, type=pa.string()))
    pq.write_table(table, str(meta_path))


def _merge_annotations_with_columns(ann_path: Path, report) -> int:
    """Merge the report's per-protein ``AnnotationColumn``s into ``ann_path``.

    Rewrites the annotations parquet in place with the computed ``cluster_*`` /
    ``silhouette_*`` columns joined by identifier. Added columns are stringified
    (membership → category labels, silhouette → numeric strings, absent → empty)
    so they match the prepare path's all-string annotations and the frontend's
    content-based type inference. Returns the number of columns added.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    from protspace.stats.carriage import merge_annotation_columns

    if not report.annotation_columns or not ann_path.exists():
        return 0
    df = pq.read_table(str(ann_path)).to_pandas()
    id_col = "identifier" if "identifier" in df.columns else df.columns[0]
    added = merge_annotation_columns(report, df, id_col=id_col)
    for name in added:
        df[name] = df[name].fillna("").astype(str)
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), str(ann_path))
    return len(added)


@app.command()
def stats(
    input: Annotated[
        list[str],
        typer.Option(
            "-i",
            "--input",
            help="HDF5 embedding file(s). Repeat for multi-embedding. Name override: -i file.h5:name",
        ),
    ],
    projections: Annotated[
        Path,
        typer.Option(
            "-p",
            "--projections",
            help="Directory with projections_metadata.parquet and projections_data.parquet.",
            exists=True,
        ),
    ],
    output: Annotated[
        Path,
        typer.Option("-o", "--output", help="Output statistics.parquet path."),
    ],
    annotations: Annotated[
        Path | None,
        typer.Option(
            "-a",
            "--annotations",
            help="Annotations parquet to enrich in place with per-protein "
            "cluster-membership + silhouette columns. Omit to skip per-protein outputs.",
        ),
    ] = None,
    seed: Annotated[int, typer.Option("--seed", help="Random seed.")] = 42,
    metric: Annotated[
        str,
        typer.Option(
            "--metric",
            help="High-dim distance metric for faithfulness when the projection metadata omits one (e.g. PCA/MDS).",
        ),
    ] = "euclidean",
    verbose: Annotated[
        int, typer.Option("-v", "--verbose", count=True, help="Increase verbosity.")
    ] = 0,
) -> None:
    """Compute cluster-validity + faithfulness statistics for each projection."""
    setup_logging(verbose)

    import pyarrow.parquet as pq

    from protspace.cli.prepare import _parse_input_specs
    from protspace.data.loaders import load_h5
    from protspace.stats import compute_statistics
    from protspace.stats.carriage import route_faithfulness_to_metadata

    embedding_sets = [
        load_h5([path], name_override=name_override)
        for path, name_override in _parse_input_specs(list(input))
    ]

    reductions = _load_reductions(projections, default_metric=metric)
    # Per-protein outputs (cluster membership + per-point silhouette) are only
    # computed when there's an annotations file to land them in — silhouette_samples
    # is O(n^2), so we don't pay for it with nowhere to write.
    params = {} if annotations is not None else {"cluster_annotations": False}
    report = compute_statistics(
        embedding_sets,
        reductions,
        rng_seed=seed,
        params=params,
        default_metric=metric,
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
        projections / "projections_metadata.parquet", quality_by_name
    )

    n_cols = 0
    if annotations is not None:
        n_cols = _merge_annotations_with_columns(annotations, report)

    table = report.to_arrow()
    output.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, str(output))
    typer.echo(
        f"Saved {table.num_rows} statistic row(s): {output}"
        f" (faithfulness → {len(quality_by_name)} projection(s);"
        f" {n_cols} computed annotation column(s))"
    )
