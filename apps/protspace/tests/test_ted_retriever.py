"""Tests for TED domain retriever."""

from unittest.mock import MagicMock, patch

import pytest

from src.protspace.data.annotations.retrievers.ted_retriever import (
    TED_ANNOTATIONS,
    TedRetriever,
)


def _make_alphafold_response(annotations):
    """Build a mock AlphaFold domains API response."""
    return {"total": len(annotations), "annotations": annotations}


def _make_domain(cath_label="2.60.40.720", plddt=95.1, start=109, end=287):
    return {
        "ted_domain_no": 1,
        "cath_label": cath_label,
        "plddt": plddt,
        "segments": [{"af_start": start, "af_end": end}],
    }


_REQUESTS_PATCH = "src.protspace.data.annotations.retrievers.ted_retriever.requests"
_CATH_NAMES_PATCH = (
    "src.protspace.data.annotations.retrievers.ted_retriever.get_cath_names"
)


class TestTedRetriever:
    """Unit tests with mocked AlphaFold API."""

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_single_domain(self, mock_requests, mock_cath_names):
        """Single domain with CATH name."""
        mock_cath_names.return_value = {"2.60.40.720": "Immunoglobulin-like"}
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("2.60.40.720", 95.1)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_requests.get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert len(result) == 1
        assert result[0].identifier == "P01308"
        assert (
            "2.60.40.720 (Immunoglobulin-like)|95.1"
            in result[0].annotations["ted_domains"]
        )

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_multiple_domains(self, mock_requests, mock_cath_names):
        """Protein with multiple domains."""
        mock_cath_names.return_value = {
            "2.60.40.720": "Immunoglobulin-like",
            "3.40.50.300": "P-loop NTPases",
        }
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [
                _make_domain("2.60.40.720", 95.1),
                _make_domain("3.40.50.300", 88.3, 300, 450),
            ]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_requests.get.return_value = mock_resp

        retriever = TedRetriever(headers=["P04637"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        ted_value = result[0].annotations["ted_domains"]
        assert "2.60.40.720 (Immunoglobulin-like)|95.1" in ted_value
        assert "3.40.50.300 (P-loop NTPases)|88.3" in ted_value
        assert ";" in ted_value

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_no_domains(self, mock_requests, mock_cath_names):
        """Protein with no domains returns empty string."""
        mock_cath_names.return_value = {}
        mock_resp = MagicMock()
        mock_resp.json.return_value = {}  # Empty response
        mock_resp.raise_for_status = MagicMock()
        mock_requests.get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == ""

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_unclassified_domain(self, mock_requests, mock_cath_names):
        """Domain with cath_label '-' shows as unclassified."""
        mock_cath_names.return_value = {}
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("-", 90.5)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_requests.get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert "unclassified|90.5" in result[0].annotations["ted_domains"]

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_api_error_returns_empty(self, mock_requests, mock_cath_names):
        """API error returns empty annotation."""
        mock_cath_names.return_value = {}
        mock_requests.get.side_effect = Exception("Connection error")

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == ""

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_cath_name_not_found(self, mock_requests, mock_cath_names):
        """CATH code without a name shows code only."""
        mock_cath_names.return_value = {}  # No names
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("3.40.50.2300", 96.8)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_requests.get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == "3.40.50.2300|96.8"

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_partial_cath_code(self, mock_requests, mock_cath_names):
        """Partial CATH code (3 numbers) resolves directly from CATH names."""
        mock_cath_names.return_value = {
            "2.60.40": "Immunoglobulin-like",
            "2.60.40.720": "Immunoglobulins",
        }
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("2.60.40", 91.0)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_requests.get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert (
            "2.60.40 (Immunoglobulin-like)|91.0" in result[0].annotations["ted_domains"]
        )


class TestTedConstants:
    def test_ted_annotations(self):
        assert TED_ANNOTATIONS == ["ted_domains"]
