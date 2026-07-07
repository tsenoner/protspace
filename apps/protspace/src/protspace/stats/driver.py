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


def _run_stats(
    report: StatsReport, ctx: StatContext, stats: list, *, kind: str
) -> None:
    """Run each statistic on ``ctx``, isolating per-statistic failures.

    ``kind`` (``projection`` | ``embedding``) only tags the warning message.
    """
    for stat in stats:
        try:
            report.add(stat.compute(ctx))
        except Exception as exc:  # noqa: BLE001 - statistics are secondary
            logger.warning(
                "statistic %s failed for %s '%s': %s",
                getattr(stat, "family", stat),
                kind,
                ctx.space_name,
                exc,
            )


def _select_embedding(reduction: dict, embedding_sets: list, emb_by_name: dict):
    """Pick the embedding set that produced this projection.

    Preference: explicit ``source`` name → single available embedding → the set
    whose headers uniquely best cover the projection's ids. Returns ``None`` when
    the choice is ambiguous (several embeddings cover the ids equally well and no
    ``source`` disambiguates them) — guessing would score faithfulness against the
    wrong high-dim space, so we skip it instead.
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
    exact = [es for es in embedding_sets if target.issubset(es.headers)]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None  # several embeddings fully cover the ids → ambiguous, abstain
    # No exact cover: take the single best partial overlap, abstaining on a tie.
    best, best_overlap, tied = None, 0, False
    for es in embedding_sets:
        overlap = len(target.intersection(es.headers))
        if overlap > best_overlap:
            best, best_overlap, tied = es, overlap, False
        elif overlap == best_overlap and overlap > 0:
            tied = True
    return None if tied else best


def _align(emb_set, red_ids, coords):
    """Id-intersection join of embedding rows to projection coordinates.

    Returns ``(coords_aligned, embedding_aligned, ids_aligned)`` or ``None``.
    Falls back to positional correspondence when the projection carries no ids
    and the row counts already match (the common single-embedding prepare path).
    """
    emb_headers = list(emb_set.headers)
    # Keep the native dtype (float32): faithfulness upcasts only its bounded
    # subsample, so a full float64 copy of a 570k-row embedding per projection
    # would be wasted — especially when faithfulness then skips past its ceiling.
    emb_data = np.asarray(emb_set.data)

    if not red_ids:
        if emb_data.shape[0] == coords.shape[0]:
            return coords, emb_data, emb_headers
        # No ids to join on and the row counts differ → alignment is impossible.
        # Falling through to positional indexing over emb_headers would pair
        # mismatched rows (or IndexError when the embedding has more rows than the
        # projection, whose except-swallow drops the projection's whole report).
        # Return None so faithfulness is skipped while cluster_validity still runs.
        return None

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
    annotations: dict | None = None,
) -> StatsReport:
    """Compute statistics for each projection.

    Args:
        embedding_sets: ``EmbeddingSet`` objects (``.name``, ``.data``, ``.headers``).
        reductions: dicts with ``name`` and ``data`` (coords); optionally ``source``
            (embedding name), ``ids`` (coords row identifiers), and ``info``
            (reducer params, used for the high-dim ``metric``).
        rng_seed: deterministic seed.
        params: tunables — ``k``, ``k_max``, ``sample_threshold``, ``hard_ceiling``,
            ``max_fit_sample``, ``n_triplets_per_point``; ``cluster_selection``
            (``elbow`` | ``silhouette`` | ``both``); ``cluster_annotations`` and
            ``include_scores`` (per-protein membership column + attached silhouette).
        annotations: annotation name -> {protein id -> category label}. When
            supplied, threaded into every projection's ``StatContext`` and also
            drives a once-per-embedding pass (see below) so annotation-validity
            statistics can score the source embedding as a separability ceiling.

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
                annotations=annotations,
            )
        except Exception as exc:  # noqa: BLE001 - one bad reduction must not sink the report
            logger.warning(
                "statistics setup failed for projection '%s': %s", red.get("name"), exc
            )
            continue

        runnable = [
            s
            for s in stats
            if not getattr(s, "requires_embedding", False) or ctx.embedding is not None
        ]
        _run_stats(report, ctx, runnable, kind="projection")

    # Once-per-embedding pass: annotation-validity on the source embedding itself
    # (the true-separability "ceiling"), computed once per embedding rather than
    # repeated for every projection that shares it. Only statistics that opt in
    # via ``embedding_space`` run here — skip the whole pass when none do so we
    # don't build the (large) embedding context for nothing.
    emb_stats = [s for s in stats if getattr(s, "embedding_space", False)]
    if annotations and emb_stats:
        for es in embedding_sets:
            if getattr(es, "precomputed", False):
                continue
            try:
                ectx = StatContext(
                    space_kind="embedding",
                    space_name=es.name,
                    # Keep the embedding at its native dtype (float32); the scored
                    # statistic upcasts only its bounded subsample, not all 570k rows.
                    coords=np.asarray(es.data),
                    ids=list(es.headers),
                    rng_seed=rng_seed,
                    params=params,
                    annotations=annotations,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "embedding-stats setup failed for '%s': %s", es.name, exc
                )
                continue
            _run_stats(report, ectx, emb_stats, kind="embedding")

    return report
