"""Tests for taxonomy annotation retriever.

These tests use the real NCBI taxonomy database to ensure accurate behavior.
The database is initialized once per test session and cached.
"""

import pytest

from src.protspace.data.annotations.retrievers.taxonomy_retriever import (
    TAXONOMY_ANNOTATIONS,
    TaxonomyRetriever,
)

# Alias for test compatibility
TaxonomyAnnotationRetriever = TaxonomyRetriever


@pytest.fixture(scope="session")
def ensure_taxdb():
    """Ensure taxonomy database is available once per test session."""
    # Initialize once to download/verify database
    retriever = TaxonomyAnnotationRetriever(taxon_ids=[9606], annotations=["genus"])
    # Database is now cached for all tests
    return True


@pytest.mark.slow
@pytest.mark.integration
class TestTaxonomyAnnotationRetriever:
    """Test taxonomy annotation extraction with real NCBI data."""

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

    def test_bacteria_taxonomy(self, ensure_taxdb):
        """Test bacterial taxonomy (E. coli)."""
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

    def test_archaea_taxonomy(self, ensure_taxdb):
        """Test archaeal taxonomy."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[2190], annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        annotations = result[2190]["annotations"]
        assert annotations["domain"] == "Archaea"
        assert annotations["kingdom"] == "Methanobacteriati"
        assert annotations["genus"] == "Methanocaldococcus"

    def test_eukaryote_taxonomy(self, ensure_taxdb):
        """Test eukaryotic taxonomy across major groups."""
        taxon_ids = [
            7460,  # Insect (Apis mellifera)
            9615,  # Mammal (Canis lupus)
            3702,  # Plant (Arabidopsis thaliana)
            559292,  # Fungi (Saccharomyces cerevisiae)
        ]

        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=taxon_ids, annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        # All should be Eukaryota
        for taxon_id in taxon_ids:
            assert result[taxon_id]["annotations"]["domain"] == "Eukaryota"

        # Verify specific kingdoms
        assert result[7460]["annotations"]["kingdom"] == "Metazoa"  # Animal
        assert result[9615]["annotations"]["kingdom"] == "Metazoa"  # Animal
        assert result[3702]["annotations"]["kingdom"] == "Viridiplantae"  # Plant
        assert result[559292]["annotations"]["kingdom"] == "Fungi"  # Fungus

    def test_virus_taxonomy(self, ensure_taxdb):
        """Test viral taxonomy - uses acellular root and realm."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[2697049],
            annotations=TAXONOMY_ANNOTATIONS,  # SARS-CoV-2
        )
        result = retriever.fetch_annotations()

        annotations = result[2697049]["annotations"]
        assert annotations["root"] == "Viruses"
        assert annotations["domain"] == "Riboviria"  # realm used as domain
        assert annotations["kingdom"] == "Orthornavirae"
        assert annotations["family"] == "Coronaviridae"

    def test_domain_fallback_to_realm(self, ensure_taxdb):
        """Test that viruses use realm as domain."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[2697049, 211044],  # SARS-CoV-2, Influenza
            annotations=["domain", "kingdom"],
        )
        result = retriever.fetch_annotations()

        # Both viruses should have realm as domain
        assert result[2697049]["annotations"]["domain"] == "Riboviria"
        assert result[211044]["annotations"]["domain"] != ""
        # Both are Orthornavirae kingdom
        assert result[2697049]["annotations"]["kingdom"] == "Orthornavirae"
        assert result[211044]["annotations"]["kingdom"] == "Orthornavirae"

    def test_diverse_organisms(self, ensure_taxdb):
        """Test comprehensive set of organisms across all domains of life."""
        test_cases = {
            511145: {  # E. coli (Bacteria)
                "root": "cellular organisms",
                "domain": "Bacteria",
                "genus": "Escherichia",
            },
            2190: {  # Archaea
                "domain": "Archaea",
                "genus": "Methanocaldococcus",
            },
            9615: {  # Mammal
                "domain": "Eukaryota",
                "kingdom": "Metazoa",
                "class": "Mammalia",
            },
            2697049: {  # Virus
                "root": "Viruses",
                "domain": "Riboviria",
                "kingdom": "Orthornavirae",
            },
        }

        taxon_ids = list(test_cases.keys())
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=taxon_ids, annotations=TAXONOMY_ANNOTATIONS
        )
        result = retriever.fetch_annotations()

        for taxon_id, expected in test_cases.items():
            actual = result[taxon_id]["annotations"]
            for annotation, value in expected.items():
                assert actual[annotation] == value, (
                    f"Taxon {taxon_id}: {annotation}='{actual[annotation]}' != '{value}'"
                )

    def test_missing_ranks(self, ensure_taxdb):
        """Test that missing taxonomy ranks return empty strings."""
        # Use a virus that might have incomplete taxonomy
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[10710],
            annotations=TAXONOMY_ANNOTATIONS,  # Bacteriophage lambda
        )
        result = retriever.fetch_annotations()

        annotations = result[10710]["annotations"]
        # Should have some annotations
        assert annotations["domain"] != ""  # realm
        assert annotations["genus"] == "Lambdavirus"
        # Missing ranks should be empty strings, not cause errors
        assert isinstance(annotations["order"], str)
        assert isinstance(annotations["family"], str)

    def test_error_handling_invalid_taxon(self, ensure_taxdb):
        """Test graceful handling of invalid taxon IDs."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[99999999],
            annotations=["genus", "species"],  # Invalid ID
        )
        result = retriever.fetch_annotations()

        # Should return empty annotations for invalid ID
        annotations = result[99999999]["annotations"]
        assert annotations["genus"] == ""
        assert annotations["species"] == ""

    def test_partial_annotations(self, ensure_taxdb):
        """Test requesting only subset of annotations."""
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=[9606],
            annotations=["domain", "genus", "species"],  # Human
        )
        result = retriever.fetch_annotations()

        annotations = result[9606]["annotations"]
        assert len(annotations) == 3
        assert annotations["domain"] == "Eukaryota"
        assert annotations["genus"] == "Homo"
        assert annotations["species"] == "Homo sapiens"

    def test_batch_retrieval(self, ensure_taxdb):
        """Test efficient batch retrieval of multiple organisms."""
        taxon_ids = [511145, 9606, 2697049]  # Bacteria, Human, Virus
        retriever = TaxonomyAnnotationRetriever(
            taxon_ids=taxon_ids, annotations=["domain", "species"]
        )
        result = retriever.fetch_annotations()

        assert len(result) == 3
        assert all(taxon_id in result for taxon_id in taxon_ids)
        assert all("domain" in result[tid]["annotations"] for tid in taxon_ids)
        assert all("species" in result[tid]["annotations"] for tid in taxon_ids)
