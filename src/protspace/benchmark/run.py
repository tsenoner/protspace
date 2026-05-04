#!/usr/bin/env python3
"""Benchmark DR methods on protein embeddings (trustworthiness + silhouette).

Shared paths, label loading, and optional plotting live here so ``visualize.py``
only forwards to :func:`plot_only_main`.

Usage:
    uv run python src/protspace/benchmark/run.py
    uv run python src/protspace/benchmark/run.py --plot
    uv run python src/protspace/benchmark/run.py --plot-only --data 3ftx
    DATA=globin uv run python src/protspace/benchmark/run.py --plot
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "src"))

from protspace.benchmark import benchmark_methods
from protspace.benchmark.labels import label_summary, load_labels_from_bundle
from protspace.benchmark.metrics import (
    calculate_trustworthiness,
    make_silhouette_metric,
)
from protspace.data.loaders import load_h5
from protspace.utils.constants import DimensionReductionConfig

METHODS = ["pca", "umap", "tsne", "pacmap", "mds", "localmap"]

METHOD_TITLES = {
    "pca": "PCA",
    "umap": "UMAP",
    "tsne": "t-SNE",
    "pacmap": "PaCMAP",
    "mds": "MDS",
    "localmap": "LocalMAP",
}


@dataclass(frozen=True)
class BenchmarkPaths:
    """Filesystem layout for one named dataset (``DATA`` env / ``--data``)."""

    data: str
    project_root: Path
    embedding_path: Path
    bundle_path: Path
    output_dir: Path
    output_png: Path

    @property
    def headers_npy(self) -> Path:
        return self.output_dir / "headers.npy"


def benchmark_paths(data: str | None = None) -> BenchmarkPaths:
    d = (data or os.environ.get("DATA", "3ftx")).strip()
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    out = Path(__file__).resolve().parent / "results" / d
    return BenchmarkPaths(
        data=d,
        project_root=project_root,
        embedding_path=project_root / f"output_{d}" / "tmp" / "prot_t5.h5",
        bundle_path=project_root / f"output_{d}" / "data.parquetbundle",
        output_dir=out,
        output_png=out / f"projections_{d}.png",
    )


def resolve_headers(paths: BenchmarkPaths) -> list[str]:
    """Row order for projections: HDF5 if present, else ``headers.npy``."""
    if paths.embedding_path.exists():
        return load_h5([paths.embedding_path]).headers
    if paths.headers_npy.exists():
        return list(np.load(paths.headers_npy, allow_pickle=True))
    raise FileNotFoundError(
        f"No embeddings at {paths.embedding_path} and no {paths.headers_npy}. "
        "Run a full benchmark once (needs prot_t5.h5) or keep headers.npy."
    )


def load_silhouette_labels(paths: BenchmarkPaths, headers: list[str]) -> np.ndarray | None:
    """Labels aligned to ``headers`` for silhouette; ``None`` if no bundle."""
    if not paths.bundle_path.exists():
        return None
    return load_labels_from_bundle(paths.bundle_path, headers)


def default_metric_functions(
    labels: np.ndarray | None,
) -> dict[str, Any]:
    """Trustworthiness always; silhouette when ``labels`` is not ``None``."""
    out: dict[str, Any] = {"trustworthiness": calculate_trustworthiness}
    if labels is not None:
        out["silhouette"] = make_silhouette_metric(labels)
    return out


def _print_label_intro(labels: np.ndarray | None, paths: BenchmarkPaths) -> None:
    if labels is None:
        print(f"[warn] No bundle at {paths.bundle_path} — silhouette will be NaN\n")
        return
    summary = label_summary(labels)
    print(
        f"Loaded labels: {summary['n_labelled']}/{summary['n_total']} "
        f"proteins, {summary['n_classes']} classes"
    )
    print("Top classes:")
    for cls, n in list(summary["classes"].items())[:5]:
        print(f"  {n:4d}  {cls}")
    print()


def run_benchmark(paths: BenchmarkPaths) -> None:
    print(f"=== Benchmark on '{paths.data}' ===\n")
    print(f"Loading embeddings from {paths.embedding_path}")

    if not paths.embedding_path.exists():
        sys.exit(
            f"Embeddings not found at {paths.embedding_path}.\n"
            f"Generate with: protspace prepare -q '<query>' "
            f"-e prot_t5 -m pca2,umap2 -o output_{paths.data}"
        )

    emb_set = load_h5([paths.embedding_path])
    embeddings = emb_set.data
    headers = emb_set.headers

    print(
        f"Loaded {embeddings.shape[0]} proteins with "
        f"{embeddings.shape[1]} features\n"
    )

    labels = load_silhouette_labels(paths, headers)
    _print_label_intro(labels, paths)

    config = DimensionReductionConfig(
        n_components=2,
        random_state=42,
        n_neighbors=15,
        perplexity=min(30, embeddings.shape[0] // 4),
    )

    metric_functions = default_metric_functions(labels)

    print(f"Benchmarking methods: {', '.join(METHODS)}")
    print(f"Metrics: {', '.join(metric_functions.keys())}\n")
    print("=" * 70)

    results = benchmark_methods(
        embeddings=embeddings,
        methods=METHODS,
        config=config,
        normalize=True,
        metric_functions=metric_functions,
    )

    print("\nRESULTS:")
    print("=" * 70)
    for method, result in results.items():
        print(f"\n{method.upper()}:")
        print(f"  Runtime: {result.time_seconds:.3f}s")
        print(f"  Shape: {result.projection.shape}")
        if result.metrics:
            print("  Metrics:")
            for name, value in result.metrics.items():
                if not np.isnan(value):
                    print(f"    {name}: {value:.6f}")
                else:
                    print(f"    {name}: NaN")

    paths.output_dir.mkdir(exist_ok=True, parents=True)

    for method, result in results.items():
        np.save(paths.output_dir / f"{method}_projection.npy", result.projection)

    metrics_data = []
    for method, result in results.items():
        row = {"method": method, "runtime_seconds": result.time_seconds}
        row.update(result.metrics)
        metrics_data.append(row)

    metrics_df = pd.DataFrame(metrics_data)
    metrics_csv = paths.output_dir / "metrics.csv"
    metrics_df.to_csv(metrics_csv, index=False)

    np.save(paths.headers_npy, np.array(headers, dtype=object))

    print(f"\nProjections saved to {paths.output_dir}/")
    print(f"Metrics saved to {metrics_csv}")
    print("=" * 70)


def _short(s: str, n: int = 26) -> str:
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _scatter_panel(ax, coords, labels, title, color_map, sizes_by_class) -> None:
    classes_sorted = sorted(
        color_map.keys(), key=lambda c: -sizes_by_class.get(c, 0)
    )
    for cls in classes_sorted:
        mask = labels == cls
        if not mask.any():
            continue
        ax.scatter(
            coords[mask, 0],
            coords[mask, 1],
            s=14,
            alpha=0.85,
            color=color_map[cls],
            label=f"{_short(cls)} (n={mask.sum()})",
            edgecolor="white",
            linewidth=0.25,
        )

    unl = np.array([lbl is None for lbl in labels])
    if unl.any():
        ax.scatter(
            coords[unl, 0],
            coords[unl, 1],
            s=8,
            alpha=0.35,
            color="lightgrey",
            label=f"unlabelled (n={unl.sum()})",
        )

    ax.set_title(title, fontsize=10)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.grid(alpha=0.15)


def render_projection_figure(paths: BenchmarkPaths) -> Path:
    """Write ``projections_<DATA>.png`` from saved ``*_projection.npy`` + metrics."""
    try:
        import matplotlib.pyplot as plt
    except ImportError as e:
        raise ImportError(
            "Plotting requires matplotlib. Install with: "
            "uv sync --extra benchmark"
        ) from e

    if not paths.output_dir.exists():
        raise FileNotFoundError(f"No results at {paths.output_dir}. Run benchmark first.")

    proj_files = sorted(paths.output_dir.glob("*_projection.npy"))
    if not proj_files:
        raise FileNotFoundError(f"No projections in {paths.output_dir}.")

    metrics_csv = paths.output_dir / "metrics.csv"
    metrics_df = (
        pd.read_csv(metrics_csv).set_index("method") if metrics_csv.exists() else None
    )

    headers = resolve_headers(paths)

    labels: np.ndarray
    if paths.bundle_path.exists():
        labels = load_labels_from_bundle(paths.bundle_path, headers)
        summary = label_summary(labels)
        print(
            f"Labels: {summary['n_labelled']}/{summary['n_total']} "
            f"proteins, {summary['n_classes']} classes"
        )
    else:
        print(f"[warn] No bundle at {paths.bundle_path} — points uncoloured")
        labels = np.array([None] * len(headers), dtype=object)

    classes = (
        pd.Series(labels).dropna().value_counts().index.tolist()
    )
    sizes_by_class = pd.Series(labels).value_counts(dropna=True).to_dict()
    cmap = plt.colormaps["tab20"](np.linspace(0, 1, max(len(classes), 1)))
    color_map = {cls: cmap[i] for i, cls in enumerate(classes)}

    n_methods = len(proj_files)
    n_cols = 3
    n_rows = (n_methods + n_cols - 1) // n_cols
    fig, axes = plt.subplots(
        n_rows, n_cols, figsize=(4.6 * n_cols, 4.4 * n_rows), squeeze=False
    )

    norm_stats = []
    for ax, proj_file in zip(axes.flat, proj_files, strict=False):
        method = proj_file.stem.replace("_projection", "")
        coords = np.load(proj_file)

        norm_stats.append(
            (
                method,
                tuple(coords.mean(axis=0).round(4)),
                tuple(coords.std(axis=0).round(4)),
                tuple(coords.min(axis=0).round(2)),
                tuple(coords.max(axis=0).round(2)),
            )
        )

        title_parts = [METHOD_TITLES.get(method, method.upper())]
        if metrics_df is not None and method in metrics_df.index:
            row = metrics_df.loc[method]
            extras = []
            if "trustworthiness" in row and not pd.isna(row["trustworthiness"]):
                extras.append(f"T={row['trustworthiness']:.3f}")
            if "silhouette" in row and not pd.isna(row["silhouette"]):
                extras.append(f"S={row['silhouette']:+.3f}")
            if "runtime_seconds" in row and not pd.isna(row["runtime_seconds"]):
                extras.append(f"{row['runtime_seconds']:.2f}s")
            if extras:
                title_parts.append("  ".join(extras))
        title = "\n".join(title_parts)

        _scatter_panel(ax, coords, labels, title, color_map, sizes_by_class)

    for ax in axes.flat[n_methods:]:
        ax.axis("off")

    print("\nNormalization sanity check (after normalize_projection):")
    print(f"  {'method':<10s} {'mean':<22s} {'std':<22s} {'min':<22s} {'max':<22s}")
    for method, m, s, lo, hi in norm_stats:
        print(f"  {method:<10s} {str(m):<22s} {str(s):<22s} {str(lo):<22s} {str(hi):<22s}")
    print(
        "\n→ After normalization, mean should be ~(0, 0). std should be similar "
        "across methods (unit-variance scaling)."
    )

    handles, labels_legend = axes.flat[0].get_legend_handles_labels()
    if handles:
        fig.legend(
            handles,
            labels_legend,
            loc="lower center",
            ncol=4,
            fontsize=8,
            frameon=False,
            bbox_to_anchor=(0.5, -0.04),
        )

    n_total = len(labels)
    n_lab = sum(1 for lbl in labels if lbl is not None)
    fig.suptitle(
        f"Benchmark projections — {paths.data}  "
        f"(n={n_total}, labelled={n_lab}, {len(classes)} classes)  ·  "
        f"T = trustworthiness ↑, S = silhouette ↑",
        fontsize=12,
        y=1.0,
    )
    fig.tight_layout()
    fig.savefig(paths.output_png, dpi=150, bbox_inches="tight")
    print(f"\nWrote {paths.output_png}")
    return paths.output_png


def plot_only_main(argv: list[str] | None = None) -> None:
    """CLI entry used by ``visualize.py`` (plot only, no DR re-run)."""
    p = argparse.ArgumentParser(description="Plot saved benchmark projections.")
    p.add_argument(
        "--data",
        default=os.environ.get("DATA", "3ftx"),
        help="Dataset name (default: env DATA or 3ftx)",
    )
    args = p.parse_args(argv)
    render_projection_figure(benchmark_paths(args.data))


def _parse_main_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark DR methods (optionally save projection figure)."
    )
    parser.add_argument(
        "--data",
        default=os.environ.get("DATA", "3ftx"),
        help="Dataset name (default: env DATA or 3ftx)",
    )
    parser.add_argument(
        "--plot",
        action="store_true",
        help="After benchmarking, write projections_<DATA>.png",
    )
    parser.add_argument(
        "--plot-only",
        action="store_true",
        help="Only render figure from existing results (no embedding required)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_main_args(argv)
    paths = benchmark_paths(args.data)

    if args.plot_only:
        render_projection_figure(paths)
        return

    run_benchmark(paths)
    if args.plot:
        render_projection_figure(paths)


if __name__ == "__main__":
    main()
