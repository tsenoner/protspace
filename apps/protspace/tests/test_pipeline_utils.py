"""Tests for pipeline utility functions."""

import numpy as np
import pytest

from protspace.data.loaders.embedding_set import (
    EmbeddingSet,
    format_projection_name,
    merge_same_name_sets,
)
from protspace.data.processors.pipeline import (
    PipelineConfig,
    ReductionPipeline,
    parse_method_spec,
)

# ---------------------------------------------------------------------------
# parse_method_spec
# ---------------------------------------------------------------------------


class TestParseMethodSpec:
    def test_pca2(self):
        assert parse_method_spec("pca2") == ("pca", 2)

    def test_umap3(self):
        assert parse_method_spec("umap3") == ("umap", 3)

    def test_tsne2(self):
        assert parse_method_spec("tsne2") == ("tsne", 2)

    def test_pacmap2(self):
        assert parse_method_spec("pacmap2") == ("pacmap", 2)

    def test_mds2(self):
        assert parse_method_spec("mds2") == ("mds", 2)

    def test_localmap2(self):
        assert parse_method_spec("localmap2") == ("localmap", 2)

    def test_invalid_no_digits(self):
        with pytest.raises(ValueError):
            parse_method_spec("pca")


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


# ---------------------------------------------------------------------------
# _resolve_annotation_names
# ---------------------------------------------------------------------------


class TestResolveAnnotationNames:
    def _resolve(self, annotations):
        config = PipelineConfig(
            methods=["pca2"],
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


# ---------------------------------------------------------------------------
# _validate_headers
# ---------------------------------------------------------------------------


class TestValidateHeaders:
    def _make_pipeline(self):
        config = PipelineConfig(methods=["pca2"], output_path=None)
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
        """Regression test for issue #44: same name, disjoint keys should work."""
        config = PipelineConfig(methods=["pca2"], output_path=None)
        pipeline = ReductionPipeline(config)
        es1 = _make_es("prot_t5", ["A", "B"])
        es2 = _make_es("prot_t5", ["C", "D"])
        # Before the fix, this raised "No common protein identifiers"
        result = pipeline._validate_headers(merge_same_name_sets([es1, es2]))
        assert set(result) == {"A", "B", "C", "D"}
