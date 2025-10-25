from unittest.mock import Mock, patch

from src.protspace.data.features.retrievers.uniprot_retriever import (
    UNIPROT_FEATURES,
    ProteinFeatures,
    UniProtRetriever,
)

# Alias for test compatibility
UniProtFeatureRetriever = UniProtRetriever


class TestUniProtFeatureRetrieverInit:
    """Test UniProtFeatureRetriever initialization."""

    def test_init_with_headers_and_features(self):
        """Test initialization with both headers and features."""
        headers = ["P01308", "P01315"]
        features = ["length", "organism_id"]

        retriever = UniProtFeatureRetriever(headers=headers, features=features)

        assert retriever.headers == headers
        assert retriever.features == features

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

    @patch("src.protspace.data.features.retrievers.uniprot_retriever.UniprotkbClient")
    def test_fetch_features_success(self, mock_client_class):
        """Test successful feature fetching with new unipressed implementation."""
        # Mock API response with minimal required fields
        mock_records = [
            {
                "primaryAccession": "P01308",
                "uniProtkbId": "INS_HUMAN",
                "sequence": {"value": "MALWMRLLPL", "length": 110, "molWeight": 11500},
                "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
                "proteinDescription": {
                    "recommendedName": {"fullName": {"value": "Insulin"}}
                },
                "genes": [{"geneName": {"value": "INS"}}],
                "entryType": "UniProtKB reviewed (Swiss-Prot)",
                "annotationScore": 5.0,
                "proteinExistence": "1: Evidence at protein level",
                "comments": [],
                "uniProtKBCrossReferences": [],
                "features": [],
                "keywords": [],
                "entryAudit": {},
            },
            {
                "primaryAccession": "P01315",
                "uniProtkbId": "INSL3_HUMAN",
                "sequence": {"value": "MAPRLCLLLL", "length": 142, "molWeight": 15000},
                "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
                "proteinDescription": {
                    "recommendedName": {"fullName": {"value": "Insulin-like 3"}}
                },
                "genes": [{"geneName": {"value": "INSL3"}}],
                "entryType": "UniProtKB reviewed (Swiss-Prot)",
                "annotationScore": 4.0,
                "proteinExistence": "1: Evidence at protein level",
                "comments": [],
                "uniProtKBCrossReferences": [],
                "features": [],
                "keywords": [],
                "entryAudit": {},
            },
        ]

        mock_client_class.fetch_many.return_value = mock_records

        # Create retriever and test
        headers = ["P01308", "P01315"]
        features = ["entry", "length", "organism_id"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)

        result = retriever.fetch_features()

        # Verify results
        assert len(result) == 2
        assert isinstance(result[0], ProteinFeatures)
        assert result[0].identifier == "P01308"
        assert result[0].features["length"] == "110"
        assert result[0].features["annotation_score"] == "5.0"
        assert result[0].features["reviewed"] == "True"

        assert result[1].identifier == "P01315"
        assert result[1].features["length"] == "142"
        assert result[1].features["annotation_score"] == "4.0"

        # Verify API call
        mock_client_class.fetch_many.assert_called_once_with(["P01308", "P01315"])

    @patch("src.protspace.data.features.retrievers.uniprot_retriever.UniprotkbClient")
    def test_fetch_features_batching_logic(self, mock_client_class):
        """Test feature fetching with batching behavior."""
        # Create mock records for batching test
        headers = [f"P{i:05d}" for i in range(150)]  # More than batch size (100)

        def mock_fetch_many(batch):
            """Mock fetch_many to return appropriate records for batch."""
            return [
                {
                    "primaryAccession": acc,
                    "uniProtkbId": f"{acc}_HUMAN",
                    "sequence": {"value": "MAL", "length": 100 + i, "molWeight": 10000},
                    "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
                    "proteinDescription": {
                        "recommendedName": {"fullName": {"value": f"Protein {i}"}}
                    },
                    "genes": [{"geneName": {"value": f"GENE{i}"}}],
                    "entryType": "UniProtKB reviewed (Swiss-Prot)",
                    "annotationScore": 5.0,
                    "proteinExistence": "1: Evidence at protein level",
                    "comments": [],
                    "uniProtKBCrossReferences": [],
                    "features": [],
                    "keywords": [],
                    "entryAudit": {},
                }
                for i, acc in enumerate(batch)
            ]

        mock_client_class.fetch_many.side_effect = mock_fetch_many

        # Create retriever and test
        features = ["entry", "length"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)

        result = retriever.fetch_features()

        # Verify results
        assert len(result) == 150
        # Verify API was called multiple times for batching
        assert mock_client_class.fetch_many.call_count == 2  # 100 + 50

    @patch("src.protspace.data.features.retrievers.uniprot_retriever.UniprotkbClient")
    def test_fetch_features_handles_errors(self, mock_client_class):
        """Test handling of API errors."""
        # Mock API to raise an exception
        mock_client_class.fetch_many.side_effect = Exception("API Error")

        # Create retriever and test
        headers = ["P01308"]
        features = ["entry", "length"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)

        result = retriever.fetch_features()

        # Should return result with empty features due to error handling
        assert len(result) == 1
        assert result[0].identifier == "P01308"
        # All features should be empty strings due to error
        assert all(v == "" for v in result[0].features.values())

    @patch("src.protspace.data.features.retrievers.uniprot_retriever.UniprotkbClient")
    def test_fetch_features_stores_uniprot_features(self, mock_client_class):
        """Test that fetch_features stores UNIPROT_FEATURES including organism_id."""
        mock_records = [
            {
                "primaryAccession": "P01308",
                "uniProtkbId": "INS_HUMAN",
                "sequence": {"value": "MALWMRLLPL", "length": 110, "molWeight": 11500},
                "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
                "proteinDescription": {
                    "recommendedName": {"fullName": {"value": "Insulin"}}
                },
                "genes": [{"geneName": {"value": "INS"}}],
                "entryType": "UniProtKB reviewed (Swiss-Prot)",
                "annotationScore": 5.0,
                "proteinExistence": "1: Evidence at protein level",
                "comments": [],
                "uniProtKBCrossReferences": [],
                "features": [],
                "keywords": [{"name": "Diabetes mellitus", "id": "KW-0001"}],
                "entryAudit": {
                    "firstPublicDate": "2020-01-01",
                    "lastAnnotationUpdateDate": "2023-01-01",
                },
            }
        ]

        mock_client_class.fetch_many.return_value = mock_records

        # Request features (actual storage is UNIPROT_FEATURES)
        headers = ["P01308"]
        features = ["entry", "length"]
        retriever = UniProtFeatureRetriever(headers=headers, features=features)

        result = retriever.fetch_features()

        # Should return exactly UNIPROT_FEATURES
        assert len(result) == 1
        assert len(result[0].features) == len(UNIPROT_FEATURES)

        # Check all UNIPROT_FEATURES are present
        for feature in UNIPROT_FEATURES:
            assert feature in result[0].features

        # Verify specific raw values
        assert result[0].features["length"] == "110"
        assert result[0].features["annotation_score"] == "5.0"
        assert result[0].features["organism_id"] == "9606"
        assert result[0].features["reviewed"] == "True"  # Bool stored as string


class TestConstants:
    """Test module constants."""

    def test_uniprot_features_constant(self):
        """Test that UNIPROT_FEATURES contains expected features including organism_id."""
        expected_features = [
            "protein_existence",
            "annotation_score",
            "protein_families",
            "length",
            "reviewed",
            "fragment",
            "cc_subcellular_location",
            "sequence",
            "xref_pdb",
            "organism_id",
        ]

        for feature in expected_features:
            assert feature in UNIPROT_FEATURES

        # Should have exactly 9 features
        assert len(UNIPROT_FEATURES) == 10

    def test_protein_features_namedtuple(self):
        """Test ProteinFeatures namedtuple structure."""
        features_dict = {"length": "110", "organism_id": "9606"}
        protein_features = ProteinFeatures(identifier="P01308", features=features_dict)

        assert protein_features.identifier == "P01308"
        assert protein_features.features == features_dict
        assert protein_features.features["length"] == "110"
        assert protein_features.features["organism_id"] == "9606"
