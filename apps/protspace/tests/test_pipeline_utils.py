"""Tests for pipeline utility functions."""

import logging
from collections import Counter
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from protspace.data.loaders.embedding_set import (
    EmbeddingSet,
    format_param_suffix,
    format_projection_name,
    merge_same_name_sets,
)
from protspace.data.processors.pipeline import (
    MethodSpec,
    PipelineConfig,
    ReductionPipeline,
    _migrate_legacy_ted_labels,
    _run_with_overridden_config,
    disambiguation_suffix,
    parse_method_spec,
    parse_methods_arg,
)

# ---------------------------------------------------------------------------
# parse_method_spec
# ---------------------------------------------------------------------------


class TestParseMethodSpec:
    def test_pca2(self):
        spec = parse_method_spec("pca2")
        assert spec.method == "pca"
        assert spec.dims == 2
        assert spec.overrides == ()

    def test_umap3(self):
        spec = parse_method_spec("umap3")
        assert spec.method == "umap"
        assert spec.dims == 3

    def test_tsne2(self):
        spec = parse_method_spec("tsne2")
        assert spec.method == "tsne"
        assert spec.dims == 2

    def test_pacmap2(self):
        spec = parse_method_spec("pacmap2")
        assert spec.method == "pacmap"
        assert spec.dims == 2

    def test_mds2(self):
        spec = parse_method_spec("mds2")
        assert spec.method == "mds"
        assert spec.dims == 2

    def test_localmap2(self):
        spec = parse_method_spec("localmap2")
        assert spec.method == "localmap"
        assert spec.dims == 2

    def test_invalid_no_digits(self):
        with pytest.raises(ValueError):
            parse_method_spec("pca")


# ---------------------------------------------------------------------------
# parse_method_spec with overrides
# ---------------------------------------------------------------------------


class TestParseMethodSpecWithOverrides:
    def test_single_override(self):
        spec = parse_method_spec("umap2:n_neighbors=50")
        assert spec.method == "umap"
        assert spec.dims == 2
        assert spec.overrides_dict == {"n_neighbors": 50}

    def test_multiple_overrides_semicolon(self):
        spec = parse_method_spec("umap2:n_neighbors=50;min_dist=0.1")
        assert spec.overrides_dict == {"n_neighbors": 50, "min_dist": 0.1}

    def test_int_coercion(self):
        spec = parse_method_spec("umap2:n_neighbors=100")
        assert isinstance(spec.overrides_dict["n_neighbors"], int)

    def test_float_coercion(self):
        spec = parse_method_spec("umap2:min_dist=0.5")
        assert isinstance(spec.overrides_dict["min_dist"], float)

    def test_string_metric(self):
        spec = parse_method_spec("umap2:metric=cosine")
        assert spec.overrides_dict["metric"] == "cosine"

    def test_unknown_param_raises(self):
        with pytest.raises(ValueError, match="Unknown parameter 'bogus'"):
            parse_method_spec("umap2:bogus=5")

    def test_missing_value_raises(self):
        with pytest.raises(ValueError, match="Invalid parameter format"):
            parse_method_spec("umap2:n_neighbors")

    def test_empty_params_after_colon(self):
        spec = parse_method_spec("umap2:")
        assert spec.overrides == ()

    def test_overrides_are_sorted(self):
        spec = parse_method_spec("umap2:min_dist=0.1;n_neighbors=50")
        keys = [k for k, _ in spec.overrides]
        assert keys == sorted(keys)


# ---------------------------------------------------------------------------
# MethodSpec
# ---------------------------------------------------------------------------


class TestMethodSpec:
    def test_str_no_overrides(self):
        spec = MethodSpec("pca", 2)
        assert str(spec) == "pca2"

    def test_str_with_overrides(self):
        spec = MethodSpec("umap", 2, (("min_dist", 0.1), ("n_neighbors", 50)))
        assert str(spec) == "umap2:min_dist=0.1;n_neighbors=50"

    def test_overrides_dict(self):
        spec = MethodSpec("umap", 2, (("n_neighbors", 50),))
        assert spec.overrides_dict == {"n_neighbors": 50}

    def test_equality(self):
        a = parse_method_spec("umap2:n_neighbors=50")
        b = parse_method_spec("umap2:n_neighbors=50")
        assert a == b

    def test_hashable(self):
        spec = parse_method_spec("umap2:n_neighbors=50")
        assert hash(spec) == hash(spec)


# ---------------------------------------------------------------------------
# parse_methods_arg
# ---------------------------------------------------------------------------


class TestParseMethodsArg:
    def test_single_comma_separated(self):
        result = parse_methods_arg(["pca2,umap2"])
        assert len(result) == 2
        assert result[0].method == "pca"
        assert result[1].method == "umap"

    def test_repeated(self):
        result = parse_methods_arg(["pca2", "umap2"])
        assert len(result) == 2

    def test_mixed_with_overrides(self):
        result = parse_methods_arg(["pca2", "umap2:n_neighbors=50;min_dist=0.1"])
        assert len(result) == 2
        assert result[1].overrides_dict == {"n_neighbors": 50, "min_dist": 0.1}

    def test_comma_separated_with_overrides(self):
        result = parse_methods_arg(["pca2,umap2:n_neighbors=50;min_dist=0.1,tsne2"])
        assert len(result) == 3
        assert result[0].method == "pca"
        assert result[1].overrides_dict == {"n_neighbors": 50, "min_dist": 0.1}
        assert result[2].method == "tsne"

    def test_deduplicates(self):
        result = parse_methods_arg(["umap2", "umap2"])
        assert len(result) == 1

    def test_different_overrides_not_deduped(self):
        result = parse_methods_arg(["umap2:n_neighbors=50", "umap2:n_neighbors=100"])
        assert len(result) == 2

    def test_backward_compatible(self):
        result = parse_methods_arg(["pca2,umap2,tsne2"])
        assert len(result) == 3

    def test_strips_whitespace(self):
        result = parse_methods_arg(["  pca2 , umap2  "])
        assert len(result) == 2

    def test_skips_empty_parts(self):
        result = parse_methods_arg(["pca2,,umap2"])
        assert len(result) == 2


# ---------------------------------------------------------------------------
# format_projection_name
# ---------------------------------------------------------------------------


class TestFormatProjectionName:
    def test_known_model_and_method(self):
        assert format_projection_name("prot_t5", "pca", 2) == "ProtT5 — PCA 2"

    def test_esm2(self):
        assert format_projection_name("esm2_650m", "umap", 2) == "ESM2-650M — UMAP 2"

    def test_mmseqs2(self):
        assert format_projection_name("MMseqs2", "mds", 2) == "MMseqs2 — MDS 2"

    def test_unknown_model_passthrough(self):
        assert (
            format_projection_name("custom_model", "pca", 3) == "custom_model — PCA 3"
        )

    def test_unknown_method_uppercased(self):
        assert (
            format_projection_name("prot_t5", "newmethod", 2) == "ProtT5 — NEWMETHOD 2"
        )

    def test_3d(self):
        assert format_projection_name("prot_t5", "tsne", 3) == "ProtT5 — t-SNE 3"

    def test_with_param_suffix(self):
        assert (
            format_projection_name("prot_t5", "umap", 2, "n=50, d=0.1")
            == "ProtT5 — UMAP 2 (n=50, d=0.1)"
        )

    def test_empty_suffix_no_parens(self):
        assert format_projection_name("prot_t5", "pca", 2, "") == "ProtT5 — PCA 2"


# ---------------------------------------------------------------------------
# format_param_suffix
# ---------------------------------------------------------------------------


class TestFormatParamSuffix:
    def test_single_param(self):
        assert format_param_suffix({"n_neighbors": 50}) == "n=50"

    def test_multiple_params_sorted(self):
        assert (
            format_param_suffix({"n_neighbors": 50, "min_dist": 0.1}) == "d=0.1, n=50"
        )

    def test_string_value(self):
        assert format_param_suffix({"metric": "cosine"}) == "m=cosine"

    def test_unknown_key_passthrough(self):
        assert format_param_suffix({"custom_key": 42}) == "custom_key=42"


# ---------------------------------------------------------------------------
# disambiguation_suffix
# ---------------------------------------------------------------------------


class TestDisambiguationSuffix:
    def test_unique_method_returns_empty(self):
        spec = parse_method_spec("umap2:n_neighbors=50")
        counts = Counter([(spec.method, spec.dims)])
        assert disambiguation_suffix(spec, counts) == ""

    def test_duplicates_with_overrides_return_suffixes(self):
        a = parse_method_spec("umap2:n_neighbors=15")
        b = parse_method_spec("umap2:n_neighbors=50")
        counts = Counter([(a.method, a.dims), (b.method, b.dims)])
        assert disambiguation_suffix(a, counts) == "n=15"
        assert disambiguation_suffix(b, counts) == "n=50"

    def test_plain_spec_alongside_override_returns_empty(self):
        """Mixed case: -m umap2 -m umap2:n_neighbors=50.

        The plain spec has no overrides, so its suffix is empty even though
        the (method, dims) pair is duplicated. The override spec carries the
        disambiguating suffix.
        """
        plain = MethodSpec("umap", 2)
        override = parse_method_spec("umap2:n_neighbors=50")
        counts = Counter([(plain.method, plain.dims), (override.method, override.dims)])
        assert disambiguation_suffix(plain, counts) == ""
        assert disambiguation_suffix(override, counts) == "n=50"

    def test_duplicate_method_no_overrides_anywhere(self):
        """If two specs collide with no overrides at all, suffix is empty.

        This case cannot occur via parse_methods_arg (it dedupes), but the
        helper should still behave sanely if called directly.
        """
        spec = MethodSpec("umap", 2)
        counts = Counter([(spec.method, spec.dims), (spec.method, spec.dims)])
        assert disambiguation_suffix(spec, counts) == ""


# ---------------------------------------------------------------------------
# _resolve_annotation_names
# ---------------------------------------------------------------------------


class TestResolveAnnotationNames:
    def _resolve(self, annotations):
        config = PipelineConfig(
            methods=[MethodSpec("pca", 2)],
            output_path=None,
            annotations=annotations,
        )
        pipeline = ReductionPipeline(config)
        return pipeline._resolve_annotation_names()

    def test_none(self):
        assert self._resolve(None) == ([], None)

    def test_empty_list(self):
        assert self._resolve([]) == ([], None)

    def test_single(self):
        assert self._resolve(["organism_name"]) == (["organism_name"], None)

    def test_comma_separated(self):
        assert self._resolve(["organism_name,ec_number"]) == (
            ["organism_name", "ec_number"],
            None,
        )

    def test_multiple_items(self):
        assert self._resolve(["organism_name", "ec_number"]) == (
            ["organism_name", "ec_number"],
            None,
        )

    def test_strips_whitespace(self):
        assert self._resolve(["  organism_name , ec_number  "]) == (
            ["organism_name", "ec_number"],
            None,
        )

    def test_skips_empty_parts(self):
        assert self._resolve(["a,,b", ""]) == (["a", "b"], None)

    def test_csv_path(self):
        assert self._resolve(["metadata.csv"]) == ([], "metadata.csv")

    def test_csv_with_annotations(self):
        assert self._resolve(["metadata.csv", "default,pfam"]) == (
            ["default", "pfam"],
            "metadata.csv",
        )

    def test_tsv_path(self):
        assert self._resolve(["data.tsv", "ec"]) == (["ec"], "data.tsv")


def _cache_pipeline(tmp_path, **overrides):
    """A pipeline wired to read and write the annotation cache in ``tmp_path``."""
    return ReductionPipeline(
        PipelineConfig(
            methods=[],
            output_path=None,
            keep_tmp=True,
            intermediate_dir=tmp_path,
            **overrides,
        )
    )


class TestUniProtFailureCacheWriteThroughPipeline:
    """The guard has to hold on the paths a user actually runs.

    The manager-level tests pin the decision; these pin the wiring, because the
    pipeline change is a *deletion* of an explicit argument and a future call
    site could silently reinstate the old behavior.
    """

    @staticmethod
    def _fail_one_batch(monkeypatch):
        from protspace.data.annotations.retrievers import uniprot_retriever

        def fail_batch(_accessions):
            raise RuntimeError("temporary UniProt failure")

        monkeypatch.setattr(uniprot_retriever, "_fetch_many_accessions", fail_batch)

    def test_a_lost_batch_does_not_create_the_cache(self, tmp_path, monkeypatch):
        """The first --keep-tmp run is the one that would bake the empties in."""
        self._fail_one_batch(monkeypatch)
        pipeline = _cache_pipeline(tmp_path, annotations=["length"])

        pipeline._fetch_annotations(["P01308"])

        assert not (tmp_path / "all_annotations.parquet").exists()

    def test_refetch_rewrites_the_cache_even_when_a_batch_is_lost(
        self, tmp_path, monkeypatch
    ):
        """--refetch is the documented repair, so it must beat the guard.

        Declining here would strand a cache poisoned by an earlier run and throw
        away the good data the repair recovered.
        """
        self._fail_one_batch(monkeypatch)
        cache_path = tmp_path / "all_annotations.parquet"
        pd.DataFrame({"identifier": ["P01308"], "length": ["POISONED"]}).to_parquet(
            cache_path, index=False
        )
        pipeline = _cache_pipeline(
            tmp_path, annotations=["length"], refetch_stages={"uniprot"}
        )

        pipeline._fetch_annotations(["P01308"])

        # The repair could not refetch the column, so it removes it instead of
        # stranding the bad values: the next run then sees `length` missing and
        # fetches it, rather than reading "POISONED" as cached truth.
        assert "length" not in pd.read_parquet(cache_path).columns


class TestAnnotationCacheMigration:
    def test_legacy_pdb_migration_fetches_newly_required_taxonomy(
        self, tmp_path, monkeypatch
    ):
        """Migration must add its UniProt refresh to missing-source fetches."""
        from protspace.data.annotations.retrievers.taxonomy_retriever import (
            TaxonomyRetriever,
        )
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
            UniProtRetriever,
        )

        pd.DataFrame(
            {
                "identifier": ["P01308"],
                "xref_pdb": ["True"],
                "gene_name": ["STALE_GENE"],
                "protein_name": ["Protein"],
                "uniprot_kb_id": ["INS_HUMAN"],
                "organism_id": ["9606"],
            }
        ).to_parquet(tmp_path / "all_annotations.parquet", index=False)

        monkeypatch.setattr(
            UniProtRetriever,
            "fetch_annotations",
            lambda _self: [
                ProteinAnnotations(
                    identifier="P01308",
                    annotations={
                        "xref_pdb": "1A7F",
                        "gene_name": "INS",
                        "protein_name": "Insulin",
                        "uniprot_kb_id": "INS_HUMAN",
                        "organism_id": "9606",
                    },
                )
            ],
        )
        monkeypatch.setattr(
            TaxonomyRetriever,
            "fetch_annotations",
            lambda _self: {9606: {"annotations": {"genus": "Homo"}}},
        )

        result = _cache_pipeline(
            tmp_path, annotations=["xref_pdb", "genus"]
        )._fetch_annotations(["P01308"])

        assert result["xref_pdb"].tolist() == ["True"]
        assert result["genus"].tolist() == ["Homo"]

    def test_failed_uniprot_migration_leaves_legacy_cache_for_retry(
        self, tmp_path, monkeypatch, caplog
    ):
        """A partial migration fetch must not certify or replace legacy data."""
        from protspace.data.annotations.retrievers import uniprot_retriever

        cache_path = tmp_path / "all_annotations.parquet"
        pd.DataFrame(
            {
                "identifier": ["P01308"],
                "xref_pdb": ["True"],
                "gene_name": ["LEGACY_GENE"],
                "protein_name": ["Legacy protein"],
                "uniprot_kb_id": ["INS_HUMAN"],
            }
        ).to_parquet(cache_path, index=False)

        def fail_batch(_accessions):
            raise RuntimeError("temporary UniProt failure")

        monkeypatch.setattr(uniprot_retriever, "_fetch_many_accessions", fail_batch)
        pipeline = _cache_pipeline(tmp_path, annotations=["xref_pdb"])

        result = pipeline._fetch_annotations(["P01308"])

        assert result["xref_pdb"].tolist() == [""]
        preserved_cache = pd.read_parquet(cache_path)
        assert preserved_cache.attrs == {}
        assert preserved_cache["gene_name"].tolist() == ["LEGACY_GENE"]
        assert "1 UniProt batch failed; 1 protein has empty annotations" in caplog.text
        # The failed refresh must not make this run's output worse than the
        # cache it declined to overwrite: only xref_pdb is genuinely unknown.
        assert result["gene_name"].tolist() == ["LEGACY_GENE"]
        assert result["protein_name"].tolist() == ["Legacy protein"]

    def test_legacy_pdb_cache_is_not_refetched_when_pdb_is_not_requested(
        self, tmp_path, monkeypatch
    ):
        """A run that never surfaces xref_pdb must not pay a UniProt refetch."""
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            UniProtRetriever,
        )

        cache_path = tmp_path / "all_annotations.parquet"
        pd.DataFrame(
            {
                "identifier": ["P01308"],
                "xref_pdb": ["True"],
                "gene_name": ["INS"],
                "protein_name": ["Insulin"],
                "uniprot_kb_id": ["INS_HUMAN"],
            }
        ).to_parquet(cache_path, index=False)

        def fail_if_refetched(_self):
            raise AssertionError("xref_pdb is unused; UniProt must not be refetched")

        monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fail_if_refetched)

        result = _cache_pipeline(
            tmp_path, annotations=["gene_name"]
        )._fetch_annotations(["P01308"])

        assert result["gene_name"].tolist() == ["INS"]
        assert "xref_pdb" not in result.columns
        # Untouched and still unversioned, so a later run that does request
        # xref_pdb still migrates it.
        assert pd.read_parquet(cache_path).attrs == {}

    def test_a_later_semantics_change_refreshes_only_its_own_source(
        self, tmp_path, monkeypatch
    ):
        """The version table drives the refresh, not a hardcoded column.

        A cache already stamped for the v1 (PDB) change must not re-run it when
        a later version adds an unrelated column from a different source.
        """
        from protspace.data.annotations import encoding
        from protspace.data.annotations.manager import ProteinAnnotationManager
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
            UniProtRetriever,
        )

        monkeypatch.setattr(
            encoding,
            "CACHE_SEMANTICS_CHANGES",
            {1: frozenset({"xref_pdb"}), 2: frozenset({"signal_peptide"})},
        )
        monkeypatch.setattr(encoding, "ANNOTATION_CACHE_VERSION", 2)

        cache_path = tmp_path / "all_annotations.parquet"
        cached = pd.DataFrame(
            {
                "identifier": ["P01308"],
                "xref_pdb": ["True"],
                "signal_peptide": ["False"],
                "gene_name": ["INS"],
                "protein_name": ["Insulin"],
                "uniprot_kb_id": ["INS_HUMAN"],
            }
        )
        cached.attrs = {"protspace_annotation_cache_version": 1}
        cached.to_parquet(cache_path, index=False)

        def fail_if_refetched(_self):
            raise AssertionError("xref_pdb is already current at v1")

        monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fail_if_refetched)
        monkeypatch.setattr(
            ProteinAnnotationManager,
            "_fetch_interpro",
            lambda _self, _uniprot, _failed: [
                ProteinAnnotations(
                    identifier="P01308",
                    annotations={"signal_peptide": "SIGNAL_PEPTIDE"},
                )
            ],
        )

        result = _cache_pipeline(
            tmp_path, annotations=["xref_pdb", "signal_peptide"]
        )._fetch_annotations(["P01308"])

        # Satisfied by the v1 stamp, so reused without touching UniProt.
        assert result["xref_pdb"].tolist() == ["True"]
        # Stale at v2, so refreshed from its own source.
        assert result["signal_peptide"].tolist() == ["True"]
        assert pd.read_parquet(cache_path).attrs == {
            "protspace_annotation_cache_version": 2
        }

    def test_unrequested_legacy_pdb_column_is_dropped_before_stamping(
        self, tmp_path, monkeypatch
    ):
        """A stamped cache must not carry an xref_pdb the run never refreshed."""
        from protspace.data.annotations.manager import ProteinAnnotationManager
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
            UniProtRetriever,
        )

        cache_path = tmp_path / "all_annotations.parquet"
        pd.DataFrame(
            {
                "identifier": ["P01308"],
                "xref_pdb": ["True"],
                "gene_name": ["INS"],
                "protein_name": ["Insulin"],
                "uniprot_kb_id": ["INS_HUMAN"],
            }
        ).to_parquet(cache_path, index=False)

        def fail_if_refetched(_self):
            raise AssertionError("xref_pdb is unused; UniProt must not be refetched")

        monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fail_if_refetched)
        monkeypatch.setattr(
            ProteinAnnotationManager,
            "_fetch_ted",
            lambda _self, _failed: [
                ProteinAnnotations(
                    identifier="P01308",
                    annotations={"ted_domains": "3.40.50.2000|94.2"},
                )
            ],
        )

        result = _cache_pipeline(
            tmp_path, annotations=["gene_name", "ted_domains"]
        )._fetch_annotations(["P01308"])

        assert result["ted_domains"].tolist() == ["3.40.50.2000|94.2"]
        rewritten = pd.read_parquet(cache_path)
        assert rewritten.attrs == {"protspace_annotation_cache_version": 1}
        assert "xref_pdb" not in rewritten.columns

    def test_legacy_pdb_migration_preserves_cached_taxonomy(
        self, tmp_path, monkeypatch
    ):
        """Migration must retain taxonomy while replacing stale UniProt values."""
        from protspace.data.annotations.retrievers.uniprot_retriever import (
            ProteinAnnotations,
            UniProtRetriever,
        )

        legacy_cache = pd.DataFrame(
            {
                "identifier": ["unresolved", "resolved_without_pdb"],
                "xref_pdb": ["True", "True"],
                "gene_name": ["", "STALE_GENE"],
                "protein_name": ["", "Protein"],
                "uniprot_kb_id": ["", "NO_PDB_HUMAN"],
                "organism_id": ["", "9606"],
                "genus": ["", "Homo"],
                "signal_peptide": ["True", "False"],
            }
        )
        cache_path = tmp_path / "all_annotations.parquet"
        legacy_cache.to_parquet(cache_path, index=False)

        def fetch_current_annotations(_self):
            return [
                ProteinAnnotations(
                    identifier="unresolved",
                    annotations={
                        "xref_pdb": "",
                        "gene_name": "",
                        "protein_name": "",
                        "uniprot_kb_id": "",
                        "organism_id": "",
                    },
                ),
                ProteinAnnotations(
                    identifier="resolved_without_pdb",
                    annotations={
                        "xref_pdb": "",
                        "gene_name": "GENE",
                        "protein_name": "Protein",
                        "uniprot_kb_id": "NO_PDB_HUMAN",
                        "organism_id": "9606",
                    },
                ),
            ]

        monkeypatch.setattr(
            UniProtRetriever, "fetch_annotations", fetch_current_annotations
        )
        pipeline = _cache_pipeline(
            tmp_path, annotations=["xref_pdb", "genus", "signal_peptide"]
        )

        headers = ["unresolved", "resolved_without_pdb"]
        result = pipeline._fetch_annotations(headers)

        assert result["xref_pdb"].tolist() == ["", "False"]
        assert result["gene_name"].tolist() == ["", "GENE"]
        assert result["genus"].tolist() == ["", "Homo"]
        assert result["signal_peptide"].tolist() == ["True", "False"]
        migrated_cache = pd.read_parquet(cache_path)
        assert migrated_cache["genus"].tolist() == ["", "Homo"]
        assert migrated_cache.attrs == {"protspace_annotation_cache_version": 1}

        def fail_if_refetched(_self):
            raise AssertionError("current cache should use the fast path")

        monkeypatch.setattr(UniProtRetriever, "fetch_annotations", fail_if_refetched)
        cached_result = pipeline._fetch_annotations(headers)
        assert cached_result["xref_pdb"].tolist() == ["", "False"]
        assert cached_result["genus"].tolist() == ["", "Homo"]


# ---------------------------------------------------------------------------
# legacy TED label migration in the annotation cache
# ---------------------------------------------------------------------------


class TestLegacyTedLabelMigration:
    LEGACY = "3.40.50.2000|94.2;unclassified|96.7"
    REPAIRED = "3.40.50.2000|94.2;-|96.7"

    @classmethod
    def _write_legacy_cache(cls, tmp_path):
        """Write an annotation cache holding a pre-fix TED value."""
        pd.DataFrame(
            {
                "identifier": ["W6JQJ9"],
                "ted_domains": [cls.LEGACY],
                "gene_name": [""],
                "protein_name": [""],
                "uniprot_kb_id": [""],
            }
        ).to_parquet(tmp_path / "all_annotations.parquet", index=False)

    _pipeline = staticmethod(_cache_pipeline)

    def test_full_cache_hit_returns_the_repaired_label(self, tmp_path):
        """The short-circuit must not hand back the pre-fix literal."""
        self._write_legacy_cache(tmp_path)

        result = self._pipeline(
            tmp_path, annotations=["ted_domains"]
        )._fetch_annotations(["W6JQJ9"])

        assert result.loc[0, "ted_domains"] == self.REPAIRED

    def test_partial_cache_hit_hands_the_manager_repaired_values(self, tmp_path):
        """The manager merges the cached TED column, so it must get the fixed one."""
        self._write_legacy_cache(tmp_path)

        with patch(
            "protspace.data.annotations.manager.ProteinAnnotationManager"
        ) as mock_manager:
            mock_manager.return_value.to_pd.return_value = pd.DataFrame(
                {"identifier": ["W6JQJ9"], "ec": [""]}
            )
            self._pipeline(
                tmp_path, annotations=["ted_domains", "ec"]
            )._fetch_annotations(["W6JQJ9"])

        # `ec` is missing, so `determine_sources_to_fetch` leaves TED cached.
        kwargs = mock_manager.call_args.kwargs
        assert kwargs["sources_to_fetch"]["ted"] is False
        assert kwargs["cached_data"].loc[0, "ted_domains"] == self.REPAIRED

    def test_the_repair_is_persisted_to_the_cache(self, tmp_path):
        """Migrating on every resumed run would re-scan the column forever."""
        self._write_legacy_cache(tmp_path)

        self._pipeline(tmp_path, annotations=["ted_domains"])._fetch_annotations(
            ["W6JQJ9"]
        )

        on_disk = pd.read_parquet(tmp_path / "all_annotations.parquet")
        assert on_disk.loc[0, "ted_domains"] == self.REPAIRED

    def test_a_clean_column_is_left_alone(self):
        df = pd.DataFrame({"ted_domains": [self.REPAIRED, None, ""]})

        assert _migrate_legacy_ted_labels(df) is False

    def test_the_word_inside_a_cath_name_is_not_rewritten(self):
        """Only a whole domain label counts, not the word wherever it appears."""
        df = pd.DataFrame(
            {"ted_domains": ["3.40.50.2000 (Totally unclassified thing)|94.2"]}
        )

        assert _migrate_legacy_ted_labels(df) is False

    def test_every_unlabeled_domain_is_rewritten(self):
        df = pd.DataFrame(
            {"ted_domains": ["unclassified|94.2;1.10.10.10|88.0;unclassified|96.7"]}
        )

        assert _migrate_legacy_ted_labels(df) is True
        assert df.loc[0, "ted_domains"] == "-|94.2;1.10.10.10|88.0;-|96.7"


# ---------------------------------------------------------------------------
# complete annotation cache
# ---------------------------------------------------------------------------


class TestCompleteAnnotationCache:
    def test_fills_only_missing_cached_lengths_from_fasta(self, tmp_path):
        fasta_path = tmp_path / "input.fasta"
        fasta_path.write_text(">custom_protein\nMPEPTIDE\n>cached_protein\nMPEPTIDE\n")
        cache_path = tmp_path / "all_annotations.parquet"
        cached = pd.DataFrame(
            [
                {
                    "identifier": "custom_protein",
                    "length": "",
                    "gene_name": "",
                    "protein_name": "",
                    "uniprot_kb_id": "",
                },
                {
                    "identifier": "cached_protein",
                    "length": "110",
                    "gene_name": "",
                    "protein_name": "",
                    "uniprot_kb_id": "",
                },
            ]
        )
        cached.to_parquet(cache_path, index=False)
        embedding_set = _make_es(
            "test", ["custom_protein", "cached_protein"], fasta_path=fasta_path
        )
        pipeline = ReductionPipeline(
            PipelineConfig(
                methods=[MethodSpec("pca", 2)],
                output_path=tmp_path / "out.zip",
                keep_tmp=True,
                intermediate_dir=tmp_path,
                annotations=["length"],
            )
        )

        result = pipeline._fetch_annotations(embedding_set.headers, [embedding_set])

        assert result["length"].tolist() == ["8", "110"]
        assert pd.read_parquet(cache_path)["length"].tolist() == ["", "110"]

    def test_still_warns_when_every_cached_annotation_is_empty(self, tmp_path, caplog):
        """The FASTA length fallback must not mask a wholly empty cache."""
        fasta_path = tmp_path / "input.fasta"
        fasta_path.write_text(">custom_protein\nMPEPTIDE\n")
        cache_path = tmp_path / "all_annotations.parquet"
        pd.DataFrame(
            [
                {
                    "identifier": "custom_protein",
                    "length": "",
                    "gene_name": "",
                    "protein_name": "",
                    "uniprot_kb_id": "",
                }
            ]
        ).to_parquet(cache_path, index=False)
        embedding_set = _make_es("test", ["custom_protein"], fasta_path=fasta_path)
        pipeline = ReductionPipeline(
            PipelineConfig(
                methods=[MethodSpec("pca", 2)],
                output_path=tmp_path / "out.zip",
                keep_tmp=True,
                intermediate_dir=tmp_path,
                annotations=["length"],
            )
        )

        with caplog.at_level(logging.WARNING):
            result = pipeline._fetch_annotations(embedding_set.headers, [embedding_set])

        assert result["length"].tolist() == ["8"]
        assert "All cached annotations are empty" in caplog.text


# ---------------------------------------------------------------------------
# _validate_headers
# ---------------------------------------------------------------------------


class TestValidateHeaders:
    def _make_pipeline(self):
        config = PipelineConfig(methods=[MethodSpec("pca", 2)], output_path=None)
        return ReductionPipeline(config)

    def _make_es(self, name, headers):
        return EmbeddingSet(
            name=name,
            data=np.random.rand(len(headers), 10).astype(np.float32),
            headers=headers,
        )

    def test_single_set(self):
        pipeline = self._make_pipeline()
        es = self._make_es("model", ["A", "B", "C"])
        result = pipeline._validate_headers([es])
        assert result == ["A", "B", "C"]

    def test_two_sets_same_headers(self):
        pipeline = self._make_pipeline()
        es1 = self._make_es("m1", ["A", "B", "C"])
        es2 = self._make_es("m2", ["A", "B", "C"])
        result = pipeline._validate_headers([es1, es2])
        assert result == ["A", "B", "C"]

    def test_intersection(self):
        pipeline = self._make_pipeline()
        es1 = self._make_es("m1", ["A", "B", "C"])
        es2 = self._make_es("m2", ["B", "C", "D"])
        result = pipeline._validate_headers([es1, es2])
        assert result == ["B", "C"]

    def test_no_overlap_raises(self):
        pipeline = self._make_pipeline()
        es1 = self._make_es("m1", ["A", "B"])
        es2 = self._make_es("m2", ["C", "D"])
        with pytest.raises(ValueError, match="No common"):
            pipeline._validate_headers([es1, es2])

    def test_reorders_data(self):
        pipeline = self._make_pipeline()
        es1 = self._make_es("m1", ["A", "B", "C"])
        es2 = self._make_es("m2", ["C", "B", "A"])
        # Save original row for "A" in es2 (index 2)
        es2_row_a = es2.data[2].copy()
        pipeline._validate_headers([es1, es2])
        # After validation, es2 should be reordered to match es1's order
        assert es2.headers == ["A", "B", "C"]
        np.testing.assert_array_equal(es2.data[0], es2_row_a)


# ---------------------------------------------------------------------------
# merge_same_name_sets
# ---------------------------------------------------------------------------


def _make_es(name, headers, data=None, precomputed=False, fasta_path=None):
    if data is None:
        data = np.random.rand(len(headers), 10).astype(np.float32)
    return EmbeddingSet(
        name=name,
        data=data,
        headers=headers,
        precomputed=precomputed,
        fasta_path=fasta_path,
    )


class TestMergeSameNameSets:
    def test_single_set_passthrough(self):
        es = _make_es("prot_t5", ["A", "B"])
        result = merge_same_name_sets([es])
        assert len(result) == 1
        assert result[0] is es

    def test_different_names_no_merge(self):
        es1 = _make_es("prot_t5", ["A", "B"])
        es2 = _make_es("esm2_650m", ["A", "B"])
        result = merge_same_name_sets([es1, es2])
        assert len(result) == 2
        assert result[0] is es1
        assert result[1] is es2

    def test_union_same_name_disjoint(self):
        """Core bug fix: same name + disjoint headers → union."""
        es1 = _make_es("prot_t5", ["A", "B"])
        es2 = _make_es("prot_t5", ["C", "D"])
        result = merge_same_name_sets([es1, es2])
        assert len(result) == 1
        assert result[0].name == "prot_t5"
        assert result[0].headers == ["A", "B", "C", "D"]
        assert result[0].data.shape == (4, 10)

    def test_union_preserves_order(self):
        es1 = _make_es("m", ["B", "A"])
        es2 = _make_es("m", ["D", "C"])
        result = merge_same_name_sets([es1, es2])
        assert result[0].headers == ["B", "A", "D", "C"]

    def test_overlap_identical_dedup(self):
        shared_row = np.ones((1, 10), dtype=np.float32)
        data1 = np.vstack([shared_row, np.zeros((1, 10), dtype=np.float32)])
        data2 = np.vstack([shared_row, np.full((1, 10), 2.0, dtype=np.float32)])
        es1 = _make_es("m", ["A", "B"], data=data1)
        es2 = _make_es("m", ["A", "C"], data=data2)
        result = merge_same_name_sets([es1, es2])
        assert result[0].headers == ["A", "B", "C"]
        assert result[0].data.shape == (3, 10)
        np.testing.assert_array_equal(result[0].data[0], shared_row[0])

    def test_overlap_conflicting_raises(self):
        data1 = np.ones((2, 10), dtype=np.float32)
        data2 = np.zeros((2, 10), dtype=np.float32)
        es1 = _make_es("m", ["A", "B"], data=data1)
        es2 = _make_es("m", ["A", "C"], data=data2)
        with pytest.raises(ValueError, match="conflicting embedding data"):
            merge_same_name_sets([es1, es2])

    def test_dimension_mismatch_raises(self):
        es1 = _make_es("m", ["A"], data=np.ones((1, 10), dtype=np.float32))
        es2 = _make_es("m", ["B"], data=np.ones((1, 20), dtype=np.float32))
        with pytest.raises(ValueError, match="dimension mismatch"):
            merge_same_name_sets([es1, es2])

    def test_precomputed_merge_raises(self):
        es1 = _make_es("m", ["A", "B"], precomputed=True)
        es2 = _make_es("m", ["C", "D"], precomputed=True)
        with pytest.raises(ValueError, match="precomputed"):
            merge_same_name_sets([es1, es2])

    def test_three_files_same_name(self):
        es1 = _make_es("m", ["A", "B"])
        es2 = _make_es("m", ["C", "D"])
        es3 = _make_es("m", ["E", "F"])
        result = merge_same_name_sets([es1, es2, es3])
        assert len(result) == 1
        assert result[0].headers == ["A", "B", "C", "D", "E", "F"]
        assert result[0].data.shape == (6, 10)

    def test_mixed_merge_and_intersect(self):
        """Same-name sets merged, then different names intersected via pipeline."""
        es1 = _make_es("prot_t5", ["A", "B"])
        es2 = _make_es("prot_t5", ["C", "D"])
        es3 = _make_es("esm2", ["A", "B", "C", "D"])
        result = merge_same_name_sets([es1, es2, es3])
        # prot_t5 merged into one (4 proteins), esm2 untouched (4 proteins)
        assert len(result) == 2
        assert result[0].name == "prot_t5"
        assert result[0].headers == ["A", "B", "C", "D"]
        assert result[1].name == "esm2"

    def test_fasta_path_preserved(self):
        from pathlib import Path

        es1 = _make_es("m", ["A"], fasta_path=None)
        es2 = _make_es("m", ["B"], fasta_path=Path("/tmp/seq.fasta"))
        result = merge_same_name_sets([es1, es2])
        assert result[0].fasta_path == Path("/tmp/seq.fasta")

    def test_empty_list(self):
        assert merge_same_name_sets([]) == []

    def test_same_name_no_overlap_through_pipeline(self):
        """Same name, disjoint keys should work.

        Regression test for tsenoner/protspace-legacy#44 (the pre-monorepo Python
        repo); this repo's own #44 is an unrelated web bug.
        """
        config = PipelineConfig(methods=[MethodSpec("pca", 2)], output_path=None)
        pipeline = ReductionPipeline(config)
        es1 = _make_es("prot_t5", ["A", "B"])
        es2 = _make_es("prot_t5", ["C", "D"])
        # Before the fix, this raised "No common protein identifiers"
        result = pipeline._validate_headers(merge_same_name_sets([es1, es2]))
        assert set(result) == {"A", "B", "C", "D"}


# ---------------------------------------------------------------------------
# project.py base.config isolation contract
# ---------------------------------------------------------------------------


class TestRunWithOverriddenConfig:
    """The shared helper must restore base.config between iterations so a
    `precomputed` flag (or any temporary key) cannot leak from one spec to
    the next.
    """

    def test_base_config_restored_after_call(self):
        original = {"metric": "euclidean", "n_neighbors": 15}

        class FakeBase:
            def __init__(self, cfg):
                self.config = cfg
                self.seen_config = None

            def process_reduction(self, data, method, dims):
                self.seen_config = dict(self.config)
                return {
                    "name": f"{method}{dims}",
                    "dimensions": dims,
                    "data": [],
                    "info": {},
                }

        base = FakeBase(dict(original))
        effective = {**original, "n_neighbors": 50, "precomputed": True}

        result = _run_with_overridden_config(base, effective, "umap", 2, data=None)

        assert base.seen_config == effective, (
            "process_reduction should observe the overridden config"
        )
        assert base.config == original, (
            f"base.config leaked override; expected {original}, got {base.config}"
        )
        assert result["name"] == "umap2"

    def test_config_restored_on_exception(self):
        original = {"metric": "euclidean"}

        class BoomBase:
            def __init__(self, cfg):
                self.config = cfg

            def process_reduction(self, data, method, dims):
                raise RuntimeError("boom")

        base = BoomBase(dict(original))
        with pytest.raises(RuntimeError, match="boom"):
            _run_with_overridden_config(
                base, {"metric": "cosine"}, "umap", 2, data=None
            )

        assert base.config == original


# ---------------------------------------------------------------------------
# precomputed-MDS branch: base.config isolation
# ---------------------------------------------------------------------------


class TestPrecomputedMDSConfigIsolation:
    """Regression tests for the precomputed-MDS branch in
    ReductionPipeline._run_reductions: a `precomputed` flag must not survive
    in self.base.config after the branch finishes — including when
    process_reduction raises.
    """

    def _make_pipeline(self):
        config = PipelineConfig(methods=[], output_path=None)
        return ReductionPipeline(config)

    def _make_precomputed_es(self):
        return EmbeddingSet(
            name="MMseqs2",
            data=np.eye(2, dtype=np.float32),
            headers=["A", "B"],
            precomputed=True,
        )

    def test_precomputed_mds_does_not_leak_precomputed_flag_on_success(self):
        pipeline = self._make_pipeline()

        def fake_reduce(data, method, dims):
            assert method == "mds"
            assert pipeline.base.config.get("precomputed") is True
            return {
                "name": "stub",
                "dimensions": dims,
                "data": np.zeros((2, dims), dtype=np.float32),
                "info": {},
            }

        pipeline.base.process_reduction = fake_reduce

        pipeline._run_reductions([self._make_precomputed_es()])

        assert "precomputed" not in pipeline.base.config

    def test_precomputed_mds_restores_config_on_exception(self):
        pipeline = self._make_pipeline()

        def boom(data, method, dims):
            raise RuntimeError("boom")

        pipeline.base.process_reduction = boom
        original_config_id = id(pipeline.base.config)

        with pytest.raises(RuntimeError, match="boom"):
            pipeline._run_reductions([self._make_precomputed_es()])

        assert "precomputed" not in pipeline.base.config
        assert id(pipeline.base.config) == original_config_id, (
            "base.config reference should be the original dict, not a replacement"
        )
