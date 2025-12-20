from unittest.mock import Mock, patch

from src.protspace.data.annotations.retrievers.interpro_retriever import (
    INTERPRO_ANNOTATIONS,
    InterProRetriever,
)

# Alias for test compatibility
InterProAnnotationRetriever = InterProRetriever

# Test data constants
TEST_MD5 = "ABC123"
TEST_MD5_HELLO = "5D41402ABC4B2A76B9719D911017C592"  # MD5 of "hello"
TEST_PROTEIN_ID = "P12345"
TEST_PROTEIN_ID_2 = "Q67890"
TEST_SEQUENCE = "MKLLLLLLLL"
TEST_SEQUENCE_2 = "MVKLLLLLL"

# Common test signatures
PFAM_SIGNATURE_1 = {
    "accession": "PF00001",
    "name": "7tm_1",
    "signatureLibraryRelease": {"library": "Pfam"},
}
PFAM_SIGNATURE_2 = {
    "accession": "PF00002",
    "name": "7tm_2",
    "signatureLibraryRelease": {"library": "Pfam"},
}
PFAM_SIGNATURE_3 = {
    "accession": "PF00003",
    "name": "7tm_3",
    "signatureLibraryRelease": {"library": "Pfam"},
}
SUPERFAMILY_SIGNATURE_1 = {
    "accession": "SSF12345",
    "name": "7 transmembrane receptor",
    "signatureLibraryRelease": {"library": "SUPERFAMILY"},
}


def create_signature(accession, name=None, library="Pfam", score=None):
    """Create a signature match object for testing."""
    signature = {
        "accession": accession,
        "signatureLibraryRelease": {"library": library},
    }
    if name is not None:
        signature["name"] = name
    match = {"signature": signature}
    if score is not None:
        match["score"] = score
    return match


def create_api_result(md5, found=True, matches=None):
    """Create an API result object for testing."""
    return {
        "md5": md5,
        "found": found,
        "matches": matches or [],
    }


def create_api_response(results):
    """Create a full API response for testing."""
    return {"results": results}


class TestInterProAnnotationRetrieverInit:
    """Test InterProAnnotationRetriever initialization."""

    def test_init_with_headers_and_annotations(self):
        """Test initialization with headers and annotations."""
        headers = [
            f"sp|{TEST_PROTEIN_ID}|PROTEIN_MOUSE",
            f"tr|{TEST_PROTEIN_ID_2}|PROTEIN_HUMAN",
        ]
        annotations = ["pfam", "superfamily"]
        sequences = {TEST_PROTEIN_ID: TEST_SEQUENCE, TEST_PROTEIN_ID_2: TEST_SEQUENCE_2}

        retriever = InterProAnnotationRetriever(
            headers=headers, annotations=annotations, sequences=sequences
        )

        assert retriever.headers == [TEST_PROTEIN_ID, TEST_PROTEIN_ID_2]
        assert retriever.annotations == annotations
        assert retriever.sequences == sequences

    def test_init_default_annotations(self):
        """Test initialization with default annotations."""
        headers = [TEST_PROTEIN_ID]
        sequences = {TEST_PROTEIN_ID: TEST_SEQUENCE}

        retriever = InterProAnnotationRetriever(headers=headers, sequences=sequences)

        assert retriever.annotations == INTERPRO_ANNOTATIONS

    def test_init_invalid_annotations(self):
        """Test initialization with invalid annotations."""
        headers = [TEST_PROTEIN_ID]
        annotations = ["pfam", "invalid_annotation", "superfamily"]
        sequences = {TEST_PROTEIN_ID: TEST_SEQUENCE}

        retriever = InterProAnnotationRetriever(
            headers=headers, annotations=annotations, sequences=sequences
        )

        # Should filter out invalid annotations
        assert "invalid_annotation" not in retriever.annotations
        assert "pfam" in retriever.annotations
        assert "superfamily" in retriever.annotations

    def test_manage_headers_uniprot(self):
        """Test header management for UniProt headers."""
        headers = [
            f"sp|{TEST_PROTEIN_ID}|PROTEIN_MOUSE",
            f"tr|{TEST_PROTEIN_ID_2}|PROTEIN_HUMAN",
        ]

        retriever = InterProAnnotationRetriever()
        managed = retriever._manage_headers(headers)

        assert managed == [TEST_PROTEIN_ID, TEST_PROTEIN_ID_2]

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
        headers = [TEST_PROTEIN_ID]
        annotations = ["pfam"]
        sequences = {TEST_PROTEIN_ID: TEST_SEQUENCE}

        # Mock API response
        match = create_signature("PF00001", name="7tm_1", score=50.2)
        api_result = create_api_result(TEST_MD5_HELLO, found=True, matches=[match])
        api_response = create_api_response([api_result])

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = api_response
        mock_post.return_value = mock_response

        retriever = InterProAnnotationRetriever(
            headers=headers, annotations=annotations, sequences=sequences
        )

        # Override MD5 calculation for predictable test
        with patch(
            "src.protspace.data.annotations.retrievers.interpro_retriever.hashlib.md5"
        ) as mock_md5:
            mock_md5.return_value.hexdigest.return_value = TEST_MD5_HELLO

            result = retriever.fetch_annotations()

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        assert "pfam" in result[0].annotations
        assert result[0].annotations["pfam"] == "PF00001 (7tm_1)|50.2"
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
            headers=[TEST_PROTEIN_ID], annotations=["pfam"], sequences={}
        )

        result = retriever.fetch_annotations()

        assert result == []

    def test_fetch_annotations_missing_sequences(self):
        """Test fetch_annotations with missing sequences for some headers."""
        headers = [TEST_PROTEIN_ID, TEST_PROTEIN_ID_2]
        sequences = {TEST_PROTEIN_ID: TEST_SEQUENCE}  # Missing Q67890

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
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam", "superfamily"]

        match1 = create_signature("PF00001", name="7tm_1", score=50.2)
        match2 = create_signature(
            "SSF12345",
            name="7 transmembrane receptor",
            library="SUPERFAMILY",
            score=60.5,
        )
        api_result = create_api_result(TEST_MD5, found=True, matches=[match1, match2])
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        assert result[0].annotations["pfam"] == "PF00001 (7tm_1)|50.2"
        assert "pfam_score" not in result[0].annotations
        assert (
            result[0].annotations["superfamily"]
            == "SSF12345 (7 transmembrane receptor)|60.5"
        )
        assert "superfamily_score" not in result[0].annotations

    def test_parse_interpro_results_not_found(self):
        """Test parsing when protein not found in UniParc."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]

        api_result = create_api_result(TEST_MD5, found=False)
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        assert result[0].annotations["pfam"] == ""  # Empty when not found
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_filter_databases(self):
        """Test that only requested databases are included."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]  # Only requesting Pfam

        match1 = create_signature("PF00001", name="7tm_1", score=50.2)
        match2 = create_signature("SSF12345", library="SUPERFAMILY", score=60.5)
        api_result = create_api_result(TEST_MD5, found=True, matches=[match1, match2])
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        assert result[0].annotations["pfam"] == "PF00001 (7tm_1)|50.2"
        assert "pfam_score" not in result[0].annotations
        # SUPERFAMILY should not be included since not requested
        assert "superfamily" not in result[0].annotations
        assert "superfamily_score" not in result[0].annotations

    def test_parse_interpro_results_missing_confidence_scores(self):
        """Test parsing when confidence scores are missing (None)."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]

        # Create match without score
        match = create_signature("PF00001", name="7tm_1")
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        # Should handle missing confidence scores gracefully (no scores, just accession with name)
        assert result[0].annotations["pfam"] == "PF00001 (7tm_1)"
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_duplicate_accessions(self):
        """Test that duplicate accessions collect all scores."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]

        match1 = create_signature("PF00001", name="7tm_1", score=50.2)
        match2 = create_signature("PF00001", score=60.5)  # Duplicate, no name
        api_result = create_api_result(TEST_MD5, found=True, matches=[match1, match2])
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        # Should collect all scores for the same accession, use name from first occurrence
        assert result[0].annotations["pfam"] == "PF00001 (7tm_1)|50.2,60.5"
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_multidomain(self):
        """Test parsing of multidomain proteins (multiple different accessions)."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]

        match1 = create_signature("PF00001", name="7tm_1", score=50.2)
        match2 = create_signature("PF00002", name="7tm_2", score=60.5)
        match3 = create_signature("PF00003", name="7tm_3", score=45.8)
        api_result = create_api_result(
            TEST_MD5, found=True, matches=[match1, match2, match3]
        )
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        # Should format multiple domains with semicolons, sorted by accession
        assert (
            result[0].annotations["pfam"]
            == "PF00001 (7tm_1)|50.2;PF00002 (7tm_2)|60.5;PF00003 (7tm_3)|45.8"
        )
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_multidomain_with_duplicates(self):
        """Test multidomain proteins with some domains appearing multiple times."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]

        match1 = create_signature("PF00001", name="7tm_1", score=50.2)
        match2 = create_signature("PF00001", score=52.1)  # Duplicate
        match3 = create_signature("PF00002", name="7tm_2", score=60.5)
        match4 = create_signature("PF00001", score=51.0)  # Another duplicate
        api_result = create_api_result(
            TEST_MD5, found=True, matches=[match1, match2, match3, match4]
        )
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        # Should collect all scores for PF00001, and include PF00002
        # Sorted by accession, so PF00001 comes first
        # Name from first occurrence is used
        assert (
            result[0].annotations["pfam"]
            == "PF00001 (7tm_1)|50.2,52.1,51.0;PF00002 (7tm_2)|60.5"
        )
        assert "pfam_score" not in result[0].annotations

    def test_parse_interpro_results_missing_name(self):
        """Test parsing when name is missing (should work without name)."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]

        # Create match without name
        match = create_signature("PF00001", score=50.2)
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        # Should work without name, just accession
        assert result[0].annotations["pfam"] == "PF00001|50.2"
        assert "pfam_score" not in result[0].annotations


def test_interpro_annotations_constant():
    """Test that INTERPRO_ANNOTATIONS contains expected annotations."""
    expected_annotations = ["pfam", "superfamily", "cath", "signal_peptide"]

    for annotation in expected_annotations:
        assert annotation in INTERPRO_ANNOTATIONS
