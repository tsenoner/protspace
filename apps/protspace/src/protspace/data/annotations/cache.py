"""Deciding what an annotation run reuses from its cache and what it fetches.

``prepare`` (through :class:`~protspace.data.processors.pipeline.ReductionPipeline`)
and ``annotate --cache-dir`` read and write the same cache file,
``all_annotations.parquet``. Both go through :func:`fetch_annotations`, so they
apply the same reuse, fill-in, legacy-refresh and ``--refetch`` rules and a cache
one command wrote reads the same to the other.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from protspace.data.annotations.configuration import SOURCE_ANNOTATIONS
from protspace.data.io.atomic import staged_write

logger = logging.getLogger(__name__)

CACHE_FILENAME = "all_annotations.parquet"

# The annotation sources, which are also the annotation stages `--refetch`
# accepts.
_ANN_SOURCES = tuple(SOURCE_ANNOTATIONS)

# Before the source-label fix, a TED domain with no CATH assignment was
# formatted as `unclassified|{plddt}`; it now keeps TED's own `-`. Anchored to a
# domain boundary so an encoded CATH name that merely contains the word cannot
# match. The boundary itself is captured so the rewrite can restore it.
_LEGACY_TED_LABEL_RE = r"(^|;)unclassified(?=\|)"


@dataclass
class AnnotationFetch:
    """The annotations a run produced, and what it could not retrieve."""

    frame: pd.DataFrame
    # Sources whose retrieval did not complete this run; their values in
    # `frame` are empty placeholders, not genuine absences.
    incomplete_sources: set[str] = field(default_factory=set)
    # UniProtKB release(s) the UniProt values in `frame` came from, fetched or
    # cached; "unknown" stands for values whose release was never recorded.
    uniprot_releases: set[str] = field(default_factory=set)


def _from_manager(manager, frame: pd.DataFrame) -> AnnotationFetch:
    return AnnotationFetch(
        frame, set(manager.incomplete_sources), set(manager.uniprot_releases)
    )


def _migrate_legacy_ted_labels(df: pd.DataFrame) -> bool:
    """Rewrite pre-fix TED labels in *df* in place. True if anything changed.

    Annotation caches store already-formatted values and never re-run the
    formatter, so a cache written before the source-label fix keeps serving
    `unclassified`. Rewriting the stored string is the exact inverse of that
    fix: the old formatter's unlabeled branch differed from today's only in the
    literal it emitted, so this reproduces a refetch of the column without a
    single HTTP call — the alternative being one sequential request per
    accession. Mirrors how `encoding.migrate_legacy_annotation_table` repairs
    v1 cells on read.
    """
    from protspace.data.annotations.retrievers.ted_retriever import TED_ANNOTATIONS

    migrated = False
    for column in TED_ANNOTATIONS:
        values = df.get(column)
        if values is None:
            continue
        # Literal pre-filter: the anchored regex costs ~10x more per row, and
        # every run after the migration scans a clean column.
        if not values.str.contains("unclassified", regex=False, na=False).any():
            continue
        repaired = values.str.replace(_LEGACY_TED_LABEL_RE, r"\1-", regex=True)
        if not repaired.equals(values):
            df[column] = repaired
            migrated = True
    return migrated


def _restore_cached_columns(api_df: pd.DataFrame, cached: pd.DataFrame) -> pd.DataFrame:
    """Refill blank cells in ``api_df`` from ``cached``, matched on identifier.

    Only blanks are refilled, so anything the current run did retrieve wins
    and a protein absent from the cache simply stays blank.
    """
    columns = [c for c in cached.columns if c != "identifier" and c in api_df.columns]
    if not columns or "identifier" not in api_df.columns:
        return api_df

    lookup = cached.drop_duplicates(subset="identifier").set_index("identifier")
    restored = api_df.copy()
    for column in columns:
        fallback = restored["identifier"].map(lookup[column]).fillna("")
        blank = restored[column].isna() | (restored[column].astype(str) == "")
        restored.loc[blank, column] = fallback[blank]
    return restored


def fetch_annotations(
    headers: list[str],
    annotations: list[str] | None,
    *,
    sequences: dict[str, str] | None = None,
    cache_path: Path | None = None,
    refetch: frozenset[str] = frozenset(),
) -> AnnotationFetch:
    """Return annotations for *headers*, reusing and updating the cache at *cache_path*.

    Args:
        headers: Protein identifiers, in output order.
        annotations: Validated annotation names, or ``None`` for the default
            group.
        sequences: Identifier-to-sequence map from a local FASTA, if any.
        cache_path: The ``all_annotations.parquet`` to read and write; ``None``
            fetches everything and writes no cache.
        refetch: Stages to fetch again despite the cache. Stages other than the
            annotation sources are ignored.
    """
    from protspace.data.annotations.configuration import (
        ANNOTATION_GROUPS,
        TAXONOMY_LOOKUP_ANNOTATION,
        AnnotationConfiguration,
    )
    from protspace.data.annotations.encoding import stale_cache_columns

    # Looked up at call time rather than imported at module level: tests
    # replace the manager class on its own module.
    from protspace.data.annotations.manager import (
        ProteinAnnotationManager,
        read_release_stamp,
        resolve_fasta_sequence_length,
        uncached_headers,
    )

    sequences = sequences or {}
    refetch = frozenset(refetch) & frozenset(_ANN_SOURCES)
    refetching_annotations = bool(refetch)

    if cache_path is None:
        manager = ProteinAnnotationManager(
            headers=headers,
            annotations=annotations,
            output_path=None,
            sequences=sequences,
        )
        return _from_manager(manager, manager.to_pd())

    if not cache_path.exists():
        manager = ProteinAnnotationManager(
            headers=headers,
            annotations=annotations,
            output_path=cache_path,
            sequences=sequences,
        )
        return _from_manager(manager, manager.to_pd())

    cached_df = pd.read_parquet(cache_path)
    missing_identifiers = uncached_headers(headers, cached_df)
    if missing_identifiers:
        # Rows the cache has no entry for. The manager fetches each source
        # for exactly these and reuses cached values for the rest, so the
        # cache is filled in rather than rebuilt.
        logger.warning(
            "Annotation cache lacks %d of %d requested identifier(s); "
            "fetching annotations for them",
            len(missing_identifiers),
            len(headers),
        )

    # Repair at the cache-read boundary, which dominates every path that
    # reuses a stored column, then persist so it stays a one-time cost rather
    # than a rewrite on every resumed run.
    if _migrate_legacy_ted_labels(cached_df):
        logger.info(
            "Rewrote legacy 'unclassified' TED domain labels in the "
            "cached annotations to TED's '-'."
        )
        with staged_write(cache_path) as staged:
            cached_df.to_parquet(staged, index=False)
    cached_annotations = set(cached_df.columns) - {"identifier"}

    if annotations is None:
        required = set(ANNOTATION_GROUPS["default"])
    else:
        required = set(annotations)

    # Values stored under a superseded contract cannot be repaired locally —
    # a legacy xref_pdb "True", for instance, may be a genuine PDB hit or an
    # empty that was transformed twice.
    stale_columns = stale_cache_columns(cached_df)
    # Only pay a refetch for the ones this run actually surfaces. Without an
    # explicit -a the whole cached frame is emitted, so treat that as
    # consuming all of them.
    refresh_columns = stale_columns if annotations is None else stale_columns & required
    discard_columns = stale_columns - refresh_columns
    if discard_columns:
        # Unused this run, so drop rather than refetch: they must not ride
        # along into a cache this run stamps as current. A later run that
        # requests one sees it missing and fetches it through the ordinary
        # path.
        logger.info(
            "Dropping legacy cached column(s) "
            f"{', '.join(sorted(discard_columns))}: not requested by "
            "this run and stored under superseded semantics"
        )
        cached_df = cached_df.drop(columns=sorted(discard_columns))
        cached_annotations -= discard_columns

    missing = required - cached_annotations

    if (
        not missing
        and not missing_identifiers
        and not refetching_annotations
        and not refresh_columns
    ):
        logger.warning("Using cached annotations")
        if annotations:
            cols = ["identifier"] + [f for f in annotations if f in cached_df.columns]
            api_df = cached_df[cols]
        else:
            api_df = cached_df

        # Warn if cached annotations are all empty. Checked *before* the FASTA
        # length fallback below, otherwise a derived length makes a wholly
        # useless cache look populated and silently suppresses this warning.
        data_cols = [c for c in api_df.columns if c != "identifier"]
        if data_cols:
            non_empty = api_df[data_cols].apply(lambda col: (col != "").any())
            if not non_empty.any():
                logger.warning(
                    "All cached annotations are empty. This may be "
                    "from a previous run with non-UniProt identifiers. "
                    "Use --refetch annotations to re-fetch, or provide "
                    "a FASTA file with -f."
                )

        if "length" in api_df.columns and sequences:
            missing_lengths = ~api_df["length"].astype(bool)
            if missing_lengths.any():
                api_df = api_df.copy()
                api_df.loc[missing_lengths, "length"] = [
                    resolve_fasta_sequence_length(identifier, length, sequences)
                    for identifier, length in zip(
                        api_df.loc[missing_lengths, "identifier"],
                        api_df.loc[missing_lengths, "length"],
                        strict=True,
                    )
                ]

        return AnnotationFetch(api_df, uniprot_releases=read_release_stamp(cached_df))

    sources = AnnotationConfiguration.determine_sources_to_fetch(
        cached_annotations, required
    )

    if refetching_annotations:
        # Override with explicitly requested sources
        sources = {src: src in refetch for src in _ANN_SOURCES}
        logger.info(
            f"--refetch: re-fetching {', '.join(s for s in _ANN_SOURCES if sources[s])}"
        )
    migration_sources = set()
    if refresh_columns:
        stale_by_source = AnnotationConfiguration.categorize_annotations_by_source(
            refresh_columns
        )
        migration_sources = {
            source for source, columns in stale_by_source.items() if columns
        }
        if "interpro" in migration_sources and "sequence" not in cached_annotations:
            # InterPro is looked up by sequence, so a refresh from a cache
            # without one would find nothing and stamp that as current. Fetch
            # the sequences as a missing InterPro column would
            # (`determine_sources_to_fetch`).
            migration_sources.add("uniprot")
        for source in migration_sources:
            sources[source] = True
        logger.warning(
            "Refreshing legacy annotation cache column(s) "
            f"{', '.join(sorted(refresh_columns))} to apply current "
            "semantics"
        )

    legacy_uniprot = None
    if refetching_annotations or refresh_columns:
        # Drop cached columns for refetched sources so manager re-fetches them
        cached_by_source = AnnotationConfiguration.categorize_annotations_by_source(
            cached_annotations
        )
        cols_to_drop = set().union(
            *(cached_by_source[s] for s in _ANN_SOURCES if sources[s])
        )
        if cached_by_source["taxonomy"] and not sources["taxonomy"]:
            cols_to_drop.discard(TAXONOMY_LOOKUP_ANNOTATION)
        if "uniprot" in migration_sources and "uniprot" not in refetch:
            # Keep what the migration is about to discard. If its refresh
            # fails, these cached values beat the empty annotations a failed
            # fetch produces — except the stale columns themselves, whose
            # ambiguity is the whole reason for the migration.
            preserved = [
                c
                for c in cached_by_source["uniprot"]
                if c not in refresh_columns and c in cached_df.columns
            ]
            if preserved:
                legacy_uniprot = cached_df[["identifier", *preserved]].copy()
        cached_df = cached_df.drop(
            columns=[c for c in cols_to_drop if c in cached_df.columns]
        )
    else:
        logger.info(f"Missing annotations: {missing}")

    manager = ProteinAnnotationManager(
        headers=headers,
        annotations=annotations,
        output_path=cache_path,
        sequences=sequences,
        cached_data=cached_df,
        sources_to_fetch=sources,
        # --refetch annotations is the documented remedy for a cache poisoned
        # by an earlier partial failure, so there the cached columns are
        # exactly what must not be protected. The failed source is still
        # dropped rather than written empty, so the poison leaves the cache
        # and the next run refetches it.
        protect_cached_columns=not refetching_annotations,
    )
    fetched = _from_manager(manager, manager.to_pd())
    if legacy_uniprot is not None and manager.uniprot_fetch_failed:
        logger.warning(
            "Legacy UniProt cache refresh failed; reusing the cached "
            "annotations for this run and leaving the cache "
            "unversioned so a later run retries the refresh"
        )
        fetched.frame = _restore_cached_columns(fetched.frame, legacy_uniprot)
        fetched.uniprot_releases |= read_release_stamp(legacy_uniprot)
    return fetched
