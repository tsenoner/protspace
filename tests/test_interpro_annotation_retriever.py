import json
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from src.protspace.data.annotations.retrievers.interpro_retriever import (
    CACHE_MAX_AGE_DAYS,
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

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_parse_interpro_results(self, mock_name_map):
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

        # Mock XML name map (won't override since matches API already provided names)
        mock_name_map.return_value = {"SSF": {"SSF12345": "Entry API name"}}

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert result[0].identifier == TEST_PROTEIN_ID
        assert result[0].annotations["pfam"] == "PF00001 (7tm_1)|50.2"
        assert "pfam_score" not in result[0].annotations
        # Matches API name takes precedence over XML name
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


def _make_name_map(**kwargs):
    """Helper to create a name map dict in the format returned by _get_member_db_name_map.

    Example::

        _make_name_map(
            SSF={"SSF53098": "Ribonuclease H-like"},
            CATHGENE3D={"G3DSA:1.10.10.10": "Winged helix"},
        )
    """
    base = {"SSF": {}, "CATHGENE3D": {}, "PANTHER": {}}
    base.update(kwargs)
    return base


class TestEntryNameResolution:
    """Test entry name resolution via InterPro XML-based name map."""

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_resolve_cath_names_success(self, mock_name_map):
        """Test successful CATH name resolution."""
        mock_name_map.return_value = _make_name_map(
            CATHGENE3D={"G3DSA:1.10.10.10": "Winged helix-like DNA-binding domain superfamily"}
        )

        retriever = InterProAnnotationRetriever(annotations=["cath"])
        result = retriever._resolve_entry_names({"G3DSA:1.10.10.10"}, "cath")

        assert result == {
            "G3DSA:1.10.10.10": "Winged helix-like DNA-binding domain superfamily"
        }

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_resolve_superfamily_names_success(self, mock_name_map):
        """Test successful SUPERFAMILY name resolution."""
        mock_name_map.return_value = _make_name_map(
            SSF={"SSF53098": "Ribonuclease H-like"}
        )

        retriever = InterProAnnotationRetriever(annotations=["superfamily"])
        result = retriever._resolve_entry_names({"SSF53098"}, "superfamily")

        assert result == {"SSF53098": "Ribonuclease H-like"}

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_resolve_entry_names_download_failure(self, mock_name_map):
        """Test graceful handling when name map returns empty (download failed)."""
        mock_name_map.return_value = {}

        retriever = InterProAnnotationRetriever(annotations=["cath"])
        result = retriever._resolve_entry_names({"G3DSA:1.10.10.10"}, "cath")

        assert result == {}

    def test_resolve_entry_names_empty_set(self):
        """Test with empty accession set."""
        retriever = InterProAnnotationRetriever(annotations=["cath"])
        result = retriever._resolve_entry_names(set(), "cath")

        assert result == {}

    def test_resolve_entry_names_unknown_annotation_key(self):
        """Test with an annotation key not in ENTRY_API_DB_MAPPING."""
        retriever = InterProAnnotationRetriever(annotations=["pfam"])
        result = retriever._resolve_entry_names({"PF00001"}, "pfam")

        assert result == {}

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_resolve_entry_names_multiple_accessions(self, mock_name_map):
        """Test resolving multiple accessions."""
        mock_name_map.return_value = _make_name_map(
            CATHGENE3D={
                "G3DSA:1.10.10.10": "Winged helix",
                "G3DSA:2.40.50.140": "OB fold",
            }
        )

        retriever = InterProAnnotationRetriever(annotations=["cath"])
        result = retriever._resolve_entry_names(
            {"G3DSA:1.10.10.10", "G3DSA:2.40.50.140"}, "cath"
        )

        assert result == {
            "G3DSA:1.10.10.10": "Winged helix",
            "G3DSA:2.40.50.140": "OB fold",
        }

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_resolve_entry_names_filters_to_requested_accessions(self, mock_name_map):
        """Test that only requested accessions are returned."""
        mock_name_map.return_value = _make_name_map(
            SSF={
                "SSF53098": "Ribonuclease H-like",
                "SSF50978": "WD40 repeat-like",
                "SSF99999": "Not requested",
            }
        )

        retriever = InterProAnnotationRetriever(annotations=["superfamily"])
        result = retriever._resolve_entry_names({"SSF53098"}, "superfamily")

        assert result == {"SSF53098": "Ribonuclease H-like"}
        assert "SSF50978" not in result
        assert "SSF99999" not in result

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_resolve_panther_names(self, mock_name_map):
        """Test PANTHER name resolution."""
        mock_name_map.return_value = _make_name_map(
            PANTHER={"PTHR11454": "Insulin"}
        )

        retriever = InterProAnnotationRetriever(annotations=["panther"])
        result = retriever._resolve_entry_names({"PTHR11454"}, "panther")

        assert result == {"PTHR11454": "Insulin"}


class TestParsingWithNameResolution:
    """Test that CATH and SUPERFAMILY names are injected into parsed results."""

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_parse_cath_with_resolved_names(self, mock_name_map):
        """Test that CATH annotations include resolved names."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["cath"]

        match1 = create_signature(
            "G3DSA:1.10.10.10", library="CATH-Gene3D", score=50.2
        )
        match2 = create_signature(
            "G3DSA:2.40.50.140", library="CATH-Gene3D", score=60.5
        )
        api_result = create_api_result(TEST_MD5, found=True, matches=[match1, match2])
        api_results = [api_result]

        mock_name_map.return_value = _make_name_map(
            CATHGENE3D={
                "G3DSA:1.10.10.10": "Winged helix",
                "G3DSA:2.40.50.140": "OB fold",
            }
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        cath_value = result[0].annotations["cath"]
        assert "G3DSA:1.10.10.10 (Winged helix)|50.2" in cath_value
        assert "G3DSA:2.40.50.140 (OB fold)|60.5" in cath_value

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_parse_superfamily_with_resolved_names(self, mock_name_map):
        """Test that SUPERFAMILY annotations include resolved names."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["superfamily"]

        match1 = create_signature(
            "SSF53098", library="SUPERFAMILY", score=1.5e-20
        )
        match2 = create_signature(
            "SSF50978", library="SUPERFAMILY", score=3.2e-15
        )
        api_result = create_api_result(TEST_MD5, found=True, matches=[match1, match2])
        api_results = [api_result]

        mock_name_map.return_value = _make_name_map(
            SSF={
                "SSF53098": "Ribonuclease H-like",
                "SSF50978": "WD40 repeat-like",
            }
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        sf_value = result[0].annotations["superfamily"]
        assert "SSF50978 (WD40 repeat-like)" in sf_value
        assert "SSF53098 (Ribonuclease H-like)" in sf_value

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_parse_cath_with_api_provided_name_takes_precedence(self, mock_name_map):
        """Test that names from the matches API take precedence over resolved names."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["cath"]

        # Match with a name already provided by the matches API
        match = create_signature(
            "G3DSA:1.10.10.10",
            name="API-provided name",
            library="CATH-Gene3D",
            score=50.2,
        )
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])
        api_results = [api_result]

        # The XML would return a different name, but shouldn't be used
        mock_name_map.return_value = _make_name_map(
            CATHGENE3D={"G3DSA:1.10.10.10": "XML name"}
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        # The matches API name should take precedence
        assert result[0].annotations["cath"] == "G3DSA:1.10.10.10 (API-provided name)|50.2"

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_parse_superfamily_with_api_provided_name_takes_precedence(self, mock_name_map):
        """Test that SUPERFAMILY names from matches API take precedence."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["superfamily"]

        match = create_signature(
            "SSF53098",
            name="Matches API name",
            library="SUPERFAMILY",
            score=1.5e-20,
        )
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])
        api_results = [api_result]

        mock_name_map.return_value = _make_name_map(
            SSF={"SSF53098": "XML name"}
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert result[0].annotations["superfamily"] == "SSF53098 (Matches API name)|1.5e-20"

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_parse_cath_partial_name_resolution(self, mock_name_map):
        """Test when only some CATH names can be resolved (accession not in XML)."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["cath"]

        match1 = create_signature(
            "G3DSA:1.10.10.10", library="CATH-Gene3D", score=50.2
        )
        match2 = create_signature(
            "G3DSA:9.99.99.99", library="CATH-Gene3D", score=60.5
        )
        api_result = create_api_result(TEST_MD5, found=True, matches=[match1, match2])
        api_results = [api_result]

        # Only G3DSA:1.10.10.10 appears in the XML
        mock_name_map.return_value = _make_name_map(
            CATHGENE3D={"G3DSA:1.10.10.10": "Winged helix"}
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        cath_value = result[0].annotations["cath"]
        # First one should have a name, second one should not
        assert "G3DSA:1.10.10.10 (Winged helix)|50.2" in cath_value
        assert "G3DSA:9.99.99.99|60.5" in cath_value

    def test_parse_no_resolution_when_not_requested(self):
        """Test that name resolution is skipped for databases not in ENTRY_API_DB_MAPPING."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["pfam"]

        match = create_signature("PF00001", name="7tm_1", score=50.2)
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])
        api_results = [api_result]

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert result[0].annotations["pfam"] == "PF00001 (7tm_1)|50.2"

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_parse_both_cath_and_superfamily_resolved(self, mock_name_map):
        """Test that both CATH and SUPERFAMILY names are resolved in a single parse."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["cath", "superfamily"]

        cath_match = create_signature(
            "G3DSA:1.10.10.10", library="CATH-Gene3D", score=50.2
        )
        sf_match = create_signature(
            "SSF53098", library="SUPERFAMILY", score=1.5e-20
        )
        api_result = create_api_result(
            TEST_MD5, found=True, matches=[cath_match, sf_match]
        )
        api_results = [api_result]

        mock_name_map.return_value = _make_name_map(
            CATHGENE3D={"G3DSA:1.10.10.10": "Winged helix"},
            SSF={"SSF53098": "Ribonuclease H-like"},
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results(api_results, md5_to_identifier)

        assert len(result) == 1
        assert "G3DSA:1.10.10.10 (Winged helix)|50.2" in result[0].annotations["cath"]
        assert (
            "SSF53098 (Ribonuclease H-like)|1.5e-20"
            in result[0].annotations["superfamily"]
        )


def test_interpro_annotations_constant():
    """Test that INTERPRO_ANNOTATIONS contains expected annotations."""
    expected_annotations = [
        "pfam",
        "superfamily",
        "cath",
        "signal_peptide",
        "smart",
        "cdd",
        "panther",
        "prosite",
        "prints",
    ]

    for annotation in expected_annotations:
        assert annotation in INTERPRO_ANNOTATIONS

    assert len(INTERPRO_ANNOTATIONS) == 9


class TestNewInterProDatabases:
    """Test retrieval of 7 new InterPro databases."""

    def test_smart_with_name_and_score(self):
        """Test SMART database: has names and scores from matches API."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["smart"]

        match = create_signature("SM00220", name="InsulinA", library="SMART", score=35.7)
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results([api_result], md5_to_identifier)

        assert len(result) == 1
        assert result[0].annotations["smart"] == "SM00220 (InsulinA)|35.7"

    def test_cdd_with_name_no_score(self):
        """Test CDD database: has names, no scores."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["cdd"]

        match = create_signature("cd00205", name="IGc2", library="CDD")
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results([api_result], md5_to_identifier)

        assert len(result) == 1
        assert result[0].annotations["cdd"] == "cd00205 (IGc2)"

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_panther_name_via_xml(self, mock_name_map):
        """Test PANTHER database: no names in matches API, resolved via XML."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["panther"]

        match = create_signature("PTHR11454", library="PANTHER", score=0.0)
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])

        mock_name_map.return_value = _make_name_map(
            PANTHER={"PTHR11454": "Insulin"}
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results([api_result], md5_to_identifier)

        assert len(result) == 1
        assert result[0].annotations["panther"] == "PTHR11454 (Insulin)|0.0"

    def test_prosite_with_name_no_score(self):
        """Test PROSITE database: has names, no scores."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["prosite"]

        match = create_signature(
            "PS00009", name="INSULIN", library="PROSITE patterns"
        )
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results([api_result], md5_to_identifier)

        assert len(result) == 1
        assert result[0].annotations["prosite"] == "PS00009 (INSULIN)"

    def test_prints_with_name_no_score(self):
        """Test PRINTS database: has names, no scores."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["prints"]

        match = create_signature("PR00276", name="INSULIN", library="PRINTS")
        api_result = create_api_result(TEST_MD5, found=True, matches=[match])

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results([api_result], md5_to_identifier)

        assert len(result) == 1
        assert result[0].annotations["prints"] == "PR00276 (INSULIN)"

    @patch.object(InterProRetriever, "_get_member_db_name_map")
    def test_multiple_new_databases_simultaneously(self, mock_name_map):
        """Test fetching multiple new databases in one parse call."""
        md5_to_identifier = {TEST_MD5: TEST_PROTEIN_ID}
        annotations = ["smart", "cdd", "panther", "prosite", "prints"]

        matches = [
            create_signature("SM00220", name="InsulinA", library="SMART", score=35.7),
            create_signature("cd00205", name="IGc2", library="CDD"),
            create_signature("PTHR11454", library="PANTHER", score=0.0),
            create_signature("PS00009", name="INSULIN", library="PROSITE patterns"),
            create_signature("PR00276", name="INSULIN", library="PRINTS"),
        ]
        api_result = create_api_result(TEST_MD5, found=True, matches=matches)

        # Mock XML name map (only panther is in ENTRY_API_DB_MAPPING)
        mock_name_map.return_value = _make_name_map(
            PANTHER={"PTHR11454": "Insulin"}
        )

        retriever = InterProAnnotationRetriever(annotations=annotations)
        result = retriever._parse_interpro_results([api_result], md5_to_identifier)

        assert len(result) == 1
        ann = result[0].annotations
        assert ann["smart"] == "SM00220 (InsulinA)|35.7"
        assert ann["cdd"] == "cd00205 (IGc2)"
        assert ann["panther"] == "PTHR11454 (Insulin)|0.0"
        assert ann["prosite"] == "PS00009 (INSULIN)"
        assert ann["prints"] == "PR00276 (INSULIN)"


class TestMemberDbNameMapCaching:
    """Test _get_member_db_name_map caching logic."""

    def _write_cache(self, cache_dir, name_map, age_days=0):
        """Write a cache file and timestamp."""
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / "member_db_names.json"
        timestamp_file = cache_dir / "member_db_names.timestamp"
        cache_file.write_text(json.dumps(name_map))
        ts = time.time() - (age_days * 86400)
        timestamp_file.write_text(str(ts))

    @patch("src.protspace.data.annotations.retrievers.interpro_retriever.INTERPRO_CACHE_DIR")
    def test_cache_hit_returns_cached_data(self, mock_cache_dir):
        """Test that fresh cache is used without downloading."""
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "interpro"
            mock_cache_dir.__truediv__ = cache_dir.__truediv__
            # Patch the module-level constant to point to our temp dir
            expected = _make_name_map(SSF={"SSF53098": "Ribonuclease H-like"})
            self._write_cache(cache_dir, expected, age_days=1)

            with patch(
                "src.protspace.data.annotations.retrievers.interpro_retriever.INTERPRO_CACHE_DIR",
                cache_dir,
            ):
                result = InterProRetriever._get_member_db_name_map()

            assert result == expected

    @patch("src.protspace.data.annotations.retrievers.interpro_retriever.requests.get")
    def test_cache_miss_triggers_download(self, mock_get):
        """Test that missing cache triggers download and parse."""
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "interpro"

            # Create a minimal gzipped XML to be returned by the mock
            xml_content = b"""\
<?xml version="1.0" encoding="UTF-8"?>
<interprodb>
  <interpro id="IPR000001" type="Domain">
    <name>Test domain</name>
    <db_xref db="SSF" dbkey="SSF53098" name=""/>
  </interpro>
</interprodb>"""
            import gzip as _gzip
            gz_data = _gzip.compress(xml_content)

            mock_resp = Mock()
            mock_resp.status_code = 200
            mock_resp.raise_for_status = Mock()
            mock_resp.iter_content = Mock(return_value=[gz_data])
            mock_get.return_value = mock_resp

            with patch(
                "src.protspace.data.annotations.retrievers.interpro_retriever.INTERPRO_CACHE_DIR",
                cache_dir,
            ):
                result = InterProRetriever._get_member_db_name_map()

            assert "SSF" in result
            assert result["SSF"]["SSF53098"] == "Test domain"
            # Cache files should be created
            assert (cache_dir / "member_db_names.json").exists()
            assert (cache_dir / "member_db_names.timestamp").exists()

    @patch("src.protspace.data.annotations.retrievers.interpro_retriever.requests.get")
    def test_download_failure_returns_empty(self, mock_get):
        """Test that download failure returns empty map when no cache exists."""
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "interpro"

            mock_get.side_effect = requests.exceptions.ConnectionError("No connection")

            with patch(
                "src.protspace.data.annotations.retrievers.interpro_retriever.INTERPRO_CACHE_DIR",
                cache_dir,
            ):
                result = InterProRetriever._get_member_db_name_map()

            assert result == {}

    @patch("src.protspace.data.annotations.retrievers.interpro_retriever.requests.get")
    def test_download_failure_falls_back_to_stale_cache(self, mock_get):
        """Test that download failure falls back to stale cache if available."""
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp) / "interpro"
            stale_data = _make_name_map(SSF={"SSF53098": "Stale name"})
            self._write_cache(cache_dir, stale_data, age_days=30)  # Very old cache

            mock_get.side_effect = requests.exceptions.ConnectionError("No connection")

            with patch(
                "src.protspace.data.annotations.retrievers.interpro_retriever.INTERPRO_CACHE_DIR",
                cache_dir,
            ):
                result = InterProRetriever._get_member_db_name_map()

            assert result == stale_data


class TestXmlParsing:
    """Test _parse_interpro_xml directly."""

    def _create_gz_xml(self, xml_bytes, tmp_dir):
        """Write XML content to a gzipped temp file."""
        import gzip as _gzip
        gz_path = os.path.join(tmp_dir, "interpro.xml.gz")
        with _gzip.open(gz_path, "wb") as f:
            f.write(xml_bytes)
        return gz_path

    def test_parse_extracts_member_db_names(self):
        """Test that XML parsing extracts correct member DB names."""
        xml = b"""\
<?xml version="1.0"?>
<interprodb>
  <interpro id="IPR000001" type="Domain">
    <name>Kringle</name>
    <db_xref db="SSF" dbkey="SSF57440" name="Kringle-like"/>
    <db_xref db="CATHGENE3D" dbkey="G3DSA:2.40.10.10" name=""/>
    <db_xref db="PANTHER" dbkey="PTHR11454" name="Insulin"/>
  </interpro>
  <interpro id="IPR000002" type="Family">
    <name>Cdc20/Fizzy</name>
    <db_xref db="SSF" dbkey="SSF50978" name=""/>
  </interpro>
</interprodb>"""
        with tempfile.TemporaryDirectory() as tmp:
            gz_path = self._create_gz_xml(xml, tmp)
            result = InterProRetriever._parse_interpro_xml(gz_path)

        assert result["SSF"]["SSF57440"] == "Kringle-like"
        # Empty xref name → falls back to parent InterPro entry name
        assert result["CATHGENE3D"]["G3DSA:2.40.10.10"] == "Kringle"
        assert result["PANTHER"]["PTHR11454"] == "Insulin"
        assert result["SSF"]["SSF50978"] == "Cdc20/Fizzy"

    def test_parse_skips_irrelevant_dbs(self):
        """Test that databases not in _XML_DBS_OF_INTEREST are skipped."""
        xml = b"""\
<?xml version="1.0"?>
<interprodb>
  <interpro id="IPR000001" type="Domain">
    <name>Test</name>
    <db_xref db="PFAM" dbkey="PF00001" name="7tm_1"/>
    <db_xref db="SSF" dbkey="SSF53098" name="RNase H"/>
  </interpro>
</interprodb>"""
        with tempfile.TemporaryDirectory() as tmp:
            gz_path = self._create_gz_xml(xml, tmp)
            result = InterProRetriever._parse_interpro_xml(gz_path)

        assert "SSF53098" in result["SSF"]
        # PFAM should not appear
        assert "PFAM" not in result

    def test_parse_empty_xml(self):
        """Test parsing an XML with no interpro elements."""
        xml = b"""\
<?xml version="1.0"?>
<interprodb>
</interprodb>"""
        with tempfile.TemporaryDirectory() as tmp:
            gz_path = self._create_gz_xml(xml, tmp)
            result = InterProRetriever._parse_interpro_xml(gz_path)

        assert all(len(v) == 0 for v in result.values())
