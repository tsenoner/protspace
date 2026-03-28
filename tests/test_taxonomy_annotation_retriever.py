"""Tests for taxonomy annotation retriever.

Unit tests mock the UniProt Taxonomy API. Integration tests hit the real API.
"""

from unittest.mock import patch

import pytest

from src.protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
    TaxonomyRetriever,
)

# Alias for test compatibility
TaxonomyAnnotationRetriever = TaxonomyRetriever


def _make_api_response(entries):
    """Build a mock UniProt Taxonomy API response."""

    class MockResponse:
        status_code = 200
        headers = {}

        def json(self):
            return {"results": entries}

        def raise_for_status(self):
            pass

    return MockResponse()


def _make_entry(taxon_id, name, rank, lineage):
    """Build a single taxonomy entry matching UniProt API format."""
    return {
        "taxonId": taxon_id,
        "scientificName": name,
        "rank": rank,
        "lineage": lineage,
    }


# --- Mock data for common organisms ---

ECOLI_LINEAGE = [
    {
        "scientificName": "cellular organisms",
        "taxonId": 131567,
        "rank": "no rank",
        "hidden": False,
    },
    {"scientificName": "Bacteria", "taxonId": 2, "rank": "domain", "hidden": False},
    {
        "scientificName": "Pseudomonadati",
        "taxonId": 1783270,
        "rank": "kingdom",
        "hidden": False,
    },
    {
        "scientificName": "Pseudomonadota",
        "taxonId": 1224,
        "rank": "phylum",
        "hidden": False,
    },
    {
        "scientificName": "Gammaproteobacteria",
        "taxonId": 1236,
        "rank": "class",
        "hidden": False,
    },
    {
        "scientificName": "Enterobacterales",
        "taxonId": 91347,
        "rank": "order",
        "hidden": False,
    },
    {
        "scientificName": "Enterobacteriaceae",
        "taxonId": 543,
        "rank": "family",
        "hidden": False,
    },
    {"scientificName": "Escherichia", "taxonId": 561, "rank": "genus", "hidden": False},
    {
        "scientificName": "Escherichia coli",
        "taxonId": 562,
        "rank": "species",
        "hidden": True,
    },
]

HUMAN_LINEAGE = [
    {
        "scientificName": "cellular organisms",
        "taxonId": 131567,
        "rank": "no rank",
        "hidden": False,
    },
    {"scientificName": "Eukaryota", "taxonId": 2759, "rank": "domain", "hidden": False},
    {"scientificName": "Metazoa", "taxonId": 33208, "rank": "kingdom", "hidden": False},
    {"scientificName": "Chordata", "taxonId": 7711, "rank": "phylum", "hidden": False},
    {"scientificName": "Mammalia", "taxonId": 40674, "rank": "class", "hidden": False},
    {"scientificName": "Primates", "taxonId": 9443, "rank": "order", "hidden": False},
    {"scientificName": "Hominidae", "taxonId": 9604, "rank": "family", "hidden": False},
    {"scientificName": "Homo", "taxonId": 9605, "rank": "genus", "hidden": False},
]

SARSCOV2_LINEAGE = [
    {"scientificName": "Viruses", "taxonId": 10239, "rank": "no rank", "hidden": False},
    {
        "scientificName": "Riboviria",
        "taxonId": 2559587,
        "rank": "realm",
        "hidden": False,
    },
    {
        "scientificName": "Orthornavirae",
        "taxonId": 2732396,
        "rank": "kingdom",
        "hidden": False,
    },
    {
        "scientificName": "Pisuviricota",
        "taxonId": 2732408,
        "rank": "phylum",
        "hidden": False,
    },
    {
        "scientificName": "Pisoniviricetes",
        "taxonId": 2732506,
        "rank": "class",
        "hidden": False,
    },
    {
        "scientificName": "Nidovirales",
        "taxonId": 76804,
        "rank": "order",
        "hidden": False,
    },
    {
        "scientificName": "Coronaviridae",
        "taxonId": 11118,
        "rank": "family",
        "hidden": False,
    },
    {
        "scientificName": "Betacoronavirus",
        "taxonId": 694002,
        "rank": "genus",
        "hidden": False,
    },
    {
        "scientificName": "Betacoronavirus pandemicum",
        "taxonId": 3050291,
        "rank": "species",
        "hidden": False,
    },
]


class TestTaxonomyConstants:
    """Test constants and validation (no API needed)."""

    def test_constants(self):
        """Verify TAXONOMY_ANNOTATIONS constant."""
        expected = [
            "root",
            "domain",
            "kingdom",
            "phylum",
            "class",
            "order",
            "family",
            "genus",
            "species",
        ]
        assert TAXONOMY_ANNOTATIONS == expected

    def test_invalid_taxon_ids(self):
        """Test that invalid taxon IDs raise ValueError."""
        with pytest.raises(ValueError, match="not an integer"):
            TaxonomyAnnotationRetriever(taxon_ids=[9606, "invalid"])


class TestTaxonomyRetrieverMocked:
    """Unit tests with mocked UniProt Taxonomy API."""

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_bacteria_taxonomy(self, mock_get):
        """Test bacterial taxonomy (E. coli K-12)."""
        mock_get.return_value = _make_api_response(
            [
                _make_entry(
                    511145,
                    "Escherichia coli str. K-12 substr. MG1655",
                    "no rank",
                    ECOLI_LINEAGE,
                ),
            ]
        )

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[511145], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[511145]["annotations"]
        assert annotations["root"] == "cellular organisms"
        assert annotations["domain"] == "Bacteria"
        assert annotations["kingdom"] == "Pseudomonadati"
        assert annotations["phylum"] == "Pseudomonadota"
        assert annotations["class"] == "Gammaproteobacteria"
        assert annotations["genus"] == "Escherichia"
        assert annotations["species"] == "Escherichia coli"

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_human_species_from_own_rank(self, mock_get):
        """Test that species-rank taxon IDs get species from entry's own name."""
        mock_get.return_value = _make_api_response(
            [
                _make_entry(9606, "Homo sapiens", "species", HUMAN_LINEAGE),
            ]
        )

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[9606], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[9606]["annotations"]
        assert annotations["domain"] == "Eukaryota"
        assert annotations["kingdom"] == "Metazoa"
        assert annotations["genus"] == "Homo"
        assert annotations["species"] == "Homo sapiens"

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_virus_realm_as_domain(self, mock_get):
        """Test viral taxonomy — realm used as domain fallback."""
        mock_get.return_value = _make_api_response(
            [
                _make_entry(
                    2697049,
                    "Severe acute respiratory syndrome coronavirus 2",
                    "no rank",
                    SARSCOV2_LINEAGE,
                ),
            ]
        )

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[2697049], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[2697049]["annotations"]
        assert annotations["root"] == "Viruses"
        assert annotations["domain"] == "Riboviria"  # realm fallback
        assert annotations["kingdom"] == "Orthornavirae"
        assert annotations["family"] == "Coronaviridae"

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_batch_retrieval(self, mock_get):
        """Test batch retrieval of multiple organisms in one call."""
        mock_get.return_value = _make_api_response(
            [
                _make_entry(511145, "E. coli K-12", "no rank", ECOLI_LINEAGE),
                _make_entry(9606, "Homo sapiens", "species", HUMAN_LINEAGE),
                _make_entry(2697049, "SARS-CoV-2", "no rank", SARSCOV2_LINEAGE),
            ]
        )

        taxon_ids = [511145, 9606, 2697049]
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=taxon_ids, annotations=["domain", "species"]
        )
        result = retriever.fetch_annotations()

        assert len(result) == 3
        assert result[511145]["annotations"]["domain"] == "Bacteria"
        assert result[9606]["annotations"]["domain"] == "Eukaryota"
        assert result[2697049]["annotations"]["domain"] == "Riboviria"

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_partial_annotations(self, mock_get):
        """Test requesting only a subset of annotations."""
        mock_get.return_value = _make_api_response(
            [
                _make_entry(9606, "Homo sapiens", "species", HUMAN_LINEAGE),
            ]
        )

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[9606], annotations=["domain", "genus", "species"]
        )
        result = retriever.fetch_annotations()

        annotations = result[9606]["annotations"]
        assert len(annotations) == 3
        assert annotations["domain"] == "Eukaryota"
        assert annotations["genus"] == "Homo"
        assert annotations["species"] == "Homo sapiens"

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_invalid_taxon_returns_empty(self, mock_get):
        """Test graceful handling of IDs not found in API response."""
        mock_get.return_value = _make_api_response([])  # No results

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[99999999], annotations=["genus", "species"]
        )
        result = retriever.fetch_annotations()

        annotations = result[99999999]["annotations"]
        assert annotations["genus"] == ""
        assert annotations["species"] == ""

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_api_error_returns_empty(self, mock_get):
        """Test graceful handling of API errors."""
        mock_get.side_effect = Exception("Connection failed")

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[9606], annotations=["domain", "genus"]
        )
        result = retriever.fetch_annotations()

        annotations = result[9606]["annotations"]
        assert annotations["domain"] == ""
        assert annotations["genus"] == ""

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_missing_ranks_return_empty_strings(self, mock_get):
        """Test that missing taxonomy ranks return empty strings."""
        sparse_lineage = [
            {
                "scientificName": "Viruses",
                "taxonId": 10239,
                "rank": "no rank",
                "hidden": False,
            },
            {
                "scientificName": "Duplodnaviria",
                "taxonId": 2731341,
                "rank": "realm",
                "hidden": False,
            },
            {
                "scientificName": "Lambdavirus",
                "taxonId": 129067,
                "rank": "genus",
                "hidden": False,
            },
        ]
        mock_get.return_value = _make_api_response(
            [
                _make_entry(10710, "Bacteriophage lambda", "species", sparse_lineage),
            ]
        )

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[10710], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[10710]["annotations"]
        assert annotations["domain"] == "Duplodnaviria"  # realm fallback
        assert annotations["genus"] == "Lambdavirus"
        assert annotations["kingdom"] == ""
        assert annotations["phylum"] == ""
        assert annotations["order"] == ""
        assert annotations["family"] == ""

    @patch("protspace.data.annotations.retrievers.taxonomy_retriever.requests.get")
    def test_batch_chunking(self, mock_get):
        """Test that large ID lists are split into batches."""
        # Create 150 IDs to force 2 batches (batch size = 100)
        taxon_ids = list(range(1, 151))

        mock_get.return_value = _make_api_response([])

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=taxon_ids, annotations=["domain"]
        )
        retriever.fetch_annotations()

        # Should have been called twice (100 + 50)
        assert mock_get.call_count == 2


@pytest.mark.slow
@pytest.mark.integration
class TestTaxonomyRetrieverIntegration:
    """Integration tests hitting the real UniProt Taxonomy API."""

    def test_bacteria_taxonomy(self):
        """Test bacterial taxonomy (E. coli)."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[511145], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[511145]["annotations"]
        assert annotations["root"] == "cellular organisms"
        assert annotations["domain"] == "Bacteria"
        assert annotations["genus"] == "Escherichia"
        assert annotations["species"] == "Escherichia coli"

    def test_human_species(self):
        """Test species-rank taxon (Human)."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[9606], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[9606]["annotations"]
        assert annotations["species"] == "Homo sapiens"
        assert annotations["genus"] == "Homo"

    def test_virus_taxonomy(self):
        """Test viral taxonomy with realm fallback."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[2697049], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[2697049]["annotations"]
        assert annotations["root"] == "Viruses"
        assert annotations["domain"] == "Riboviria"
        assert annotations["family"] == "Coronaviridae"

    def test_diverse_batch(self):
        """Test batch retrieval across all domains of life."""
        taxon_ids = [511145, 9606, 2697049, 3702, 559292]
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=taxon_ids, annotations=["domain", "kingdom"]
        )
        result = retriever.fetch_annotations()

        assert len(result) == 5
        assert result[511145]["annotations"]["domain"] == "Bacteria"
        assert result[9606]["annotations"]["domain"] == "Eukaryota"
        assert result[2697049]["annotations"]["domain"] == "Riboviria"
        assert result[3702]["annotations"]["kingdom"] == "Viridiplantae"
        assert result[559292]["annotations"]["kingdom"] == "Fungi"
