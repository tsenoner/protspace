from unittest.mock import Mock, patch

from src.protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
    InterProRetriever,
)

# Alias for test compatibility
InterProAnnotationRetriever = InterProRetriever


class TestInterProAnnotationRetrieverInit:
    """Test InterProAnnotationRetriever initialization."""

    def test_init_with_headers_and_annotations(self):
        """Test initialization with headers and annotations."""
        headers = ["sp|P12345|PROTEIN_MOUSE", "tr|Q67890|PROTEIN_HUMAN"]
        annotations = ["pfam", "superfamily"]
        sequences = {"P12345": "MKLLLLLLLL", "Q67890": "MVKLLLLLL"}

        retriever = InterProAnnotationRetriever(
            headers=headers, annotations=annotations, sequences=sequences
        )

        assert retriever.headers == ["P12345", "Q67890"]
        assert retriever.annotations == annotations
        assert retriever.sequences == sequences

    def test_init_default_annotations(self):
        """Test initialization with default annotations."""
        headers = ["P12345"]
        sequences = {"P12345": "MKLLLLLLLL"}

        retriever = InterProAnnotationRetriever(headers=headers, sequences=sequences)

        assert retriever.annotations == INTERPRO_ANNOTATIONS

    def test_init_invalid_annotations(self):
        """Test initialization with invalid annotations."""
        headers = ["P12345"]
        annotations = ["pfam", "invalid_annotation", "superfamily"]
        sequences = {"P12345": "MKLLLLLLLL"}

        retriever = InterProAnnotationRetriever(
            headers=headers, annotations=annotations, sequences=sequences
        )

        # Should filter out invalid annotations
        assert "invalid_annotation" not in retriever.annotations
        assert "pfam" in retriever.annotations
        assert "superfamily" in retriever.annotations

    def test_manage_headers_uniprot(self):
        """Test header management for UniProt headers."""
        headers = ["sp|P12345|PROTEIN_MOUSE", "tr|Q67890|PROTEIN_HUMAN"]

        retriever = InterProAnnotationRetriever()
        managed = retriever._manage_headers(headers)

        assert managed == ["P12345", "Q67890"]

    def test_manage_headers_other(self):
        """Test header management for other header formats."""
        headers = ["generic|PROTEIN1|extra", "simple_header"]

        retriever = InterProAnnotationRetriever()
        managed = retriever._manage_headers(headers)

        assert managed == ["PROTEIN1", "simple_header"]


class TestInterProAnnotationRetrieverFetch:
    """Test InterProAnnotationRetriever fetch_annotations method."""

    @patch("src.protspace.data.annotations.retrievers.interpro_retriever.requests.post")
    def test_fetch_annotations_success(self, mock_post):
        """Test successful annotation fetching."""
        headers = ["P12345"]
        annotations = ["pfam"]
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
                                "signatureLibraryRelease": {"library": "Pfam"},
                            },
                            "score": 50.2,
                        }
                    ],
                }
            ]
        }
        mock_post.return_value = mock_response

        retriever = InterProAnnotationRetriever(
            headers=headers, annotations=annotations, sequences=sequences
        )

        # Override MD5 calculation for predictable test
        with patch(
            "src.protspace.data.annotations.retrievers.interpro_retriever.hashlib.md5"
        ) as mock_md5:
            mock_md5.return_value.hexdigest.return_value = (
                "5D41402ABC4B2A76B9719D911017C592"
            )

            result = retriever.fetch_annotations()

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert "pfam" in result[0].annotations
        assert result[0].annotations["pfam"] == "PF00001|50.2"
        assert "pfam_score" not in result[0].annotations

    def test_fetch_annotations_no_headers(self):
        """Test fetch_annotations with no headers."""
        retriever = InterProAnnotationRetriever(
            headers=[], annotations=["pfam"], sequences={}
        )

        result = retriever.fetch_annotations()

        assert result == []

    def test_fetch_annotations_no_sequences(self):
        """Test fetch_annotations with no sequences."""
        retriever = InterProAnnotationRetriever(
            headers=["P12345"], annotations=["pfam"], sequences={}
        )

        result = retriever.fetch_annotations()

        assert result == []

    def test_fetch_annotations_missing_sequences(self):
        """Test fetch_annotations with missing sequences for some headers."""
        headers = ["P12345", "Q67890"]
        sequences = {"P12345": "MKLLLLLLLL"}  # Missing Q67890

        retriever = InterProAnnotationRetriever(
            headers=headers, annotations=["pfam"], sequences=sequences
        )

        with patch.object(retriever, "_get_matches_in_batches") as mock_get_matches:
            mock_get_matches.return_value = []

            retriever.fetch_annotations()

            # Should only process P12345, not Q67890
            mock_get_matches.assert_called_once()
            called_md5s = mock_get_matches.call_args[0][0]
            assert len(called_md5s) == 1


class TestInterProAnnotationRetrieverParsing:
    """Test InterPro result parsing methods."""

    def test_parse_interpro_results(self):
        """Test parsing of InterPro API results."""
        md5_to_identifier = {"ABC123": "P12345"}
        annotations = ["pfam", "superfamily"]

        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "evalue": "1e-10",
                        "score": 50.2,
                    },
                    {
                        "signature": {
                            "accession": "SSF12345",
                            "signatureLibraryRelease": {"library": "SUPERFAMILY"},
                        },
                        "evalue": "1e-15",
                        "score": 60.5,
                    },
                ],
            }
        ]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert result[0].annotations["pfam"] == "PF00001|50.2"
        assert "pfam_score" not in result[0].annotations
        assert result[0].annotations["superfamily"] == "SSF12345|60.5"
        assert "superfamily_score" not in result[0].annotations

    def test_parse_interpro_results_not_found(self):
        """Test parsing when protein not found in UniParc."""
        md5_to_identifier = {"ABC123": "P12345"}
        annotations = ["pfam"]

        api_results = [{"md5": "ABC123", "found": False, "matches": []}]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert result[0].annotations["pfam"] == ""  # Empty when not found
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_filter_databases(self):
        """Test that only requested databases are included."""
        md5_to_identifier = {"ABC123": "P12345"}
        annotations = ["pfam"]  # Only requesting Pfam

        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "evalue": "1e-10",
                        "score": 50.2,
                    },
                    {
                        "signature": {
                            "accession": "SSF12345",
                            "signatureLibraryRelease": {"library": "SUPERFAMILY"},
                        },
                        "evalue": "1e-15",
                        "score": 60.5,
                    },
                ],
            }
        ]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        assert result[0].annotations["pfam"] == "PF00001|50.2"
        assert "pfam_score" not in result[0].annotations
        # SUPERFAMILY should not be included since not requested
        assert "superfamily" not in result[0].annotations
        assert "superfamily_score" not in result[0].annotations

    def test_parse_interpro_results_missing_confidence_scores(self):
        """Test parsing when confidence scores are missing (None)."""
        md5_to_identifier = {"ABC123": "P12345"}
        annotations = ["pfam"]

        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        # Missing score field
                    }
                ],
            }
        ]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        # Should handle missing confidence scores gracefully (no scores, just accession)
        assert result[0].annotations["pfam"] == "PF00001"
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_duplicate_accessions(self):
        """Test that duplicate accessions collect all scores."""
        md5_to_identifier = {"ABC123": "P12345"}
        annotations = ["pfam"]

        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 50.2,
                    },
                    {
                        "signature": {
                            "accession": "PF00001",  # Duplicate
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 60.5,  # Different score
                    },
                ],
            }
        ]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        # Should collect all scores for the same accession
        assert result[0].annotations["pfam"] == "PF00001|50.2,60.5"
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_multidomain(self):
        """Test parsing of multidomain proteins (multiple different accessions)."""
        md5_to_identifier = {"ABC123": "P12345"}
        annotations = ["pfam"]

        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 50.2,
                    },
                    {
                        "signature": {
                            "accession": "PF00002",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 60.5,
                    },
                    {
                        "signature": {
                            "accession": "PF00003",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 45.8,
                    },
                ],
            }
        ]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        # Should format multiple domains with semicolons, sorted by accession
        assert result[0].annotations["pfam"] == "PF00001|50.2;PF00002|60.5;PF00003|45.8"
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_multidomain_with_duplicates(self):
        """Test multidomain proteins with some domains appearing multiple times."""
        md5_to_identifier = {"ABC123": "P12345"}
        annotations = ["pfam"]

        api_results = [
            {
                "md5": "ABC123",
                "found": True,
                "matches": [
                    {
                        "signature": {
                            "accession": "PF00001",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 50.2,
                    },
                    {
                        "signature": {
                            "accession": "PF00001",  # Duplicate
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 52.1,
                    },
                    {
                        "signature": {
                            "accession": "PF00002",
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 60.5,
                    },
                    {
                        "signature": {
                            "accession": "PF00001",  # Another duplicate
                            "signatureLibraryRelease": {"library": "Pfam"},
                        },
                        "score": 51.0,
                    },
                ],
            }
        ]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == "P12345"
        # Should collect all scores for PF00001, and include PF00002
        # Sorted by accession, so PF00001 comes first
        assert result[0].annotations["pfam"] == "PF00001|50.2,52.1,51.0;PF00002|60.5"
        assert "pfam_score" not in result[0].annotations


def test_interpro_annotations_constant():
    """Test that INTERPRO_ANNOTATIONS contains expected annotations."""
    expected_annotations = ["pfam", "superfamily", "cath", "signal_peptide"]

    for annotation in expected_annotations:
        assert annotation in INTERPRO_ANNOTATIONS
