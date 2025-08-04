from unittest.mock import Mock, patch
from src.protspace.data.interpro_feature_retriever import (
    InterProFeatureRetriever,
    INTERPRO_FEATURES
)


class TestInterProFeatureRetrieverInit:
    """Test InterProFeatureRetriever initialization."""

    def test_init_with_headers_and_features(self):
        """Test initialization with headers and features."""
        headers = ["sp|P12345|PROTEIN_MOUSE", "tr|Q67890|PROTEIN_HUMAN"]
        features = ["pfam", "superfamily"]
        sequences = {"P12345": "MKLLLLLLLL", "Q67890": "MVKLLLLLL"}
        
        retriever = InterProFeatureRetriever(headers=headers, features=features, sequences=sequences)
        
        assert retriever.headers == ["P12345", "Q67890"]
        assert retriever.features == features
        assert retriever.sequences == sequences

    def test_init_default_features(self):
        """Test initialization with default features."""
        headers = ["P12345"]
        sequences = {"P12345": "MKLLLLLLLL"}
        
        retriever = InterProFeatureRetriever(headers=headers, sequences=sequences)
        
        assert retriever.features == INTERPRO_FEATURES

    def test_init_invalid_features(self):
        """Test initialization with invalid features."""
        headers = ["P12345"]
        features = ["pfam", "invalid_feature", "superfamily"]
        sequences = {"P12345": "MKLLLLLLLL"}
        
        retriever = InterProFeatureRetriever(headers=headers, features=features, sequences=sequences)
        
        # Should filter out invalid features
        assert "invalid_feature" not in retriever.features
        assert "pfam" in retriever.features
        assert "superfamily" in retriever.features

    def test_manage_headers_uniprot(self):
        """Test header management for UniProt headers."""
        headers = ["sp|P12345|PROTEIN_MOUSE", "tr|Q67890|PROTEIN_HUMAN"]
        
        retriever = InterProFeatureRetriever()
        managed = retriever._manage_headers(headers)
        
        assert managed == ["P12345", "Q67890"]

    def test_manage_headers_other(self):
        """Test header management for other header formats."""
        headers = ["generic|PROTEIN1|extra", "simple_header"]
        
        retriever = InterProFeatureRetriever()
        managed = retriever._manage_headers(headers)
        
        assert managed == ["PROTEIN1", "simple_header"]


class TestInterProFeatureRetrieverFetch:
    """Test InterProFeatureRetriever fetch_features method."""

    @patch('src.protspace.data.interpro_feature_retriever.requests.post')
    def test_fetch_features_success(self, mock_post):
        """Test successful feature fetching."""
        headers = ["P12345"]
        features = ["pfam"]
        sequences = {"P12345": "MKLLLLLLLL"}
        
        # Mock API response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": [
                {
                    "md5": "5D41402ABC4B2A76B9719D911017C592",  # MD5 of "hello"
                    "found": True,
                    "matches": [
                        {
                            "signature": {
                                "accession": "PF00001",
                                "signatureLibraryRelease": {
                                    "library": "Pfam"
                                }
                            }
                        }
                    ]
                }
            ]
        }
        mock_post.return_value = mock_response
        
        retriever = InterProFeatureRetriever(headers=headers, features=features, sequences=sequences)
        
        # Override MD5 calculation for predictable test
        with patch('src.protspace.data.interpro_feature_retriever.hashlib.md5') as mock_md5:
            mock_md5.return_value.hexdigest.return_value = "5D41402ABC4B2A76B9719D911017C592"
            
            result = retriever.fetch_features()
        
        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert "pfam" in result[0].features
        assert result[0].features["pfam"] == "PF00001"

    def test_fetch_features_no_headers(self):
        """Test fetch_features with no headers."""
        retriever = InterProFeatureRetriever(headers=[], features=["pfam"], sequences={})
        
        result = retriever.fetch_features()
        
        assert result == []

    def test_fetch_features_no_sequences(self):
        """Test fetch_features with no sequences."""
        retriever = InterProFeatureRetriever(headers=["P12345"], features=["pfam"], sequences={})
        
        result = retriever.fetch_features()
        
        assert result == []

    def test_fetch_features_missing_sequences(self):
        """Test fetch_features with missing sequences for some headers."""
        headers = ["P12345", "Q67890"]
        sequences = {"P12345": "MKLLLLLLLL"}  # Missing Q67890
        
        retriever = InterProFeatureRetriever(headers=headers, features=["pfam"], sequences=sequences)
        
        with patch.object(retriever, '_get_matches_in_batches') as mock_get_matches:
            mock_get_matches.return_value = []
            
            result = retriever.fetch_features()
            
            # Should only process P12345, not Q67890
            mock_get_matches.assert_called_once()
            called_md5s = mock_get_matches.call_args[0][0]
            assert len(called_md5s) == 1


class TestInterProFeatureRetrieverParsing:
    """Test InterPro result parsing methods."""

    def test_parse_interpro_results(self):
        """Test parsing of InterPro API results."""
        md5_to_identifier = {"ABC123": "P12345"}
        features = ["pfam", "superfamily"]
        
        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {
                                "library": "Pfam"
                            }
                        }
                    },
                    {
                        "signature": {
                            "accession": "SSF12345",
                            "signatureLibraryRelease": {
                                "library": "SUPERFAMILY"
                            }
                        }
                    }
                ]
            }
        ]
        
        retriever = InterProFeatureRetriever(features=features)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)
        
        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert result[0].features["pfam"] == "PF00001"
        assert result[0].features["superfamily"] == "SSF12345"

    def test_parse_interpro_results_not_found(self):
        """Test parsing when protein not found in UniParc."""
        md5_to_identifier = {"ABC123": "P12345"}
        features = ["pfam"]
        
        api_results = [
            {
                "md5": "ABC123",
                "found": False,
                "matches": []
            }
        ]
        
        retriever = InterProFeatureRetriever(features=features)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)
        
        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert result[0].features["pfam"] == ""  # Empty when not found

    def test_parse_interpro_results_filter_databases(self):
        """Test that only requested databases are included."""
        md5_to_identifier = {"ABC123": "P12345"}
        features = ["pfam"]  # Only requesting Pfam
        
        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {
                                "library": "Pfam"
                            }
                        }
                    },
                    {
                        "signature": {
                            "accession": "SSF12345",
                            "signatureLibraryRelease": {
                                "library": "SUPERFAMILY"
                            }
                        }
                    }
                ]
            }
        ]
        
        retriever = InterProFeatureRetriever(features=features)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)
        
        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert result[0].features["pfam"] == "PF00001"
        # SUPERFAMILY should not be included since not requested
        assert "superfamily" not in result[0].features


def test_interpro_features_constant():
    """Test that INTERPRO_FEATURES contains expected features."""
    expected_features = [
        "pfam",
        "superfamily", 
        "cath",
        "signal_peptide"
    ]
    
    for feature in expected_features:
        assert feature in INTERPRO_FEATURES