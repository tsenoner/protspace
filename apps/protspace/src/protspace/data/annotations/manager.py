"""
Protein annotation extraction manager.

This module provides the main orchestrator for annotation extraction workflow.
"""

import logging
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from protspace.data.annotations.configuration import (
    INTERNAL_ANNOTATIONS,
    SOURCE_ANNOTATIONS,
    SOURCE_CACHE_DEPENDENTS,
    TAXONOMY_LOOKUP_ANNOTATION,
    AnnotationConfiguration,
)
from protspace.data.annotations.encoding import (
    annotation_cache_version_attrs,
    stale_cache_columns,
)
from protspace.data.annotations.merging import AnnotationMerger
from protspace.data.annotations.retrievers.biocentral_retriever import (
    BIOCENTRAL_ANNOTATIONS,
    BiocentralPredictionRetriever,
)
from protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
    InterProRetriever,
)
from protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
    TaxonomyRetriever,
)
from protspace.data.annotations.retrievers.ted_retriever import (
    TED_ANNOTATIONS,
    TedRetriever,
)
from protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
    ProteinAnnotations,
    UniProtRetriever,
)
from protspace.data.annotations.transformers.transformer import AnnotationTransformer
from protspace.data.io.atomic import staged_write
from protspace.data.io.fasta import count_residues
from protspace.data.io.formatters import DataFormatter
from protspace.data.io.writers import AnnotationWriter

logger = logging.getLogger(__name__)

# Fetch order. Taxonomy, InterPro and Biocentral read UniProt's results (the
# organism and the sequence), so UniProt comes first.
SOURCE_ORDER = ("uniprot", "taxonomy", "interpro", "ted", "biocentral")
_SOURCE_COLUMNS: dict[str, list[str]] = {
    "uniprot": UNIPROT_ANNOTATIONS,
    "taxonomy": TAXONOMY_ANNOTATIONS,
    "interpro": INTERPRO_ANNOTATIONS,
    "ted": TED_ANNOTATIONS,
    "biocentral": BIOCENTRAL_ANNOTATIONS,
}

# The UniProtKB release(s) the cache's UniProt values came from, from the
# `X-UniProt-Release` header of the responses. Stored next to the cache version
# in `DataFrame.attrs`, which pandas round-trips through the parquet metadata,
# as a sorted, comma-separated string. Absent means unknown.
UNIPROT_RELEASE_ATTR = "protspace_uniprot_release"
UNKNOWN_RELEASE = "unknown"


def read_release_stamp(df: pd.DataFrame | None) -> set[str]:
    """Releases *df* records for its UniProt values, ``{"unknown"}`` if none."""
    stamp = None if df is None else df.attrs.get(UNIPROT_RELEASE_ATTR)
    if not isinstance(stamp, str):
        return {UNKNOWN_RELEASE}
    return {part.strip() for part in stamp.split(",") if part.strip()} or {
        UNKNOWN_RELEASE
    }


def _observed_releases(retriever) -> set[str]:
    """Releases a UniProt retriever saw in its responses' headers.

    Anything but a set (an older retriever, or a test's ``Mock``) counts as none
    seen, rather than as a release named after whatever the attribute holds.
    """
    releases = getattr(retriever, "releases", None)
    return {str(r) for r in releases} if isinstance(releases, set) else set()


def resolve_fasta_sequence_length(
    identifier: str,
    length: str,
    sequences: dict[str, str],
) -> str:
    """Return a FASTA-derived residue count, or *length* if none can be derived.

    Callers filter out non-empty lengths first: a UniProt length always wins.
    A sequence made up entirely of ``*``/``-`` markers has no residues, so it
    yields no usable length either and *length* is returned unchanged.
    """
    sequence = sequences.get(identifier)
    if not sequence:
        return length
    residues = count_residues(sequence)
    return str(residues) if residues > 0 else length


def uncached_headers(headers: list[str], cached_data: pd.DataFrame | None) -> list[str]:
    """Requested identifiers *cached_data* holds no row for, in request order.

    One rule, one implementation: the pipeline decides from it whether a cache
    may serve a run at all, and this manager decides from it which identifiers
    each source is fetched for. Two copies would let the pipeline serve a frame
    the manager knows is short.

    The identifier column is the frame's first, which is how the cache is
    written.
    """
    if cached_data is None or cached_data.empty:
        # No cache holds no rows, so every requested identifier is uncached.
        # Answering "none missing" here would let a caller serve an empty frame
        # as a complete one.
        return list(headers)
    cached_ids = set(cached_data[cached_data.columns[0]].astype(str))
    return [h for h in headers if str(h) not in cached_ids]


class ProteinAnnotationManager:
    """Orchestrator for protein annotation extraction workflow."""

    def __init__(
        self,
        headers: list[str],
        annotations: list = None,
        output_path: Path = None,
        sequences: dict = None,
        cached_data: pd.DataFrame = None,
        sources_to_fetch: dict = None,
        protect_cached_columns: bool = True,
    ):
        """
        Initialize annotation manager.

        Args:
            headers: List of protein identifiers/accessions
            annotations: List of annotations to extract (None = use defaults)
            output_path: Path to save output file (None = return DataFrame only)
            sequences: Dictionary mapping identifiers to sequences (for InterPro)
            cached_data: Previously cached DataFrame with annotations
            sources_to_fetch: Dict indicating which sources to fetch (uniprot, taxonomy, interpro)
            protect_cached_columns: Keep the values an existing cache holds for
                a source that did not finish, rather than dropping its columns.
                On by default: a source that failed emits empty values that
                cannot be told apart from a real absence, and values already
                cached were written by a run where that source completed. An
                explicit refetch turns this off, because there the cached values
                are what the user is trying to replace.
        """
        self.headers = headers
        self.output_path = output_path
        self.sequences = sequences
        self.cached_data = cached_data
        self._protect_cached_columns = protect_cached_columns
        # Sources whose retrieval did not complete this run. Their columns are
        # all-empty placeholders, indistinguishable from real absences, so they
        # must not reach the cache.
        self.incomplete_sources: set[str] = set()
        # Cache warnings already logged: checkpoints and the final write apply
        # the same rules, so they would otherwise repeat one warning per source.
        self._cache_warnings: set[str] = set()
        self._cached_values_memo: dict = {}
        # Sources fetched over the network this run that have returned, whether
        # or not they lost data.
        self._fetched_sources: set[str] = set()
        # How UniProt got its values this run (see `_fetch_plan`), and the
        # releases its fetches reported; None until a fetch has run.
        self._uniprot_mode: str | None = None
        self._fetched_releases: set[str] | None = None
        # Initialize configuration first so we can derive sources_to_fetch
        self.config = AnnotationConfiguration(annotations)
        self.user_annotations = self.config.user_annotations

        # Derive which sources to fetch from the requested annotations,
        # unless the caller explicitly specified sources_to_fetch
        if sources_to_fetch is not None:
            self.sources_to_fetch = sources_to_fetch
        else:
            self.sources_to_fetch = {
                "uniprot": True,  # Always needed (identifiers, organism_id)
                "taxonomy": self.config.taxonomy_annotations is not None,
                "interpro": self.config.interpro_annotations is not None,
                "ted": self.config.ted_annotations is not None,
                "biocentral": self.config.biocentral_annotations is not None,
            }

        # Initialize components
        self.transformer = AnnotationTransformer()
        self.merger = AnnotationMerger()
        self.writer = AnnotationWriter(transformer=self.transformer)

    @property
    def uniprot_fetch_failed(self) -> bool:
        """Whether the UniProt retrieval lost data this run."""
        return "uniprot" in self.incomplete_sources

    def to_pd(self) -> pd.DataFrame:
        """
        Main workflow: fetch → merge → transform → output.

        With an ``output_path``, the cache is also written after every source
        fetched over the network except the last, whose results the final write
        persists: sources finish hours apart at Swiss-Prot scale, and a crash in
        a late one must not cost the ones that already finished.

        Returns:
            DataFrame with requested annotations
        """
        # Track which annotation sources failed
        failed_sources = []

        # Identifiers this run wants that the cache has no row for. Every source
        # served from that cache is fetched for exactly these, so "added a few
        # sequences" costs a few lookups rather than a full refetch.
        fill_in = uncached_headers(self.headers, self.cached_data)
        self._cached_values_memo = {}
        self._fetched_sources = set()
        plan = self._fetch_plan(fill_in)
        self._uniprot_mode = plan["uniprot"]
        # Sources that go over the network this run, in fetch order.
        pending = [s for s in SOURCE_ORDER if plan[s] and self._requests(s)]

        # 1. Fetch each source (or reuse its cached values), in dependency order.
        results: dict = {}
        for source in SOURCE_ORDER:
            results[source] = self._retrieve(
                source, plan[source], results, fill_in, failed_sources
            )
            if source == "uniprot":
                results[source] = self._fill_missing_fasta_lengths(results[source])
            if source in pending:
                pending.remove(source)
                self._fetched_sources.add(source)
                # Only the checkpoint's copy of the source's old values was
                # still needed; the source's own result replaces it.
                self._cached_values_memo.pop(source, None)
                if pending and self.output_path:
                    self._write_checkpoint(results, pending, fill_in)

        # Report failed sources
        if failed_sources:
            logger.warning(
                f"Could not retrieve annotations from the following sources: {', '.join(failed_sources)}"
            )

        # 2. Merge annotations from all sources (including cached)
        # 3. Apply transformations
        transformed_annotations = self.transformer.transform(self._merge(results))
        self._cached_values_memo = {}

        # 4. Create output
        df = self._write_cache_and_frame(transformed_annotations)

        # 5. Remove internal-only columns from final output
        # (organism_id for taxonomy, sequence for InterPro)
        # Keep columns that the user explicitly requested
        internal_columns = INTERNAL_ANNOTATIONS
        if self.user_annotations:
            internal_columns = [
                col for col in internal_columns if col not in self.user_annotations
            ]
        columns_to_drop = [col for col in internal_columns if col in df.columns]
        if columns_to_drop:
            df = df.drop(columns=columns_to_drop)

        # 6. Filter columns if user requested specific annotations
        if self.user_annotations:
            annotations_to_keep = [
                ann for ann in self.user_annotations if ann in df.columns
            ]
            columns_to_keep = [df.columns[0]] + annotations_to_keep
            return df[columns_to_keep]

        return df

    def _requests(self, source: str) -> bool:
        """Whether this run asks *source* for anything, i.e. may call its API."""
        if source == "uniprot":
            return True  # Always needed (identifiers, organism_id)
        return bool(getattr(self.config, f"{source}_annotations"))

    def _cached_values(self, source: str):
        """The cache's values for *source*, in the shape its fetch returns.

        ``None`` without a cache. Memoized for the run: a pending source's
        cached values are read by every checkpoint written before it runs.
        """
        if self.cached_data is None:
            return None
        if source not in self._cached_values_memo:
            self._cached_values_memo[source] = (
                self._extract_cached_taxonomy(TAXONOMY_ANNOTATIONS)
                if source == "taxonomy"
                else self._extract_cached_source(_SOURCE_COLUMNS[source])
            )
        return self._cached_values_memo[source]

    def _fetch_plan(self, fill_in: list[str]) -> dict[str, str | None]:
        """How each source gets its values this run.

        ``"all"`` fetches it for every identifier, ``"fill"`` reuses its cached
        values and fetches only the identifiers the cache lacks, and ``None``
        serves it from the cache alone.
        """
        plan = {}
        for source in SOURCE_ORDER:
            if self.sources_to_fetch.get(source):
                plan[source] = "all"
            elif fill_in and self._cached_values(source):
                plan[source] = "fill"
            else:
                plan[source] = None
        return plan

    def _retrieve(
        self,
        source: str,
        mode: str | None,
        results: dict,
        fill_in: list[str],
        failed_sources: list,
    ):
        """Return *source*'s values for this run, fetching as *mode* says."""
        if mode is None:
            return self._cached_values(source)
        if source == "taxonomy":
            # Keyed by organism, not identifier: the helper looks up only the
            # organisms the cached values do not already resolve.
            cached = self._cached_values(source) if mode == "fill" else None
            return self._fetch_taxonomy(
                results["uniprot"], failed_sources, cached=cached
            )

        # Called exactly as before this loop existed: tests replace these
        # methods with functions that take no `headers` argument.
        headers = () if mode == "all" else (fill_in,)
        if source == "uniprot":
            fetched = self._fetch_uniprot(failed_sources, *headers)
        elif source == "interpro":
            fetched = self._fetch_interpro(results["uniprot"], failed_sources, *headers)
        elif source == "ted":
            fetched = self._fetch_ted(failed_sources, *headers)
        else:
            fetched = self._fetch_biocentral(
                results["uniprot"], failed_sources, *headers
            )
        if mode == "all":
            return fetched
        return list(self._cached_values(source)) + list(fetched)

    def _merge(self, values: dict) -> list[ProteinAnnotations]:
        """Merge per-source values into one record per protein."""
        return self.merger.merge(
            values["uniprot"],
            values["taxonomy"],
            values["interpro"],
            values["ted"],
            values["biocentral"],
        )

    def _write_checkpoint(
        self, results: dict, pending: list[str], fill_in: list[str]
    ) -> None:
        """Persist the sources finished so far, following the final write's rules.

        Two rules keep a checkpoint from storing a value nobody retrieved:

        - A source still waiting its turn contributes its cached columns, even
          one due to be refetched. Dropping them here would lose, say, a cached
          ``pfam`` while a newly requested ``smart`` waits for InterPro.
        - A row for an identifier the cache did not hold waits until every
          pending source the cache holds columns for has filled it in. Written
          earlier, it would carry empty values that read as "no annotation" to
          the next run. A pending source the cache holds nothing for has no
          column yet, so it holds no row back.

        A checkpoint left with no rows is skipped: everything this run fetched
        so far is still waiting, and writing the empty frame would only lose
        the cached rows.
        """
        values = {
            source: results[source]
            if source in results
            else self._cached_values(source)
            for source in SOURCE_ORDER
        }
        df = DataFormatter.to_dataframe(self.transformer.transform(self._merge(values)))
        waiting = set().union(*(SOURCE_ANNOTATIONS[s] for s in pending))
        cached_columns = set() if self.cached_data is None else self.cached_data.columns
        fill_rows = True
        if fill_in and waiting & set(cached_columns):
            new = {str(h) for h in fill_in}
            df = df[~df[df.columns[0]].astype(str).isin(new)].reset_index(drop=True)
            fill_rows = False
        if df.empty:
            return
        self._cache_frame(df, fill_rows=fill_rows, checkpoint=True)

    def _with_retained_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        """Append cached rows for identifiers outside this run, when they fit.

        A run for part of a dataset would otherwise replace the cache with its
        own rows, so alternating between two subsets refetches both forever. The
        rows only fit when this run produced the columns the cache already had:
        a row missing a column is an empty value nothing can tell from a real
        absence, which is the same trap incomplete sources are kept out for.
        """
        if self.cached_data is None or self.cached_data.empty:
            return df
        identifier_col = df.columns[0]
        cached = self.cached_data.rename(
            columns={self.cached_data.columns[0]: identifier_col}
        )
        if set(cached.columns) != set(df.columns):
            return df
        retained = cached[
            ~cached[identifier_col].astype(str).isin(df[identifier_col].astype(str))
        ]
        if retained.empty:
            return df
        return pd.concat([df, retained[df.columns]], ignore_index=True)

    def _uncacheable_sources(self) -> set[str]:
        """Sources that must stay out of the cache this run.

        A source that did not finish, plus every source whose cached columns are
        read back through it: taxonomy is looked up by UniProt's ``organism_id``,
        so caching taxonomy without it leaves a cache that reads as complete and
        resolves to nothing.
        """
        sources = set(self.incomplete_sources)
        for source in self.incomplete_sources:
            sources |= SOURCE_CACHE_DEPENDENTS.get(source, set())
        return sources

    def _incomplete_columns(self) -> set[str]:
        """Columns that must not reach the cache, by source."""
        return set().union(
            *(SOURCE_ANNOTATIONS[source] for source in self._uncacheable_sources())
        )

    def _write_cache_and_frame(
        self, proteins: list[ProteinAnnotations]
    ) -> pd.DataFrame:
        """Return the run's annotations, caching only the sources that completed.

        A source that did not finish emits all-empty values indistinguishable
        from a real absence, so caching them would make the next run's
        column-based completeness check reuse the gaps forever. Columns from
        sources that *did* finish are still worth caching, so only the
        incomplete ones are dropped (plus the sources that depend on them --
        see :meth:`_uncacheable_sources`).

        Dropping shrinks the cache, which is the right trade when the columns
        being dropped are untrustworthy but the wrong one when the cache already
        holds good values for them. So values the cache already holds for those
        columns are kept as they were, next to what the finished sources
        retrieved -- unless this run was an explicit refetch, where the user has
        said the cached values are the problem.
        """
        df = DataFormatter.to_dataframe(proteins)
        if self.output_path:
            self._cache_frame(df)
        return df

    def _cache_frame(
        self, df: pd.DataFrame, fill_rows: bool = True, checkpoint: bool = False
    ) -> None:
        """Write *df* to the cache under the rules :meth:`_write_cache_and_frame` sets.

        Shared by the final write and every checkpoint, so a checkpoint can never
        store what the final write would refuse to. *fill_rows* says whether the
        rows filled in for identifiers the cache lacked are in *df*. A checkpoint
        that declines to write says nothing: a later source may still finish, and
        the final write decides and warns.
        """
        df = self._run_rows(df)
        if df.empty:
            # Every row this run could write is still waiting for a source, and
            # writing the rest alone would only lose the cached rows.
            return
        drop = self._incomplete_columns()
        if not drop:
            self._write_with_retained_rows(df, fill_rows=fill_rows)
            return

        incomplete = ", ".join(sorted(self.incomplete_sources))
        remaining = set(df.columns) - drop - {"identifier"}
        without = df.drop(columns=[c for c in df.columns if c in drop])
        # An explicit refetch skips both guards: keeping the cached values there
        # would strand exactly the values the user asked to replace, and writing
        # without the failed source's columns is what removes them, so the next
        # run fetches that source instead of reading stale ones.
        protect = self._protect_cached_columns
        kept = self._kept_cached_values(drop) if protect else None
        if kept is not None:
            rows = self._with_kept_values(without, kept)
            if not rows.empty and self._fetched_sources - self._uncacheable_sources():
                self._warn_once(
                    "Caching annotations at %s with the values it already held "
                    "for %s: that source could not be fully retrieved, so its "
                    "cached values are kept and the proteins it has none for "
                    "are left for the next run.",
                    self.output_path,
                    incomplete,
                )
                self._write_kept(rows, kept, fill_rows=fill_rows)
                return
        if protect and (kept is not None or not remaining):
            if checkpoint:
                return
            reason = (
                "the cache already holds those columns, and nothing else this "
                "run retrieved can be written next to them"
                if kept is not None
                else "nothing else was retrieved either"
            )
            self._warn_once(
                "Not caching annotations at %s: %s could not be fully retrieved, "
                "and %s. This run's annotations are still returned. Use "
                "--refetch annotations to rewrite the cache regardless.",
                self.output_path,
                incomplete,
                reason,
            )
            return

        self._warn_once(
            "Caching annotations at %s without %s: that source could not be "
            "fully retrieved, so its columns are left out and the next run "
            "fetches it again instead of reusing empty values.",
            self.output_path,
            incomplete,
        )
        self._write_with_retained_rows(without, fill_rows=fill_rows)

    def _write_kept(
        self, rows: pd.DataFrame, kept: pd.DataFrame, *, fill_rows: bool
    ) -> None:
        """Write *rows*, which carry values kept from the cache, plus retained rows.

        When UniProt is among the sources that did not finish, the UniProt
        values written are the kept ones, so they keep the release the cache
        recorded for them.
        """
        retained = self._with_retained_rows(rows)
        if "uniprot" in self._uncacheable_sources():
            kept_uniprot = SOURCE_ANNOTATIONS["uniprot"] & set(kept.columns)
            releases = read_release_stamp(kept) if kept_uniprot else None
        else:
            # Rows the cache lacked have no kept value, so none of them is here
            # unless the cache already held it.
            filled = fill_rows and bool(
                uncached_headers(rows[rows.columns[0]].tolist(), self.cached_data)
            )
            releases = self._cached_releases(
                retained_rows=len(retained) > len(rows), fill_rows=filled
            )
        self._write_cache(retained, releases)

    def _kept_cached_values(self, drop: set[str]) -> pd.DataFrame | None:
        """The cache's current values for *drop*'s columns, or None if it has none.

        These are the values an incomplete source's empty placeholders must not
        replace. A column stored under superseded semantics is not among them:
        its values are wrong however the run went, so it is left out rather than
        written back under the current stamp. The frame's first column is the
        identifier, and its ``attrs`` are the cache's.
        """
        if not self.output_path.exists():
            return None
        names = pq.read_schema(self.output_path).names
        columns = [c for c in names[1:] if c in drop]
        if not columns:
            return None
        on_disk = pd.read_parquet(self.output_path, columns=[names[0], *columns])
        stale = stale_cache_columns(on_disk)
        if not set(columns) - stale:
            return None
        return on_disk.drop(columns=sorted(stale & set(columns)))

    @staticmethod
    def _with_kept_values(df: pd.DataFrame, kept: pd.DataFrame) -> pd.DataFrame:
        """*df*'s rows the cache holds, with *kept*'s columns added from it.

        A row the cache has no kept value for is left out: written with an
        empty cell, it would read as "no annotation" to the next run.
        """
        identifier_col = df.columns[0]
        lookup = kept.set_index(kept[kept.columns[0]].astype(str)).drop(
            columns=kept.columns[0]
        )
        lookup = lookup[~lookup.index.duplicated()]
        rows = df[df[identifier_col].astype(str).isin(lookup.index)]
        rows = rows.reset_index(drop=True)
        row_ids = rows[identifier_col].astype(str)
        for column in lookup.columns:
            rows[column] = row_ids.map(lookup[column]).to_numpy()
        return rows

    def _run_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        """*df*'s rows for this run's identifiers.

        A source fetched this run was fetched for these identifiers only, so a
        cached identifier outside the run has no value for it: the merge leaves
        that cell empty, and written as it is, the empty cell reads as "no
        annotation" to every later run, which then never fetches it. Rows outside
        the run are therefore taken from the cache instead, by
        :meth:`_with_retained_rows`, and only when they fit.
        """
        identifiers = df[df.columns[0]].astype(str)
        in_run = identifiers.isin({str(h) for h in self.headers})
        if in_run.all():
            return df
        return df[in_run].reset_index(drop=True)

    def _write_with_retained_rows(self, df: pd.DataFrame, *, fill_rows: bool) -> None:
        """Write *df* plus the cached rows outside the run that fit it."""
        retained = self._with_retained_rows(df)
        self._write_cache(
            retained,
            self._cached_releases(
                retained_rows=len(retained) > len(df), fill_rows=fill_rows
            ),
        )

    def _warn_once(self, message: str, *args) -> None:
        """Log a cache warning once per run, not once per checkpoint."""
        key = message % args
        if key in self._cache_warnings:
            return
        self._cache_warnings.add(key)
        logger.warning(message, *args)

    @property
    def uniprot_releases(self) -> set[str]:
        """UniProtKB release(s) this run's UniProt values came from.

        Fetched values carry the releases their responses reported, cached ones
        the release the cache records; either is ``"unknown"`` when not known.
        """
        return self._releases(retained_rows=False, fill_rows=True)

    def _releases(self, *, retained_rows: bool, fill_rows: bool) -> set[str]:
        """Releases of the UniProt values in a frame built from this run.

        *retained_rows*: the frame holds cached rows for identifiers outside
        the run. *fill_rows*: it holds the rows filled in this run.
        """
        fetched = self._fetched_releases or {UNKNOWN_RELEASE}
        if self._uniprot_mode == "all":
            cached = read_release_stamp(self.cached_data) if retained_rows else set()
            return fetched | cached
        cached = read_release_stamp(self.cached_data)
        if self._uniprot_mode == "fill" and fill_rows:
            return cached | fetched
        return cached

    def _cached_releases(
        self, *, retained_rows: bool, fill_rows: bool
    ) -> set[str] | None:
        """Releases to stamp on a cache write, or None if it has no UniProt values."""
        if "uniprot" in self._uncacheable_sources():
            return None
        return self._releases(retained_rows=retained_rows, fill_rows=fill_rows)

    def _write_cache(self, df: pd.DataFrame, releases: set[str] | None = None) -> None:
        """Persist *df* as the annotation cache, stamped with the current semantics.

        *releases* are the UniProt releases its values came from; they are
        recorded only when at least one is known, since no stamp already reads
        as unknown.
        """
        df = df.copy()
        df.attrs.pop(UNIPROT_RELEASE_ATTR, None)
        df.attrs.update(annotation_cache_version_attrs())
        if releases and releases != {UNKNOWN_RELEASE}:
            df.attrs[UNIPROT_RELEASE_ATTR] = ",".join(sorted(releases))
        # Staged: with retained rows folded in, this frame is a superset holding
        # rows for identifiers no other file has, so a half-written cache loses
        # data rather than costing one refetch.
        with staged_write(self.output_path) as staged:
            df.to_parquet(staged, index=False)

    def _fill_missing_fasta_lengths(
        self, proteins: list[ProteinAnnotations]
    ) -> list[ProteinAnnotations]:
        """Fill empty sequence lengths from matching local FASTA sequences.

        Rows that need no fallback are returned untouched; a filled row is
        returned as a copy so the fallback can never leak into a retriever's or
        the cache DataFrame's own dicts.
        """
        if not proteins or not self.sequences:
            return proteins

        filled = False
        key_missing = False
        result = []
        for protein in proteins:
            annotations = protein.annotations
            length = annotations.get("length", "")
            if "length" not in annotations:
                key_missing = True
            if length:
                result.append(protein)
                continue
            resolved = resolve_fasta_sequence_length(
                protein.identifier, length, self.sequences
            )
            if not resolved:
                result.append(protein)
                continue
            filled = True
            result.append(
                protein._replace(annotations={**annotations, "length": resolved})
            )

        if not filled:
            return proteins
        if not key_missing:
            return result

        # Downstream formatters derive their columns from the first row, so a
        # "length" key added to only some rows would be dropped (or silently
        # blanked) depending on row order. Keep the key on every row.
        return [
            protein
            if "length" in protein.annotations
            else protein._replace(annotations={**protein.annotations, "length": ""})
            for protein in result
        ]

    def _fetch_uniprot(
        self, failed_sources: list, headers: list[str] | None = None
    ) -> list[ProteinAnnotations]:
        """Fetch UniProt annotations for *headers* (default: the whole run)."""
        headers = self.headers if headers is None else headers
        try:
            retriever = UniProtRetriever(
                headers=headers,
                annotations=self.config.uniprot_annotations,
            )
            annotations = retriever.fetch_annotations()
        except Exception as e:
            self._record_releases(set())
            self.incomplete_sources.add("uniprot")
            failed_sources.append(f"UniProt ({str(e)})")
            logger.warning(f"Failed to retrieve UniProt annotations: {e}")
            return [
                ProteinAnnotations(
                    identifier=header, annotations={TAXONOMY_LOOKUP_ANNOTATION: ""}
                )
                for header in headers
            ]

        # Read outside the try: a problem reading the failure counter must not be
        # swallowed as "UniProt is unreachable" and discard a successful fetch.
        if retriever.failed_batch_count > 0:
            self.incomplete_sources.add("uniprot")
        self._record_releases(_observed_releases(retriever))
        return annotations

    def _record_releases(self, observed: set[str]) -> None:
        """Add one UniProt fetch's releases; a fetch that saw none adds unknown."""
        self._fetched_releases = (self._fetched_releases or set()) | (
            observed or {UNKNOWN_RELEASE}
        )

    def _fetch_taxonomy(
        self,
        uniprot_annotations: list[ProteinAnnotations],
        failed_sources: list,
        cached: dict | None = None,
    ) -> dict:
        """Fetch taxonomy for organisms *cached* does not already cover.

        Taxonomy is keyed by organism rather than by identifier, so a protein
        the cache never saw usually needs no lookup at all: its organism is
        almost always one the cache already resolved.
        """
        if not self.config.taxonomy_annotations:
            return {}

        cached = cached or {}
        try:
            # Extract unique taxonomy IDs
            taxon_counts = self._get_taxon_counts(uniprot_annotations)
            unique_taxons = [t for t in taxon_counts if t not in cached]

            if not unique_taxons:
                return dict(cached)

            retriever = TaxonomyRetriever(
                taxon_ids=unique_taxons, annotations=self.config.taxonomy_annotations
            )
            annotations = retriever.fetch_annotations()
            if retriever.failed_batch_count:
                self.incomplete_sources.add("taxonomy")
            return {**cached, **annotations}
        except Exception as e:
            self.incomplete_sources.add("taxonomy")
            failed_sources.append(f"Taxonomy ({str(e)})")
            logger.warning(f"Failed to retrieve Taxonomy annotations: {e}")
            # What was already resolved survives the failure. A fill-in run
            # reaches here to look up one unseen organism, and discarding
            # *cached* would blank the taxonomy columns of every protein in the
            # run over a lookup that only concerned the new ones.
            return dict(cached)

    def _build_sequence_map(
        self, uniprot_annotations: list[ProteinAnnotations]
    ) -> dict[str, str]:
        """Build a mapping from headers to sequences.

        Merges local sequences (from FASTA, priority) with UniProt results (fallback).
        """
        sequences = dict(self.sequences) if self.sequences else {}
        for protein in uniprot_annotations:
            seq = protein.annotations.get("sequence", "")
            if seq and protein.identifier not in sequences:
                sequences[protein.identifier] = seq
        return sequences

    def _starved_by_uniprot(
        self, source: str, label: str, headers: list[str], sequences: dict[str, str]
    ) -> None:
        """Mark *source* incomplete if a lost UniProt batch left it without sequences.

        InterPro and Biocentral look a protein up by its sequence, which comes
        from the FASTA or else from UniProt. When UniProt lost a batch, a protein
        with no sequence may be one of that batch's, so the source's empty value
        for it is a gap rather than "no match". With every UniProt batch
        answered, a missing sequence is genuine (an entry UniProt no longer
        has), and the source stays complete.
        """
        if "uniprot" not in self.incomplete_sources:
            return
        missing = sum(1 for h in dict.fromkeys(headers) if not sequences.get(h))
        if not missing:
            return
        self.incomplete_sources.add(source)
        logger.warning(
            f"{label} had no sequence for {missing} "
            f"protein{'' if missing == 1 else 's'} because UniProt did not return "
            f"every batch; {label} values are not cached this run and are "
            "requested again next run."
        )

    def _fetch_interpro(
        self,
        uniprot_annotations: list[ProteinAnnotations],
        failed_sources: list,
        headers: list[str] | None = None,
    ) -> list[ProteinAnnotations]:
        """Fetch InterPro annotations for *headers* (default: the whole run)."""
        if not self.config.interpro_annotations:
            return []

        headers = self.headers if headers is None else headers
        try:
            sequences = self._build_sequence_map(uniprot_annotations)
            self._starved_by_uniprot("interpro", "InterPro", headers, sequences)

            retriever = InterProRetriever(
                headers=headers,
                annotations=self.config.interpro_annotations,
                sequences=sequences,
            )
            annotations = retriever.fetch_annotations()
            if retriever.failed_batch_count:
                self.incomplete_sources.add("interpro")
            return annotations
        except Exception as e:
            self.incomplete_sources.add("interpro")
            failed_sources.append(f"InterPro ({str(e)})")
            logger.warning(f"Failed to retrieve InterPro annotations: {e}")
            return []

    def _fetch_biocentral(
        self,
        uniprot_annotations: list[ProteinAnnotations],
        failed_sources: list,
        headers: list[str] | None = None,
    ) -> list[ProteinAnnotations]:
        """Fetch Biocentral predictions for *headers* (default: the whole run)."""
        if not self.config.biocentral_annotations:
            return []

        headers = self.headers if headers is None else headers
        try:
            sequences = self._build_sequence_map(uniprot_annotations)
            self._starved_by_uniprot("biocentral", "Biocentral", headers, sequences)

            retriever = BiocentralPredictionRetriever(
                headers=headers,
                annotations=self.config.biocentral_annotations,
                sequences=sequences,
            )
            annotations = retriever.fetch_annotations()
            if retriever.prediction_failed:
                self.incomplete_sources.add("biocentral")
            return annotations
        except Exception as e:
            self.incomplete_sources.add("biocentral")
            failed_sources.append(f"Biocentral ({str(e)})")
            logger.warning(f"Failed to retrieve Biocentral predictions: {e}")
            return []

    def _fetch_ted(
        self, failed_sources: list, headers: list[str] | None = None
    ) -> list[ProteinAnnotations]:
        """Fetch TED domain annotations for *headers* (default: the whole run)."""
        if not self.config.ted_annotations:
            return []

        headers = self.headers if headers is None else headers
        try:
            retriever = TedRetriever(
                headers=headers,
                annotations=self.config.ted_annotations,
            )
            annotations = retriever.fetch_annotations()
            if retriever.failed_lookup_count:
                self.incomplete_sources.add("ted")
            return annotations
        except Exception as e:
            self.incomplete_sources.add("ted")
            failed_sources.append(f"TED ({str(e)})")
            logger.warning(f"Failed to retrieve TED annotations: {e}")
            return []

    @staticmethod
    def _get_taxon_counts(fetched_uniprot: list[ProteinAnnotations]) -> dict:
        """Returns a dictionary with organism IDs as keys and their occurrence counts as values."""
        id_counts = {}

        for protein in fetched_uniprot:
            organism_id = protein.annotations.get(TAXONOMY_LOOKUP_ANNOTATION)
            if organism_id:
                try:
                    org_id = int(organism_id)
                    id_counts[org_id] = id_counts.get(org_id, 0) + 1
                except ValueError:
                    pass

        return id_counts

    def _extract_cached_source(
        self, source_annotations: list[str]
    ) -> list[ProteinAnnotations]:
        """
        Extract cached annotations for a specific source (UniProt or InterPro).

        Args:
            source_annotations: List of annotation names from this source

        Returns:
            List of ProteinAnnotations with cached data for this source
        """
        if self.cached_data is None:
            return []

        # Find available annotations from this source in cache
        available = [f for f in source_annotations if f in self.cached_data.columns]
        if not available:
            return []

        # Column-wise rather than `iterrows`: the cache retains rows for
        # identifiers outside the run, so this walks the whole frame on every
        # fill-in run, and `iterrows` builds a Series per row (and upcasts a
        # mixed-dtype row to one common dtype on the way).
        identifier_col = self.cached_data.columns[0]  # First column is identifier
        identifiers = self.cached_data[identifier_col].tolist()
        columns = {a: self.cached_data[a].tolist() for a in available}

        return [
            ProteinAnnotations(
                identifier=identifier,
                annotations={a: values[i] for a, values in columns.items()},
            )
            for i, identifier in enumerate(identifiers)
        ]

    def _extract_cached_taxonomy(self, taxonomy_annotations: list[str]) -> dict:
        """
        Extract cached taxonomy annotations.

        Args:
            taxonomy_annotations: List of taxonomy annotation names

        Returns:
            Dict mapping organism_id to taxonomy annotations (same format as TaxonomyRetriever)
        """
        if (
            self.cached_data is None
            or TAXONOMY_LOOKUP_ANNOTATION not in self.cached_data.columns
        ):
            return {}

        # Find available taxonomy annotations in cache
        available = [f for f in taxonomy_annotations if f in self.cached_data.columns]
        if not available:
            return {}

        # Convert to taxonomy format: {organism_id: {"annotations": {annotation: value}}}
        taxonomy_dict = {}

        # Column-wise for the same reason as `_extract_cached_source`: the cache
        # is a superset of the run and `iterrows` costs a Series per row.
        organism_ids = self.cached_data[TAXONOMY_LOOKUP_ANNOTATION].tolist()
        columns = {a: self.cached_data[a].tolist() for a in available}

        # Group by organism_id
        for i, organism_id in enumerate(organism_ids):
            if pd.isna(organism_id) or organism_id == "":
                continue

            try:
                org_id = int(organism_id)
                if org_id not in taxonomy_dict:
                    taxonomy_dict[org_id] = {
                        "annotations": {a: values[i] for a, values in columns.items()}
                    }
            except (ValueError, TypeError):
                pass

        return taxonomy_dict
