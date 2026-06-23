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


def _load_reductions(projections: Path, default_metric: str = "euclidean") -> list[dict]:
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

    embedding_sets = [
        load_h5([path], name_override=name_override)
        for path, name_override in _parse_input_specs(list(input))
    ]

    reductions = _load_reductions(projections, default_metric=metric)
    report = compute_statistics(
        embedding_sets, reductions, rng_seed=seed, default_metric=metric
    )
    table = report.to_arrow()

    output.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, str(output))
    typer.echo(f"Saved {table.num_rows} statistic row(s): {output}")
