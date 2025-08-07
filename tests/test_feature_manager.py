import pytest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch
import pandas as pd

from src.protspace.data.feature_manager import (
    ProteinFeatureExtractor,
    DEFAULT_FEATURES,
    NEEDED_UNIPROT_FEATURES,
    LENGTH_BINNING_FEATURES,
    UNIPROT_FEATURES,
    TAXONOMY_FEATURES,
)
from src.protspace.data.uniprot_feature_retriever import ProteinFeatures


# Test data
SAMPLE_HEADERS = ["P01308", "P01315", "P01316"]
SAMPLE_PROTEIN_FEATURES = [
    ProteinFeatures(
        identifier="P01308",
        features={
            "accession": "P01308",
            "organism_id": "9606",
            "length": "110",
            "protein_families": "Insulin family",
            "annotation_score": "5.0"
        }
    ),
    ProteinFeatures(
        identifier="P01315", 
        features={
            "accession": "P01315",
            "organism_id": "9606",
            "length": "142",
            "protein_families": "Insulin family",
            "annotation_score": "4.5"
        }
    ),
    ProteinFeatures(
        identifier="P01316",
        features={
            "accession": "P01316", 
            "organism_id": "10090",
            "length": "85",
            "protein_families": "Insulin family",
            "annotation_score": "3.8"
        }
    )
]

SAMPLE_TAXONOMY_FEATURES = {
    9606: {
        "features": {
            "genus": "Homo",
            "species": "Homo sapiens",
            "kingdom": "Metazoa"
        }
    },
    10090: {
        "features": {
            "genus": "Mus", 
            "species": "Mus musculus",
            "kingdom": "Metazoa"
        }
    }
}


class TestProteinFeatureExtractorInit:
    """Test ProteinFeatureExtractor initialization."""

    def test_init_with_basic_parameters(self):
        """Test initialization with basic parameters."""
        headers = SAMPLE_HEADERS
        features = ["length", "genus"]
        
        extractor = ProteinFeatureExtractor(headers=headers, features=features)
        
        assert extractor.headers == headers
        assert extractor.user_features == features
        assert extractor.output_path is None
        assert extractor.non_binary is False

    def test_init_with_output_path(self):
        """Test initialization with output path."""
        headers = SAMPLE_HEADERS
        output_path = Path("test_output.csv")
        
        extractor = ProteinFeatureExtractor(headers=headers, output_path=output_path, non_binary=True)
        
        assert extractor.output_path == output_path
        assert extractor.non_binary is True

    def test_init_with_invalid_features(self):
        """Test initialization with invalid features raises ValueError."""
        headers = SAMPLE_HEADERS
        invalid_features = ["length", "invalid_feature", "genus"]
        
        with pytest.raises(ValueError, match="Feature invalid_feature is not a valid feature"):
            ProteinFeatureExtractor(headers=headers, features=invalid_features)

    def test_init_with_no_features(self):
        """Test initialization without specifying features."""
        headers = SAMPLE_HEADERS
        
        extractor = ProteinFeatureExtractor(headers=headers)
        
        assert extractor.user_features is None
        assert extractor.uniprot_features is not None
        # taxonomy_features will be populated from DEFAULT_FEATURES
        assert extractor.taxonomy_features is not None


class TestValidateFeatures:
    """Test the _validate_features method."""

    def test_validate_features_valid_features(self):
        """Test validation with valid features."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        valid_features = ["length", "genus", "species", "protein_families"]
        
        result = extractor._validate_features(valid_features)
        
        assert result == valid_features

    def test_validate_features_with_none(self):
        """Test validation with None returns None."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        result = extractor._validate_features(None)
        
        assert result is None

    def test_validate_features_invalid_feature(self):
        """Test validation with invalid feature raises ValueError."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        invalid_features = ["length", "nonexistent_feature"]
        
        with pytest.raises(ValueError, match="Feature nonexistent_feature is not a valid feature"):
            extractor._validate_features(invalid_features)

    def test_validate_features_with_length_binning(self):
        """Test validation includes length binning features."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        features_with_binning = ["length_fixed", "length_quantile", "genus"]
        
        result = extractor._validate_features(features_with_binning)
        
        assert result == features_with_binning


class TestInitializeFeatures:
    """Test the _initialize_features method."""

    def test_initialize_features_with_user_features(self):
        """Test feature initialization with user-specified features."""
        headers = SAMPLE_HEADERS
        user_features = ["length", "genus", "species", "pfam"]
        
        extractor = ProteinFeatureExtractor(headers=headers, features=user_features)
        uniprot_features, taxonomy_features, interpro_features = extractor._initialize_features(DEFAULT_FEATURES)
        
        # Should include user's UniProt features plus required ones
        assert "accession" in uniprot_features
        assert "organism_id" in uniprot_features
        assert "length" in uniprot_features
        
        # Should include taxonomy features that are in both user_features and DEFAULT_FEATURES
        assert "genus" in taxonomy_features
        assert "species" in taxonomy_features

        # Should include InterPro features that are in user_features
        assert "pfam" in interpro_features

    def test_initialize_features_with_length_binning(self):
        """Test initialization when user requests length binning features."""
        headers = SAMPLE_HEADERS
        user_features = ["length_fixed", "genus"]
        
        extractor = ProteinFeatureExtractor(headers=headers, features=user_features)
        uniprot_features, taxonomy_features, interpro_features = extractor._initialize_features(DEFAULT_FEATURES)
        
        # Should automatically include "length" for binning computation
        assert "length" in uniprot_features

    def test_initialize_features_default_behavior(self):
        """Test initialization with default features."""
        headers = SAMPLE_HEADERS
        
        extractor = ProteinFeatureExtractor(headers=headers)
        uniprot_features, taxonomy_features, interpro_features = extractor._initialize_features(DEFAULT_FEATURES)
        
        # Should include all UniProt features from DEFAULT_FEATURES
        for feature in UNIPROT_FEATURES:
            assert feature in uniprot_features
        
        # Should include taxonomy features since they're in DEFAULT_FEATURES  
        assert taxonomy_features is not None
        assert len(taxonomy_features) > 0


class TestComputeLengthBins:
    """Test length binning functionality."""

    def test_compute_fixed_bins(self):
        """Test fixed length binning."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        lengths = [25, 75, 150, 350, 1500, None]
        
        result = extractor._compute_fixed_bins(lengths)
        
        expected = ["<50", "50-100", "100-200", "200-400", "1400-1600", "unknown"]
        assert result == expected

    def test_compute_quantile_bins(self):
        """Test quantile-based length binning."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        lengths = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
        
        result = extractor._compute_quantile_bins(lengths, 5)  # 5 bins
        
        # Should create 5 bins with roughly equal numbers of sequences
        assert len(set(result)) <= 5
        assert all(isinstance(bin_label, str) for bin_label in result)

    def test_compute_length_bins_integration(self):
        """Test complete length binning computation."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        protein_features = [
            ProteinFeatures(identifier="P1", features={"length": "110"}),
            ProteinFeatures(identifier="P2", features={"length": "250"}),
            ProteinFeatures(identifier="P3", features={"length": "invalid"}),
        ]
        
        result = extractor._compute_length_bins(protein_features)
        
        # Verify structure
        assert len(result) == 3
        for protein in result:
            assert "length_fixed" in protein.features
            assert "length_quantile" in protein.features
            assert "length" not in protein.features  # Original length should be removed
        
        # Verify binning
        assert result[0].features["length_fixed"] == "100-200"
        assert result[1].features["length_fixed"] == "200-400"
        assert result[2].features["length_fixed"] == "unknown"


class TestMergeFeatures:
    """Test feature merging functionality."""

    def test_merge_features_basic(self):
        """Test basic feature merging between UniProt and taxonomy."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        uniprot_features = [
            ProteinFeatures(identifier="P01308", features={"organism_id": "9606", "length": "110"}),
            ProteinFeatures(identifier="P01315", features={"organism_id": "10090", "length": "142"}),
        ]
        
        taxonomy_features = {
            9606: {"features": {"genus": "Homo", "species": "Homo sapiens"}},
            10090: {"features": {"genus": "Mus", "species": "Mus musculus"}},
        }
        
        result = extractor._merge_features(uniprot_features, taxonomy_features)
        
        # Verify merging
        assert len(result) == 2
        assert result[0].features["genus"] == "Homo"
        assert result[0].features["species"] == "Homo sapiens"
        assert result[1].features["genus"] == "Mus"
        assert result[1].features["species"] == "Mus musculus"

    def test_merge_features_with_top_9_filtering(self):
        """Test that feature merging keeps only top 9 values."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        uniprot_features = [
            ProteinFeatures(identifier=f"P{i}", features={"organism_id": str(i % 2)})
            for i in range(20)
        ]
        
        # Create taxonomy with many different values for a feature
        taxonomy_features = {}
        for i in range(2):
            taxonomy_features[i] = {
                "features": {"genus": f"Genus{i % 12}"}  # 12 different genera
            }
        
        result = extractor._merge_features(uniprot_features, taxonomy_features)
        
        # Should have applied "other" for less frequent values
        genus_values = set(protein.features.get("genus", "") for protein in result)
        assert len(genus_values) <= 10  # Max 9 + "other"

    def test_merge_features_missing_taxonomy(self):
        """Test merging when taxonomy data is missing for some organisms."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        uniprot_features = [
            ProteinFeatures(identifier="P01308", features={"organism_id": "9606"}),
            ProteinFeatures(identifier="P01315", features={"organism_id": "99999"}),  # Missing
        ]
        
        taxonomy_features = {
            9606: {"features": {"genus": "Homo"}},
            # 99999 missing
        }
        
        result = extractor._merge_features(uniprot_features, taxonomy_features)
        
        # Should handle missing taxonomy gracefully
        assert len(result) == 2
        assert result[0].features.get("genus") == "Homo"
        assert "genus" not in result[1].features  # No taxonomy data available


class TestFileOperations:
    """Test file saving operations."""

    def test_save_csv(self):
        """Test saving features to CSV file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "test_output.csv"
            extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS, output_path=output_path)
            
            protein_features = [
                ProteinFeatures(identifier="P1", features={"length": "110", "genus": "Homo"}),
                ProteinFeatures(identifier="P2", features={"length": "142", "genus": "Mus"}),
            ]
            
            extractor.save_csv(protein_features)
            
            # Verify file was created and has correct content
            assert output_path.exists()
            df = pd.read_csv(output_path)
            assert len(df) == 2
            assert list(df["identifier"]) == ["P1", "P2"]

    def test_save_arrow(self):
        """Test saving features to Parquet file."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "test_output.parquet"
            extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS, output_path=output_path)
            
            protein_features = [
                ProteinFeatures(identifier="P1", features={"length": "110", "genus": "Homo"}),
                ProteinFeatures(identifier="P2", features={"length": "142", "genus": "Mus"}),
            ]
            
            extractor.save_arrow(protein_features)
            
            # Verify file was created and has correct content
            assert output_path.exists()
            df = pd.read_parquet(output_path)
            assert len(df) == 2
            assert list(df["identifier"]) == ["P1", "P2"]


class TestCreateDataframeFromFeatures:
    """Test DataFrame creation from features."""

    def test_create_dataframe_from_features(self):
        """Test creating DataFrame directly from features."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        protein_features = [
            ProteinFeatures(identifier="P1", features={"length": "110", "genus": "Homo"}),
            ProteinFeatures(identifier="P2", features={"length": "142", "genus": "Mus"}),
        ]
        
        result = extractor._create_dataframe_from_features(protein_features)
        
        # Verify DataFrame structure
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 2
        assert "identifier" in result.columns
        assert list(result["identifier"]) == ["P1", "P2"]

    def test_create_dataframe_empty_features(self):
        """Test creating DataFrame with empty features list."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        result = extractor._create_dataframe_from_features([])
        
        # Should create DataFrame with just identifier column
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 0
        assert list(result.columns) == ["identifier"]


class TestModifyIfNeeded:
    """Test the _modify_if_needed method."""

    def test_modify_annotation_score(self):
        """Test modification of annotation score values."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        row = ["P01308", "5.0", "Insulin family"]
        headers = ["identifier", "annotation_score", "protein_families"]
        
        result = extractor._modify_if_needed(row, headers)
        
        # Should convert float annotation score to integer string
        assert result[1] == "5"

    def test_modify_protein_families(self):
        """Test modification of protein families values."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        row = ["P01308", "Insulin family, Growth factor family"]
        headers = ["identifier", "protein_families"]
        
        result = extractor._modify_if_needed(row, headers)
        
        # Should take only first family
        assert result[1] == "Insulin family"

    def test_modify_protein_families_with_semicolon(self):
        """Test modification of protein families with semicolon separator."""
        extractor = ProteinFeatureExtractor(headers=SAMPLE_HEADERS)
        
        row = ["P01308", "Insulin family; Growth factor family"]
        headers = ["identifier", "protein_families"]
        
        result = extractor._modify_if_needed(row, headers)
        
        # Should take only first family
        assert result[1] == "Insulin family"


class TestIntegration:
    """Integration tests for complete workflows."""

    @patch("src.protspace.data.feature_manager.TaxonomyFeatureRetriever")
    @patch("src.protspace.data.feature_manager.UniProtFeatureRetriever")
    def test_to_pd_complete_workflow(self, mock_uniprot_retriever, mock_taxonomy_retriever):
        """Test complete workflow from initialization to DataFrame creation."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_features.return_value = SAMPLE_PROTEIN_FEATURES
        mock_uniprot_retriever.return_value = mock_uniprot_instance
        
        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_features.return_value = SAMPLE_TAXONOMY_FEATURES
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance
        
        # Test
        headers = SAMPLE_HEADERS
        features = ["length", "genus", "species"]
        extractor = ProteinFeatureExtractor(headers=headers, features=features)
        
        result = extractor.to_pd()
        
        # Verify result
        assert isinstance(result, pd.DataFrame)
        assert len(result) == 3
        assert "identifier" in result.columns
        assert "genus" in result.columns
        assert "species" in result.columns

    @patch("src.protspace.data.feature_manager.TaxonomyFeatureRetriever")
    @patch("src.protspace.data.feature_manager.UniProtFeatureRetriever")
    def test_to_pd_with_file_output(self, mock_uniprot_retriever, mock_taxonomy_retriever):
        """Test workflow with file output."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_features.return_value = SAMPLE_PROTEIN_FEATURES
        mock_uniprot_retriever.return_value = mock_uniprot_instance
        
        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_features.return_value = {}
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance
        
        # Test with file output
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output.csv"
            headers = SAMPLE_HEADERS
            
            extractor = ProteinFeatureExtractor(
                headers=headers, 
                features=["length"],
                output_path=output_path,
                non_binary=True
            )
            
            result = extractor.to_pd()
            
            # Verify file was created and DataFrame loaded from it
            assert output_path.exists()
            assert isinstance(result, pd.DataFrame)
            assert len(result) == 3

    @patch("src.protspace.data.feature_manager.TaxonomyFeatureRetriever")
    @patch("src.protspace.data.feature_manager.UniProtFeatureRetriever")
    def test_to_pd_feature_filtering(self, mock_uniprot_retriever, mock_taxonomy_retriever):
        """Test that only requested features are returned."""
        # Setup mocks
        mock_uniprot_instance = Mock()
        mock_uniprot_instance.fetch_features.return_value = SAMPLE_PROTEIN_FEATURES
        mock_uniprot_retriever.return_value = mock_uniprot_instance
        
        mock_taxonomy_instance = Mock()
        mock_taxonomy_instance.fetch_features.return_value = SAMPLE_TAXONOMY_FEATURES
        mock_taxonomy_retriever.return_value = mock_taxonomy_instance
        
        # Test with specific features including length binning
        headers = SAMPLE_HEADERS
        requested_features = ["length_fixed", "genus"]
        extractor = ProteinFeatureExtractor(headers=headers, features=requested_features)
        
        result = extractor.to_pd()
        
        # Should only have identifier + requested features
        expected_columns = {"identifier", "length_fixed", "genus"}
        assert set(result.columns) == expected_columns


class TestConstants:
    """Test module constants."""

    def test_default_features_constant(self):
        """Test that DEFAULT_FEATURES combines UniProt and taxonomy features."""
        from protspace.data.interpro_feature_retriever import INTERPRO_FEATURES
        assert len(DEFAULT_FEATURES) == len(UNIPROT_FEATURES) + len(TAXONOMY_FEATURES) + len(INTERPRO_FEATURES)
        assert all(feature in DEFAULT_FEATURES for feature in UNIPROT_FEATURES)
        assert all(feature in DEFAULT_FEATURES for feature in TAXONOMY_FEATURES)
        assert all(feature in DEFAULT_FEATURES for feature in INTERPRO_FEATURES)

    def test_needed_uniprot_features_constant(self):
        """Test NEEDED_UNIPROT_FEATURES constant."""
        assert NEEDED_UNIPROT_FEATURES == ["accession", "organism_id"]

    def test_length_binning_features_constant(self):
        """Test LENGTH_BINNING_FEATURES constant."""
        assert LENGTH_BINNING_FEATURES == ["length_fixed", "length_quantile"] 