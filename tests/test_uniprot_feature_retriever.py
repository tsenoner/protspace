from unittest.mock import Mock, patch

from src.protspace.data.uniprot_feature_retriever import (
    UniProtFeatureRetriever,
    UNIPROT_FEATURES,
    ProteinFeatures,
)


class TestUniProtFeatureRetrieverInit:
    """Test UniProtFeatureRetriever initialization."""

    def test_init_with_headers_and_features(self):
        """Test initialization with both headers and features."""
        headers = ["P01308", "P01315"]
        features = ["length", "organism_id"]
        
        retriever = UniProtFeatureRetriever(headers=headers, features=features)
        
        assert retriever.headers == headers
        assert retriever.features == features
        assert retriever.u is not None  # UniProt instance created

    def test_init_with_pipe_headers(self):
        """Test initialization with headers containing pipe notation."""
        headers = ["sp|P01308|INS_HUMAN", "tr|P01315|INSL3_HUMAN"]
        features = ["length"]
        
        retriever = UniProtFeatureRetriever(headers=headers, features=features)
        
        # Should extract accession IDs from pipe notation
        assert retriever.headers == ["P01308", "P01315"]
        assert retriever.features == features

    def test_init_with_defaults(self):
        """Test initialization with default values."""
        retriever = UniProtFeatureRetriever()
        
        assert retriever.headers == []
        assert retriever.features is None


class TestManageHeaders:
    """Test the _manage_headers method."""

    def test_manage_headers_swissprot_format(self):
        """Test header management with SwissProt format."""
        retriever = UniProtFeatureRetriever()
        headers = ["sp|P01308|INS_HUMAN", "sp|P01315|INSL3_HUMAN"]
        
        result = retriever._manage_headers(headers)
        
        assert result == ["P01308", "P01315"]

    def test_manage_headers_trembl_format(self):
        """Test header management with TrEMBL format."""
        retriever = UniProtFeatureRetriever()
        headers = ["tr|A0A0A0MRZ7|A0A0A0MRZ7_HUMAN", "tr|Q8N2C7|Q8N2C7_HUMAN"]
        
        result = retriever._manage_headers(headers)
        
        assert result == ["A0A0A0MRZ7", "Q8N2C7"]

    def test_manage_headers_mixed_formats(self):
        """Test header management with mixed formats."""
        retriever = UniProtFeatureRetriever()
        headers = ["sp|P01308|INS_HUMAN", "P01315", "tr|Q8N2C7|Q8N2C7_HUMAN"]
        
        result = retriever._manage_headers(headers)
        
        assert result == ["P01308", "P01315", "Q8N2C7"]

    def test_manage_headers_simple_format(self):
        """Test header management with simple accession format."""
        retriever = UniProtFeatureRetriever()
        headers = ["P01308", "P01315", "Q8N2C7"]
        
        result = retriever._manage_headers(headers)
        
        assert result == ["P01308", "P01315", "Q8N2C7"]

    def test_manage_headers_case_insensitive(self):
        """Test that header management is case insensitive."""
        retriever = UniProtFeatureRetriever()
        headers = ["SP|P01308|INS_HUMAN", "TR|P01315|INSL3_HUMAN"]
        
        result = retriever._manage_headers(headers)
        
        assert result == ["P01308", "P01315"]


class TestFetchFeatures:
    """Test the fetch_features method."""

    @patch("src.protspace.data.uniprot_feature_retriever.UniProt")
    def test_fetch_features_success(self, mock_uniprot_class):
        """Test successful feature fetching."""
        # Setup mock UniProt instance
        mock_uniprot_instance = Mock()
        mock_uniprot_class.return_value = mock_uniprot_instance
        
        # Mock successful API response
        mock_response = """Entry\tLength\tOrganism (ID)
P01308\t110\t9606
P01315\t142\t9606"""
        
        mock_uniprot_instance.search.return_value = mock_response
        
        # Create retriever and test
        headers = ["P01308", "P01315"]
        features = ["accession", "length", "organism_id"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)
        
        result = retriever.fetch_features()
        
        # Verify results
        assert len(result) == 2
        assert isinstance(result[0], ProteinFeatures)
        assert result[0].identifier == "P01308"
        assert result[0].features["length"] == "110"
        assert result[0].features["organism_id"] == "9606"
        
        assert result[1].identifier == "P01315"
        assert result[1].features["length"] == "142"
        assert result[1].features["organism_id"] == "9606"
        
        # Verify API call
        mock_uniprot_instance.search.assert_called_once()
        call_args = mock_uniprot_instance.search.call_args[1]
        assert "accession:P01308+OR+accession:P01315" in call_args["query"]
        assert call_args["columns"] == "accession,length,organism_id"

    @patch("src.protspace.data.uniprot_feature_retriever.UniProt")
    def test_fetch_features_batching_logic(self, mock_uniprot_class):
        """Test feature fetching with batching behavior."""
        # Setup mock UniProt instance
        mock_uniprot_instance = Mock()
        mock_uniprot_class.return_value = mock_uniprot_instance
        
        # Test with small number to verify basic batching works
        headers = [f"P{i:05d}" for i in range(5)]
        
        # Mock response for small batch
        mock_response = "Entry\tLength\n" + "\n".join([f"P{i:05d}\t{100+i}" for i in range(5)])
        
        mock_uniprot_instance.search.return_value = mock_response
        
        # Create retriever and test
        features = ["accession", "length"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)
        
        result = retriever.fetch_features()
        
        # Verify results
        assert len(result) == 5
        # Verify each result has correct structure
        for i, protein in enumerate(result):
            assert protein.identifier == f"P{i:05d}"
            assert protein.features["length"] == str(100 + i)

    @patch("src.protspace.data.uniprot_feature_retriever.UniProt")
    def test_fetch_features_empty_response(self, mock_uniprot_class):
        """Test handling of empty API response."""
        # Setup mock UniProt instance
        mock_uniprot_instance = Mock()
        mock_uniprot_class.return_value = mock_uniprot_instance
        
        # Mock empty response
        mock_uniprot_instance.search.return_value = None
        
        # Create retriever and test
        headers = ["INVALID123"]
        features = ["accession", "length"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)
        
        result = retriever.fetch_features()
        
        # Should return empty list
        assert result == []

    @patch("src.protspace.data.uniprot_feature_retriever.UniProt")
    def test_fetch_features_incomplete_data(self, mock_uniprot_class):
        """Test handling of incomplete data in API response."""
        # Setup mock UniProt instance
        mock_uniprot_instance = Mock()
        mock_uniprot_class.return_value = mock_uniprot_instance
        
        # Mock response with incomplete data (missing some columns)
        mock_response = """Entry\tLength\tOrganism (ID)
P01308\t110
P01315\t142\t9606"""
        
        mock_uniprot_instance.search.return_value = mock_response
        
        # Create retriever and test
        headers = ["P01308", "P01315"]
        features = ["accession", "length", "organism_id"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)
        
        result = retriever.fetch_features()
        
        # Verify results handle missing data gracefully
        assert len(result) == 2
        assert result[0].identifier == "P01308"
        assert result[0].features["length"] == "110"
        # organism_id should not be in features for P01308 due to missing data
        assert "organism_id" not in result[0].features
        
        assert result[1].identifier == "P01315"
        assert result[1].features["length"] == "142"
        assert result[1].features["organism_id"] == "9606"


class TestConstants:
    """Test module constants."""

    def test_uniprot_features_constant(self):
        """Test that UNIPROT_FEATURES contains expected features."""
        expected_features = [
            "protein_existence",
            "annotation_score",
            "protein_families",
            "length",
            "reviewed",
            "fragment",
        ]
        
        for feature in expected_features:
            assert feature in UNIPROT_FEATURES

    def test_protein_features_namedtuple(self):
        """Test ProteinFeatures namedtuple structure."""
        features_dict = {"length": "110", "organism_id": "9606"}
        protein_features = ProteinFeatures(identifier="P01308", features=features_dict)
        
        assert protein_features.identifier == "P01308"
        assert protein_features.features == features_dict
        assert hasattr(protein_features, "identifier")
        assert hasattr(protein_features, "features")


class TestIntegration:
    """Integration tests for complete workflows."""

    @patch("src.protspace.data.uniprot_feature_retriever.UniProt")
    def test_end_to_end_workflow(self, mock_uniprot_class):
        """Test complete workflow from initialization to feature extraction."""
        # Setup mock
        mock_uniprot_instance = Mock()
        mock_uniprot_class.return_value = mock_uniprot_instance
        
        mock_response = """Entry\tLength\tOrganism (ID)\tProtein existence
P01308\t110\t9606\t1
P01315\t142\t9606\t1"""
        
        mock_uniprot_instance.search.return_value = mock_response
        
        # Test with pipe notation headers (should be cleaned)
        headers = ["sp|P01308|INS_HUMAN", "tr|P01315|INSL3_HUMAN"]
        features = ["accession", "length", "organism_id", "protein_existence"]
        
        retriever = UniProtFeatureRetriever(headers=headers, features=features)
        result = retriever.fetch_features()
        
        # Verify complete workflow
        assert len(result) == 2
        assert retriever.headers == ["P01308", "P01315"]  # Headers cleaned
        
        # Verify features extracted correctly
        for protein in result:
            assert protein.identifier in ["P01308", "P01315"]
            assert "length" in protein.features
            assert "organism_id" in protein.features
            assert "protein_existence" in protein.features 