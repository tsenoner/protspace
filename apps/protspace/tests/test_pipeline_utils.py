"""Tests for pipeline utility functions."""

import numpy as np
import pytest

from protspace.data.loaders.embedding_set import (
    EmbeddingSet,
    format_projection_name,
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
        assert self._resolve(None) == []

    def test_empty_list(self):
        assert self._resolve([]) == []

    def test_single(self):
        assert self._resolve(["organism_name"]) == ["organism_name"]

    def test_comma_separated(self):
        assert self._resolve(["organism_name,ec_number"]) == [
            "organism_name",
            "ec_number",
        ]

    def test_multiple_items(self):
        assert self._resolve(["organism_name", "ec_number"]) == [
            "organism_name",
            "ec_number",
        ]

    def test_strips_whitespace(self):
        assert self._resolve(["  organism_name , ec_number  "]) == [
            "organism_name",
            "ec_number",
        ]

    def test_skips_empty_parts(self):
        assert self._resolve(["a,,b", ""]) == ["a", "b"]


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
