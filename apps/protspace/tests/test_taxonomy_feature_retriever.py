import pytest
from unittest.mock import Mock, patch, mock_open

from src.protspace.data.taxonomy_feature_retriever import (
    TaxonomyFeatureRetriever,
    TAXONOMY_FEATURES,
)


class TestTaxonomyFeatureRetrieverInit:
    """Test TaxonomyFeatureRetriever initialization."""

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    def test_init_with_valid_taxon_ids(self, mock_taxdb):
        """Test initialization with valid taxon IDs."""
        mock_taxdb.return_value = Mock()
        taxon_ids = [9606, 10090, 7227]  # Human, Mouse, Fly
        features = ["genus", "species"]
        
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
        
        assert retriever.taxon_ids == taxon_ids
        assert retriever.features == features
        assert retriever.taxdb is not None

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    def test_init_with_default_features(self, mock_taxdb):
        """Test initialization with default features."""
        mock_taxdb.return_value = Mock()
        taxon_ids = [9606]
        
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids)
        
        assert retriever.taxon_ids == taxon_ids
        assert retriever.features is None

    def test_init_with_invalid_taxon_ids(self):
        """Test initialization with invalid taxon IDs raises ValueError."""
        invalid_taxon_ids = [9606, "invalid", 10090]
        
        with pytest.raises(ValueError, match="Taxon ID invalid is not an integer"):
            TaxonomyFeatureRetriever(taxon_ids=invalid_taxon_ids)


class TestValidateTaxonIds:
    """Test the _validate_taxon_ids method."""

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    def test_validate_taxon_ids_valid(self, mock_taxdb):
        """Test validation with valid integer taxon IDs."""
        mock_taxdb.return_value = Mock()
        retriever = TaxonomyFeatureRetriever(taxon_ids=[9606])
        
        valid_ids = [9606, 10090, 7227]
        result = retriever._validate_taxon_ids(valid_ids)
        
        assert result == valid_ids

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    def test_validate_taxon_ids_invalid_string(self, mock_taxdb):
        """Test validation fails with string taxon ID."""
        mock_taxdb.return_value = Mock()
        retriever = TaxonomyFeatureRetriever(taxon_ids=[9606])
        
        invalid_ids = [9606, "invalid", 10090]
        
        with pytest.raises(ValueError, match="Taxon ID invalid is not an integer"):
            retriever._validate_taxon_ids(invalid_ids)

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    def test_validate_taxon_ids_invalid_float(self, mock_taxdb):
        """Test validation fails with float taxon ID."""
        mock_taxdb.return_value = Mock()
        retriever = TaxonomyFeatureRetriever(taxon_ids=[9606])
        
        invalid_ids = [9606, 10090.5]
        
        with pytest.raises(ValueError, match="Taxon ID 10090.5 is not an integer"):
            retriever._validate_taxon_ids(invalid_ids)


class TestFetchFeatures:
    """Test the fetch_features method."""

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.Taxon")
    def test_fetch_features_success(self, mock_taxon_class, mock_taxdb):
        """Test successful feature fetching."""
        # Setup mocks
        mock_taxdb.return_value = Mock()
        
        # Mock taxon instances
        mock_human_taxon = Mock()
        mock_human_taxon.name = "Homo sapiens"
        mock_human_taxon.rank_name_dictionary = {
            "superkingdom": "Eukaryota",
            "kingdom": "Metazoa", 
            "phylum": "Chordata",
            "class": "Mammalia",
            "order": "Primates",
            "family": "Hominidae",
            "genus": "Homo",
            "species": "Homo sapiens"
        }
        
        mock_mouse_taxon = Mock()
        mock_mouse_taxon.name = "Mus musculus"
        mock_mouse_taxon.rank_name_dictionary = {
            "superkingdom": "Eukaryota",
            "kingdom": "Metazoa",
            "phylum": "Chordata", 
            "class": "Mammalia",
            "order": "Rodentia",
            "family": "Muridae",
            "genus": "Mus",
            "species": "Mus musculus"
        }
        
        # Setup side effect for taxon creation
        def taxon_side_effect(taxon_id, taxdb):
            if taxon_id == 9606:
                return mock_human_taxon
            elif taxon_id == 10090:
                return mock_mouse_taxon
            else:
                raise ValueError("Unknown taxon")
        
        mock_taxon_class.side_effect = taxon_side_effect
        
        # Test
        taxon_ids = [9606, 10090]
        features = ["genus", "species", "order"]
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
        
        result = retriever.fetch_features()
        
        # Verify results
        assert len(result) == 2
        
        # Check human data
        assert 9606 in result
        human_features = result[9606]["features"]
        assert human_features["genus"] == "Homo"
        assert human_features["species"] == "Homo sapiens"
        assert human_features["order"] == "Primates"
        
        # Check mouse data
        assert 10090 in result
        mouse_features = result[10090]["features"]
        assert mouse_features["genus"] == "Mus"
        assert mouse_features["species"] == "Mus musculus"
        assert mouse_features["order"] == "Rodentia"

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.Taxon")
    def test_fetch_features_with_missing_ranks(self, mock_taxon_class, mock_taxdb):
        """Test feature fetching when some taxonomy ranks are missing."""
        # Setup mocks
        mock_taxdb.return_value = Mock()
        
        mock_taxon = Mock()
        mock_taxon.name = "Test organism"
        mock_taxon.rank_name_dictionary = {
            "genus": "TestGenus",
            # Missing species, order, etc.
        }
        
        mock_taxon_class.return_value = mock_taxon
        
        # Test
        taxon_ids = [12345]
        features = ["genus", "species", "order"]
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
        
        result = retriever.fetch_features()
        
        # Verify results
        assert len(result) == 1
        features_data = result[12345]["features"]
        assert features_data["genus"] == "TestGenus"
        assert features_data["species"] == ""  # Missing rank should be empty string
        assert features_data["order"] == ""

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.Taxon")
    def test_fetch_features_with_error(self, mock_taxon_class, mock_taxdb):
        """Test feature fetching when taxopy raises an error."""
        # Setup mocks
        mock_taxdb.return_value = Mock()
        mock_taxon_class.side_effect = Exception("Network error")
        
        # Test
        taxon_ids = [9999]
        features = ["genus", "species"]
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
        
        result = retriever.fetch_features()
        
        # Verify error handling
        assert len(result) == 1
        features_data = result[9999]["features"]
        assert features_data["genus"] == ""
        assert features_data["species"] == ""


class TestGetTaxonomyInfo:
    """Test the _get_taxonomy_info method."""

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.Taxon")
    def test_get_taxonomy_info_success(self, mock_taxon_class, mock_taxdb):
        """Test successful taxonomy info retrieval."""
        # Setup mocks
        mock_taxdb.return_value = Mock()
        
        mock_taxon = Mock()
        mock_taxon.name = "Escherichia coli"
        mock_taxon.rank_name_dictionary = {
            "superkingdom": "Bacteria",
            "phylum": "Proteobacteria",
            "class": "Gammaproteobacteria", 
            "order": "Enterobacterales",
            "family": "Enterobacteriaceae",
            "genus": "Escherichia",
            "species": "Escherichia coli"
        }
        
        mock_taxon_class.return_value = mock_taxon
        
        # Test
        taxon_ids = [511145]  # E. coli
        features = ["superkingdom", "genus", "species"]
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
        
        result = retriever._get_taxonomy_info(taxon_ids)
        
        # Verify results
        assert len(result) == 1
        assert 511145 in result
        tax_info = result[511145]
        assert tax_info["superkingdom"] == "Bacteria"
        assert tax_info["genus"] == "Escherichia"
        assert tax_info["species"] == "Escherichia coli"

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.Taxon")
    def test_get_taxonomy_info_exception_handling(self, mock_taxon_class, mock_taxdb):
        """Test error handling in taxonomy info retrieval."""
        # Setup mocks
        mock_taxdb.return_value = Mock()
        mock_taxon_class.side_effect = Exception("Invalid taxon ID")
        
        # Test
        taxon_ids = [99999]
        features = ["genus", "species"]
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
        
        result = retriever._get_taxonomy_info(taxon_ids)
        
        # Verify error handling
        assert len(result) == 1
        assert 99999 in result
        tax_info = result[99999]
        assert tax_info["genus"] == ""
        assert tax_info["species"] == ""


class TestInitializeTaxdb:
    """Test the _initialize_taxdb method."""

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    @patch("builtins.open", new_callable=mock_open)
    @patch("pathlib.Path.exists")
    @patch("pathlib.Path.mkdir")
    def test_initialize_taxdb_fresh_download(self, mock_mkdir, mock_exists, mock_file, mock_taxdb):
        """Test database initialization with fresh download."""
        # Setup mocks - no existing files
        mock_exists.return_value = False
        mock_taxdb_instance = Mock()
        mock_taxdb.return_value = mock_taxdb_instance
        
        # Test
        retriever = TaxonomyFeatureRetriever.__new__(TaxonomyFeatureRetriever)
        retriever.taxon_ids = [9606]
        retriever.features = ["genus"]
        
        result = retriever._initialize_taxdb()
        
        # Verify fresh download
        assert result == mock_taxdb_instance
        mock_mkdir.assert_called()  # Cache directory created

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    def test_initialize_taxdb_basic_functionality(self, mock_taxdb):
        """Test basic database initialization functionality."""
        # Setup mocks
        mock_taxdb_instance = Mock()
        mock_taxdb.return_value = mock_taxdb_instance
        
        # Test
        retriever = TaxonomyFeatureRetriever.__new__(TaxonomyFeatureRetriever)
        retriever.taxon_ids = [9606]
        retriever.features = ["genus"]
        
        result = retriever._initialize_taxdb()
        
        # Verify basic functionality
        assert result == mock_taxdb_instance
        mock_taxdb.assert_called()


class TestConstants:
    """Test module constants."""

    def test_taxonomy_features_constant(self):
        """Test that TAXONOMY_FEATURES contains expected features."""
        expected_features = [
            "taxon_name",
            "superkingdom", 
            "kingdom",
            "phylum",
            "class",
            "order",
            "family",
            "genus",
            "species",
        ]
        
        assert TAXONOMY_FEATURES == expected_features
        assert len(TAXONOMY_FEATURES) == 9


class TestIntegration:
    """Integration tests for complete workflows."""

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.Taxon")
    def test_end_to_end_workflow(self, mock_taxon_class, mock_taxdb):
        """Test complete workflow from initialization to feature extraction."""
        # Setup mocks
        mock_taxdb.return_value = Mock()
        
        mock_taxon = Mock()
        mock_taxon.name = "Saccharomyces cerevisiae"
        mock_taxon.rank_name_dictionary = {
            "superkingdom": "Eukaryota",
            "kingdom": "Fungi",
            "phylum": "Ascomycota",
            "class": "Saccharomycetes",
            "order": "Saccharomycetales", 
            "family": "Saccharomycetaceae",
            "genus": "Saccharomyces",
            "species": "Saccharomyces cerevisiae"
        }
        
        mock_taxon_class.return_value = mock_taxon
        
        # Test complete workflow
        taxon_ids = [4932]  # S. cerevisiae
        features = ["kingdom", "genus", "species"]
        
        retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
        result = retriever.fetch_features()
        
        # Verify complete workflow
        assert len(result) == 1
        assert 4932 in result
        
        features_data = result[4932]["features"]
        assert features_data["kingdom"] == "Fungi"
        assert features_data["genus"] == "Saccharomyces"
        assert features_data["species"] == "Saccharomyces cerevisiae"

    @patch("src.protspace.data.taxonomy_feature_retriever.taxopy.TaxDb")
    def test_mixed_success_and_failure(self, mock_taxdb):
        """Test workflow with mixed successful and failed taxon lookups."""
        mock_taxdb.return_value = Mock()
        
        def taxon_side_effect(taxon_id, taxdb):
            if taxon_id == 9606:
                mock_taxon = Mock()
                mock_taxon.name = "Homo sapiens"
                mock_taxon.rank_name_dictionary = {"genus": "Homo", "species": "Homo sapiens"}
                return mock_taxon
            else:
                raise Exception("Invalid taxon")
        
        with patch("src.protspace.data.taxonomy_feature_retriever.taxopy.Taxon", side_effect=taxon_side_effect):
            taxon_ids = [9606, 99999]  # Valid and invalid
            features = ["genus", "species"]
            
            retriever = TaxonomyFeatureRetriever(taxon_ids=taxon_ids, features=features)
            result = retriever.fetch_features()
            
            # Verify mixed results
            assert len(result) == 2
            
            # Successful lookup
            assert result[9606]["features"]["genus"] == "Homo"
            assert result[9606]["features"]["species"] == "Homo sapiens"
            
            # Failed lookup
            assert result[99999]["features"]["genus"] == ""
            assert result[99999]["features"]["species"] == "" 