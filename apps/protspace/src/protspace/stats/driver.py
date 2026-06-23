"""Driver: build per-projection contexts, map to embeddings, run statistics.

For each reduction (projection) it selects the *source* embedding, id-joins the
embedding rows to the projection coordinates, reads the high-dim distance metric
from the reducer params, and runs every registered statistic — isolating
per-statistic failures so a partial/empty report never raises.
"""

from __future__ import annotations

import logging

import numpy as np

from protspace.stats import get_statistics
from protspace.stats.base import StatContext, StatsReport

logger = logging.getLogger(__name__)


def _select_embedding(reduction: dict, embedding_sets: list, emb_by_name: dict):
    """Pick the embedding set that produced this projection.

    Preference: explicit ``source`` name → single available embedding → the set
    whose headers best cover the projection's ids.
    """
    src = reduction.get("source") or reduction.get("embedding_name")
    if src and src in emb_by_name:
        return emb_by_name[src]
    if len(embedding_sets) == 1:
        return embedding_sets[0]
    red_ids = reduction.get("ids")
    if not red_ids:
        return None
    target = set(red_ids)
    best, best_overlap = None, 0
    for es in embedding_sets:
        overlap = len(target.intersection(es.headers))
        if overlap == len(target):
            return es  # exact id-set cover wins immediately (no ambiguous tie-break)
        if overlap > best_overlap:
            best, best_overlap = es, overlap
    return best


def _align(emb_set, red_ids, coords):
    """Id-intersection join of embedding rows to projection coordinates.

    Returns ``(coords_aligned, embedding_aligned, ids_aligned)`` or ``None``.
    Falls back to positional correspondence when the projection carries no ids
    and the row counts already match (the common single-embedding prepare path).
    """
    emb_headers = list(emb_set.headers)
    emb_data = np.asarray(emb_set.data, dtype=float)

    if not red_ids:
        if emb_data.shape[0] == coords.shape[0]:
            return coords, emb_data, emb_headers
        red_ids = emb_headers

    emb_index = {h: i for i, h in enumerate(emb_headers)}
    coord_rows: list[int] = []
    emb_rows: list[int] = []
    ids: list[str] = []
    for j, pid in enumerate(red_ids):
        i = emb_index.get(pid)
        if i is None:
            continue
        coord_rows.append(j)
        emb_rows.append(i)
        ids.append(pid)
    if not ids:
        return None
    return coords[coord_rows], emb_data[emb_rows], ids


def compute_statistics(
    embedding_sets: list,
    reductions: list[dict],
    *,
    rng_seed: int = 42,
    params: dict | None = None,
    statistics: list | None = None,
    default_metric: str = "euclidean",
) -> StatsReport:
    """Compute statistics for each projection.

    Args:
        embedding_sets: ``EmbeddingSet`` objects (``.name``, ``.data``, ``.headers``).
        reductions: dicts with ``name`` and ``data`` (coords); optionally ``source``
            (embedding name), ``ids`` (coords row identifiers), and ``info``
            (reducer params, used for the high-dim ``metric``).
        rng_seed: deterministic seed.
        params: tunables (``k``, ``k_max``, ``sample_threshold``, ``hard_ceiling``).

    Returns:
        A ``StatsReport`` (may be partial/empty; never raises on a statistic error).
    """
    params = params or {}
    stats = statistics if statistics is not None else get_statistics()
    report = StatsReport()
    emb_by_name = {es.name: es for es in embedding_sets}

    for red in reductions:
        try:
            space_name = red.get("name", "")
            full_coords = np.asarray(red["data"], dtype=float)
            red_ids = red.get("ids")
            full_ids = (
                list(red_ids)
                if red_ids is not None
                else [str(i) for i in range(full_coords.shape[0])]
            )

            info = red.get("info") or {}
            high_dim_metric = (
                (info.get("metric") if isinstance(info, dict) else None)
                or default_metric
                or "euclidean"
            )

            embedding = None
            embedding_coords = None
            embedding_ids = None
            embedding_name = None
            emb_set = _select_embedding(red, embedding_sets, emb_by_name)
            # Skip faithfulness for precomputed (similarity/distance) matrices —
            # an (n, n) matrix is not a high-dim embedding.
            if emb_set is not None and not getattr(emb_set, "precomputed", False):
                aligned = _align(emb_set, red_ids, full_coords)
                if aligned is not None:
                    embedding_coords, embedding, embedding_ids = aligned
                    embedding_name = emb_set.name

            ctx = StatContext(
                space_kind="projection",
                space_name=space_name,
                coords=full_coords,  # cluster_validity scores the FULL projection
                ids=full_ids,
                rng_seed=rng_seed,
                embedding=embedding,
                embedding_coords=embedding_coords,  # faithfulness scores this aligned subset
                embedding_ids=embedding_ids,
                embedding_name=embedding_name,
                high_dim_metric=high_dim_metric,
                params=params,
            )
        except Exception as exc:  # noqa: BLE001 - one bad reduction must not sink the report
            logger.warning(
                "statistics setup failed for projection '%s': %s", red.get("name"), exc
            )
            continue

        for stat in stats:
            if getattr(stat, "requires_embedding", False) and ctx.embedding is None:
                continue
            try:
                report.add(stat.compute(ctx))
            except Exception as exc:  # noqa: BLE001 - statistics are secondary
                logger.warning(
                    "statistic %s failed for projection '%s': %s",
                    getattr(stat, "family", stat),
                    ctx.space_name,
                    exc,
                )

    return report
