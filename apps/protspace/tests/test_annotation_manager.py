import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import pandas as pd
import pytest

from src.protspace.data.annotations.configuration import (
    DEFAULT_ANNOTATIONS,
    LENGTH_BINNING_ANNOTATIONS,
    NEEDED_UNIPROT_ANNOTATIONS,
    AnnotationConfiguration,
)
from src.protspace.data.annotations.manager import ProteinAnnotationManager
from src.protspace.data.annotations.merging import AnnotationMerger
from src.protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
)
from src.protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
)
from src.protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
    ProteinAnnotations,
)
from src.protspace.data.annotations.transformers.length_binning import LengthBinner
from src.protspace.data.annotations.transformers.uniprot_transforms import (
    UniProtTransformer,
)
from src.protspace.data.io.formatters import DataFormatter
from src.protspace.data.io.writers import AnnotationWriter

# Use new name throughout tests
ProteinAnnotationExtractor = ProteinAnnotationManager  # For test compatibility

# Test data
SAMPLE_HEADERS = ["P01308", "P01315", "P01316"]
SAMPLE_PROTEIN_ANNOTATIONS = [
    ProteinAnnotations(
        identifier="P01308",
        annotations={
            "accession": "P01308",
            "organism_id": "9606",
            "length": "110",
            "protein_families": "Insulin family",
            "annotation_score": "5.0",
        },
    ),
    ProteinAnnotations(
        identifier="P01315",
        annotations={
            "accession": "P01315",
            "organism_id": "9606",
            "length": "142",
            "protein_families": "Insulin family",
            "annotation_score": "4.5",
        },
    ),
    ProteinAnnotations(
        identifier="P01316",
        annotations={
            "accession": "P01316",
            "organism_id": "10090",
            "length": "85",
            "protein_families": "Insulin family",
            "annotation_score": "3.8",
        },
    ),
]

SAMPLE_TAXONOMY_ANNOTATIONS = {
    9606: {
        "annotations": {
            "genus": "Homo",
            "species": "Homo sapiens",
            "kingdom": "Metazoa",
        }
    },
    10090: {
        "annotations": {"genus": "Mus", "species": "Mus musculus", "kingdom": "Metazoa"}
    },
}


class TestProteinAnnotationExtractorInit:
    """Test ProteinAnnotationExtractor initialization."""

    def test_init_with_basic_parameters(self):
        """Test initialization with basic parameters."""
        headers = SAMPLE_HEADERS
        annotations = ["length", "genus"]

        extractor = ProteinAnnotationExtractor(headers=headers, annotations=annotations)

        assert extractor.headers == headers
        # Always-included annotations are added automatically
        expected_annotations = ["length", "genus", "gene_name", "protein_name", "uniprot_kb_id"]
        assert extractor.user_annotations == expected_annotations
        assert extractor.output_path is None
        assert extractor.non_binary is False

    def test_init_with_output_path(self):
        """Test initialization with output path."""
        headers = SAMPLE_HEADERS
        output_path = Path("test_output.csv")

        extractor = ProteinAnnotationExtractor(
            headers=headers, output_path=output_path, non_binary=True
        )

        assert extractor.output_path == output_path
        assert extractor.non_binary is True

    def test_init_with_invalid_annotations(self):
        """Test initialization with invalid annotations raises ValueError."""
        headers = SAMPLE_HEADERS
        invalid_annotations = ["length", "invalid_annotation", "genus"]

        with pytest.raises(
            ValueError, match="Annotation invalid_annotation is not a valid annotation"
        ):
            ProteinAnnotationExtractor(headers=headers, annotations=invalid_annotations)

    def test_init_with_no_annotations(self):
        """Test initialization without specifying annotations."""
        headers = SAMPLE_HEADERS

        extractor = ProteinAnnotationExtractor(headers=headers)

        # When no annotations specified, user_annotations should be None
        assert extractor.user_annotations is None

        # Configuration should be initialized with default annotations
        assert extractor.config is not None
        assert hasattr(extractor.config, "user_annotations")
        assert hasattr(extractor.config, "uniprot_annotations")
        assert hasattr(extractor.config, "taxonomy_annotations")

        # Config should have default annotations split by source
        assert extractor.config.uniprot_annotations is not None
        assert len(extractor.config.uniprot_annotations) > 0
        assert extractor.config.taxonomy_annotations is not None
        assert len(extractor.config.taxonomy_annotations) > 0


class TestAnnotationConfiguration:
    """Test the AnnotationConfiguration module."""

    def test_validate_valid_annotations(self):
        """Test validation with valid annotations."""
        valid_annotations = ["length", "genus", "species", "protein_families"]
        config = AnnotationConfiguration(user_annotations=valid_annotations)

        # Always-included annotations are added automatically
        expected_annotations = ["length", "genus", "species", "protein_families", "gene_name", "protein_name", "uniprot_kb_id"]
        assert config.user_annotations == expected_annotations

    def test_validate_with_none(self):
        """Test validation with None returns None."""
        config = AnnotationConfiguration(user_annotations=None)

        assert config.user_annotations is None

    def test_validate_invalid_annotation(self):
        """Test validation with invalid annotation raises ValueError."""
        invalid_annotations = ["length", "nonexistent_annotation"]

        with pytest.raises(
            ValueError,
            match="Annotation nonexistent_annotation is not a valid annotation",
        ):
            AnnotationConfiguration(user_annotations=invalid_annotations)

    def test_validate_with_length_binning(self):
        """Test validation includes length binning annotations."""
        annotations_with_binning = ["length_fixed", "length_quantile", "genus"]
        config = AnnotationConfiguration(user_annotations=annotations_with_binning)

        # Always-included annotations are added automatically
        expected_annotations = ["length_fixed", "length_quantile", "genus", "gene_name", "protein_name", "uniprot_kb_id"]
        assert config.user_annotations == expected_annotations

    def test_split_by_source_with_user_annotations(self):
        """Test annotation splitting by source with user-specified annotations."""
        user_annotations = ["length", "genus", "species", "pfam"]
        config = AnnotationConfiguration(user_annotations=user_annotations)

        # Should include user's UniProt annotations plus required ones
        assert "accession" in config.uniprot_annotations
        assert "organism_id" in config.uniprot_annotations
        assert "length" in config.uniprot_annotations

        # Should NOT include unrequested UniProt annotations
        assert "reviewed" not in config.uniprot_annotations
        assert "protein_existence" not in config.uniprot_annotations

        # Should include taxonomy annotations that are in user_annotations
        assert "genus" in config.taxonomy_annotations
        assert "species" in config.taxonomy_annotations

        # Should NOT include unrequested Taxonomy annotations
        assert "kingdom" not in config.taxonomy_annotations

        # Should include InterPro annotations that are in user_annotations
        assert "pfam" in config.interpro_annotations

        # Should NOT include unrequested InterPro annotations
        assert "cath" not in config.interpro_annotations

    def test_split_by_source_adds_length_for_binning(self):
        """Test splitting adds 'length' when length binning annotations requested."""
        user_annotations = ["length_fixed", "genus"]
        config = AnnotationConfiguration(user_annotations=user_annotations)

        # Should automatically include "length" for binning computation
        assert "length" in config.uniprot_annotations

    def test_split_by_source_default_annotations(self):
        """Test splitting with default annotations (None)."""
        config = AnnotationConfiguration(user_annotations=None)

        # Should include all UniProt annotations from DEFAULT_ANNOTATIONS
        for annotation in UNIPROT_ANNOTATIONS:
            assert annotation in config.uniprot_annotations

        # Should include taxonomy annotations since they're in DEFAULT_ANNOTATIONS
        assert config.taxonomy_annotations is not None
        assert len(config.taxonomy_annotations) > 0


class TestLengthBinner:
    """Test the LengthBinner module."""

    def test_compute_fixed_bins(self):
        """Test fixed length binning."""
        binner = LengthBinner()
        lengths = [25, 75, 150, 350, 1500, None]

        result = binner.compute_fixed_bins(lengths)

        expected = ["<50", "50-100", "100-200", "200-400", "1400-1600", "unknown"]
        assert result == expected

    def test_compute_quantile_bins(self):
        """Test quantile-based length binning."""
        binner = LengthBinner()
        lengths = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]

        result = binner.compute_quantile_bins(lengths, num_bins=5)

        # Should create 5 bins with roughly equal numbers of sequences
        assert len(set(result)) <= 5
        assert all(isinstance(bin_label, str) for bin_label in result)

    def test_add_bins_integration(self):
        """Test complete length binning computation."""
        binner = LengthBinner()
        protein_annotations = [
            ProteinAnnotations(identifier="P1", annotations={"length": "110"}),
            ProteinAnnotations(identifier="P2", annotations={"length": "250"}),
            ProteinAnnotations(identifier="P3", annotations={"length": "invalid"}),
        ]

        result = binner.add_bins(protein_annotations)

        # Verify structure
        assert len(result) == 3
        for protein in result:
            assert "length_fixed" in protein.annotations
            assert "length_quantile" in protein.annotations
            assert "length" in protein.annotations  # Original length is kept for caching

        # Verify binning
        assert result[0].annotations["length_fixed"] == "100-200"
        assert result[1].annotations["length_fixed"] == "200-400"
        assert result[2].annotations["length_fixed"] == "unknown"


class TestAnnotationMerger:
    """Test the AnnotationMerger module."""

    def test_merge_basic(self):
        """Test basic annotation merging between UniProt and taxonomy."""
        merger = AnnotationMerger()

        uniprot_annotations = [
            ProteinAnnotations(
                identifier="P01308",
                annotations={"organism_id": "9606", "length": "110"},
            ),
            ProteinAnnotations(
                identifier="P01315",
                annotations={"organism_id": "10090", "length": "142"},
            ),
        ]

        taxonomy_annotations = {
            9606: {"annotations": {"genus": "Homo", "species": "Homo sapiens"}},
            10090: {"annotations": {"genus": "Mus", "species": "Mus musculus"}},
        }

        result = merger.merge(uniprot_annotations, taxonomy_annotations)

        # Verify merging
        assert len(result) == 2
        assert result[0].annotations["genus"] == "Homo"
        assert result[0].annotations["species"] == "Homo sapiens"
        assert result[1].annotations["genus"] == "Mus"
        assert result[1].annotations["species"] == "Mus musculus"

    def test_merge_with_top_9_filtering(self):
        """Test that annotation merging keeps only top 9 values."""
        merger = AnnotationMerger()

        uniprot_annotations = [
            ProteinAnnotations(
                identifier=f"P{i}", annotations={"organism_id": str(i % 2)}
            )
            for i in range(20)
        ]

        # Create taxonomy with many different values for an annotation
        taxonomy_annotations = {}
        for i in range(2):
            taxonomy_annotations[i] = {
                "annotations": {"genus": f"Genus{i % 12}"}  # 12 different genera
            }

        result = merger.merge(uniprot_annotations, taxonomy_annotations)

        # Should have applied "other" for less frequent values
        genus_values = {protein.annotations.get("genus", "") for protein in result}
        assert len(genus_values) <= 10  # Max 9 + "other"

    def test_merge_missing_taxonomy(self):
        """Test merging when taxonomy data is missing for some organisms."""
        merger = AnnotationMerger()

        uniprot_annotations = [
            ProteinAnnotations(
                identifier="P01308", annotations={"organism_id": "9606"}
            ),
            ProteinAnnotations(
                identifier="P01315", annotations={"organism_id": "99999"}
            ),  # Missing
        ]

        taxonomy_annotations = {
            9606: {"annotations": {"genus": "Homo"}},
            # 99999 missing
        }

        result = merger.merge(uniprot_annotations, taxonomy_annotations)

        # Should handle missing taxonomy gracefully
        assert len(result) == 2
        assert result[0].annotations.get("genus") == "Homo"
        assert "genus" not in result[1].annotations  # No taxonomy data available


class TestAnnotationWriter:
    """Test the AnnotationWriter module."""

    def test_write_csv(self):
        """Test saving annotations to CSV file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "test_output.csv"
            writer = AnnotationWriter()

            protein_annotations = [
                ProteinAnnotations(
                    identifier="P1", annotations={"length": "110", "genus": "Homo"}
                ),
                ProteinAnnotations(
                    identifier="P2", annotations={"length": "142", "genus": "Mus"}
                ),
            ]

            writer.write_csv(protein_annotations, output_path, apply_transforms=False)

            # Verify file was created and has correct content
            assert output_path.exists()
            df = pd.read_csv(output_path)
            assert len(df) == 2
            assert list(df["identifier"]) == ["P1", "P2"]

    def test_write_parquet(self):
        """Test saving annotations to Parquet file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "test_output.parquet"
            writer = AnnotationWriter()

            protein_annotations = [
                ProteinAnnotations(
                    identifier="P1", annotations={"length": "110", "genus": "Homo"}
                ),
                ProteinAnnotations(
                    identifier="P2", annotations={"length": "142", "genus": "Mus"}
                ),
            ]

            writer.write_parquet(
                protein_annotations, output_path, apply_transforms=False
            )

            # Verify file was created and has correct content
            assert output_path.exists()
            df = pd.read_parquet(output_path)
            assert len(df) == 2
            assert list(df["identifier"]) == ["P1", "P2"]


class TestDataFormatter:
    """Test the DataFormatter module."""

    def test_to_dataframe(self):
        """Test creating DataFrame from annotations."""
        protein_annotations = [
            ProteinAnnotations(
                identifier="P1", annotations={"length": "110", "genus": "Homo"}
            ),
            ProteinAnnotations(
                identifier="P2", annotations={"length": "142", "genus": "Mus"}
            ),
        ]

        result = DataFormatter.to_dataframe(protein_annotations)

        # Verify DataFrame structure
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 2
        assert "identifier" in result.columns
        assert list(result["identifier"]) == ["P1", "P2"]

    def test_to_dataframe_empty_annotations(self):
        """Test creating DataFrame with empty annotations list."""
        result = DataFormatter.to_dataframe([])

        # Should create DataFrame with just identifier column
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0
        assert list(result.columns) == ["identifier"]


class TestUniProtTransformer:
    """Test the UniProtTransformer module."""

    def test_transform_annotation_score(self):
        """Test modification of annotation score values."""
        transformer = UniProtTransformer()

        result = transformer.transform_annotation_score("5.0")

        # Should convert float annotation score to integer string
        assert result == "5"

    def test_transform_protein_families(self):
        """Test modification of protein families values."""
        transformer = UniProtTransformer()

        result = transformer.transform_protein_families(
            "Insulin family, Growth factor family"
        )

        # Should take only first family
        assert result == "Insulin family"

    def test_transform_protein_families_with_semicolon(self):
        """Test modification of protein families with semicolon separator."""
        transformer = UniProtTransformer()

        result = transformer.transform_protein_families(
            "Insulin family; Growth factor family"
        )

        # Should take only first family
        assert result == "Insulin family"


class TestIntegration:
    """Integration tests for complete workflows."""

    @patch("src.protspace.data.annotations.manager.TaxonomyRetriever")
    @patch("src.protspace.data.annotations.manager.UniProtRetriever")
    def test_to_pd_complete_workflow(
        self, mock_uniprot_retriever, mock_taxonomy_retriever
    ):
        """Test complete workflow from initialization to DataFrame creation."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_annotations.return_value = (
            SAMPLE_PROTEIN_ANNOTATIONS
        )
        mock_uniprot_retriever.return_value = mock_uniprot_instance

        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_annotations.return_value = (
            SAMPLE_TAXONOMY_ANNOTATIONS
        )
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance

        # Test
        headers = SAMPLE_HEADERS
        annotations = ["length", "genus", "species"]
        extractor = ProteinAnnotationExtractor(headers=headers, annotations=annotations)

        result = extractor.to_pd()

        # Verify result
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 3
        assert "identifier" in result.columns
        assert "genus" in result.columns
        assert "species" in result.columns

    @patch("src.protspace.data.annotations.manager.TaxonomyRetriever")
    @patch("src.protspace.data.annotations.manager.UniProtRetriever")
    def test_to_pd_with_file_output(
        self, mock_uniprot_retriever, mock_taxonomy_retriever
    ):
        """Test workflow with file output."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_annotations.return_value = (
            SAMPLE_PROTEIN_ANNOTATIONS
        )
        mock_uniprot_retriever.return_value = mock_uniprot_instance

        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_annotations.return_value = {}
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance

        # Test with file output
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output.csv"
            headers = SAMPLE_HEADERS

            extractor = ProteinAnnotationExtractor(
                headers=headers,
                annotations=["length"],
                output_path=output_path,
                non_binary=True,
            )

            result = extractor.to_pd()

            # Verify file was created and DataFrame loaded from it
            assert output_path.exists()
            assert isinstance(result, pd.DataFrame)
            assert len(result) == 3

    @patch("src.protspace.data.annotations.manager.TaxonomyRetriever")
    @patch("src.protspace.data.annotations.manager.UniProtRetriever")
    def test_to_pd_annotation_filtering(
        self, mock_uniprot_retriever, mock_taxonomy_retriever
    ):
        """Test that only requested annotations are returned."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_annotations.return_value = (
            SAMPLE_PROTEIN_ANNOTATIONS
        )
        mock_uniprot_retriever.return_value = mock_uniprot_instance

        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_annotations.return_value = (
            SAMPLE_TAXONOMY_ANNOTATIONS
        )
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance

        # Test with specific annotations including length binning
        headers = SAMPLE_HEADERS
        requested_annotations = ["length_fixed", "genus"]
        extractor = ProteinAnnotationExtractor(
            headers=headers, annotations=requested_annotations
        )

        result = extractor.to_pd()

        # Should only have identifier + requested annotations
        expected_columns = {"identifier", "length_fixed", "genus"}
        assert set(result.columns) == expected_columns

    @patch("src.protspace.data.annotations.manager.TaxonomyRetriever")
    @patch("src.protspace.data.annotations.manager.UniProtRetriever")
    def test_internal_columns_removed_from_output(
        self, mock_uniprot_retriever, mock_taxonomy_retriever
    ):
        """Test that internal columns (organism_id, length) are removed from final output."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_annotations.return_value = (
            SAMPLE_PROTEIN_ANNOTATIONS
        )
        mock_uniprot_retriever.return_value = mock_uniprot_instance

        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_annotations.return_value = (
            SAMPLE_TAXONOMY_ANNOTATIONS
        )
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance

        # Test with default annotations (no specific annotations requested)
        headers = SAMPLE_HEADERS
        extractor = ProteinAnnotationExtractor(headers=headers)

        result = extractor.to_pd()

        # Internal columns should never appear in final output
        assert "organism_id" not in result.columns
        assert "length" not in result.columns
        assert "sequence" not in result.columns

        # But derived annotations should be present
        assert "length_fixed" in result.columns
        assert "length_quantile" in result.columns

    @patch("src.protspace.data.annotations.manager.TaxonomyRetriever")
    @patch("src.protspace.data.annotations.manager.UniProtRetriever")
    def test_internal_columns_kept_in_cache_file(
        self, mock_uniprot_retriever, mock_taxonomy_retriever
    ):
        """Test that internal columns are kept in cache file but removed from returned DataFrame."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_annotations.return_value = (
            SAMPLE_PROTEIN_ANNOTATIONS
        )
        mock_uniprot_retriever.return_value = mock_uniprot_instance

        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_annotations.return_value = (
            SAMPLE_TAXONOMY_ANNOTATIONS
        )
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance

        with tempfile.TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / "cache.parquet"
            headers = SAMPLE_HEADERS
            extractor = ProteinAnnotationExtractor(
                headers=headers, output_path=cache_path
            )

            result = extractor.to_pd()

            # Cache file should contain internal columns for future cache hits
            cached_df = pd.read_parquet(cache_path)
            assert "organism_id" in cached_df.columns
            assert "length" in cached_df.columns

            # But returned DataFrame should not have them
            assert "organism_id" not in result.columns
            assert "length" not in result.columns
            assert "sequence" not in result.columns


class TestConstants:
    """Test module constants."""

    def test_default_annotations_constant(self):
        """Test that DEFAULT_ANNOTATIONS combines UniProt and taxonomy annotations."""
        from protspace.data.annotations.retrievers.interpro_retriever import (
            INTERPRO_ANNOTATIONS,
        )

        assert len(DEFAULT_ANNOTATIONS) == len(UNIPROT_ANNOTATIONS) + len(
            TAXONOMY_ANNOTATIONS
        ) + len(INTERPRO_ANNOTATIONS)
        assert all(
            annotation in DEFAULT_ANNOTATIONS for annotation in UNIPROT_ANNOTATIONS
        )
        assert all(
            annotation in DEFAULT_ANNOTATIONS for annotation in TAXONOMY_ANNOTATIONS
        )
        assert all(
            annotation in DEFAULT_ANNOTATIONS for annotation in INTERPRO_ANNOTATIONS
        )

    def test_needed_uniprot_annotations_constant(self):
        """Test NEEDED_UNIPROT_ANNOTATIONS constant."""
        assert NEEDED_UNIPROT_ANNOTATIONS == ["accession", "organism_id"]

    def test_length_binning_annotations_constant(self):
        """Test LENGTH_BINNING_ANNOTATIONS constant."""
        assert LENGTH_BINNING_ANNOTATIONS == ["length_fixed", "length_quantile"]
