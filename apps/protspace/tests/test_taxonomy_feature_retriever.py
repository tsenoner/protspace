"""Tests for taxonomy feature retriever.

These tests use the real NCBI taxonomy database to ensure accurate behavior.
The database is initialized once per test session and cached.
"""

import pytest

from src.protspace.data.feature_retrievers.taxonomy_feature_retriever import (
    TAXONOMY_FEATURES,
    TaxonomyFeatureRetriever,
)


@pytest.fixture(scope="session")
def ensure_taxdb():
    """Ensure taxonomy database is available once per test session."""
    # Initialize once to download/verify database
    retriever = TaxonomyFeatureRetriever(taxon_ids=[9606], features=["genus"])
    # Database is now cached for all tests
    return True


@pytest.mark.slow
@pytest.mark.integration
class TestTaxonomyFeatures:
    """Test taxonomy feature extraction with real NCBI data."""

    def test_constants(self):
        """Verify TAXONOMY_FEATURES constant."""
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
        assert TAXONOMY_FEATURES == expected

    def test_invalid_taxon_ids(self):
        """Test that invalid taxon IDs raise ValueError."""
        with pytest.raises(ValueError, match="not an integer"):
            TaxonomyFeatureRetriever(taxon_ids=[9606, "invalid"])

    def test_bacteria_taxonomy(self, ensure_taxdb):
        """Test bacterial taxonomy (E. coli)."""
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=[511145], features=TAXONOMY_FEATURES
        )
        result = retriever.fetch_features()

        features = result[511145]["features"]
        assert features["root"] == "cellular organisms"
        assert features["domain"] == "Bacteria"
        assert features["kingdom"] == "Pseudomonadati"
        assert features["phylum"] == "Pseudomonadota"
        assert features["class"] == "Gammaproteobacteria"
        assert features["genus"] == "Escherichia"
        assert features["species"] == "Escherichia coli"

    def test_archaea_taxonomy(self, ensure_taxdb):
        """Test archaeal taxonomy."""
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=[2190], features=TAXONOMY_FEATURES
        )
        result = retriever.fetch_features()

        features = result[2190]["features"]
        assert features["domain"] == "Archaea"
        assert features["kingdom"] == "Methanobacteriati"
        assert features["genus"] == "Methanocaldococcus"

    def test_eukaryote_taxonomy(self, ensure_taxdb):
        """Test eukaryotic taxonomy across major groups."""
        taxon_ids = [
            7460,  # Insect (Apis mellifera)
            9615,  # Mammal (Canis lupus)
            3702,  # Plant (Arabidopsis thaliana)
            559292,  # Fungi (Saccharomyces cerevisiae)
        ]

        retriever = TaxonomyFeatureRetriever(
            taxon_ids=taxon_ids, features=TAXONOMY_FEATURES
        )
        result = retriever.fetch_features()

        # All should be Eukaryota
        for taxon_id in taxon_ids:
            assert result[taxon_id]["features"]["domain"] == "Eukaryota"

        # Verify specific kingdoms
        assert result[7460]["features"]["kingdom"] == "Metazoa"  # Animal
        assert result[9615]["features"]["kingdom"] == "Metazoa"  # Animal
        assert result[3702]["features"]["kingdom"] == "Viridiplantae"  # Plant
        assert result[559292]["features"]["kingdom"] == "Fungi"  # Fungus

    def test_virus_taxonomy(self, ensure_taxdb):
        """Test viral taxonomy - uses acellular root and realm."""
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=[2697049],
            features=TAXONOMY_FEATURES,  # SARS-CoV-2
        )
        result = retriever.fetch_features()

        features = result[2697049]["features"]
        assert features["root"] == "Viruses"
        assert features["domain"] == "Riboviria"  # realm used as domain
        assert features["kingdom"] == "Orthornavirae"
        assert features["family"] == "Coronaviridae"

    def test_domain_fallback_to_realm(self, ensure_taxdb):
        """Test that viruses use realm as domain."""
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=[2697049, 211044],  # SARS-CoV-2, Influenza
            features=["domain", "kingdom"],
        )
        result = retriever.fetch_features()

        # Both viruses should have realm as domain
        assert result[2697049]["features"]["domain"] == "Riboviria"
        assert result[211044]["features"]["domain"] != ""
        # Both are Orthornavirae kingdom
        assert result[2697049]["features"]["kingdom"] == "Orthornavirae"
        assert result[211044]["features"]["kingdom"] == "Orthornavirae"

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
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=taxon_ids, features=TAXONOMY_FEATURES
        )
        result = retriever.fetch_features()

        for taxon_id, expected in test_cases.items():
            actual = result[taxon_id]["features"]
            for feature, value in expected.items():
                assert actual[feature] == value, (
                    f"Taxon {taxon_id}: {feature}='{actual[feature]}' != '{value}'"
                )

    def test_missing_ranks(self, ensure_taxdb):
        """Test that missing taxonomy ranks return empty strings."""
        # Use a virus that might have incomplete taxonomy
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=[10710],
            features=TAXONOMY_FEATURES,  # Bacteriophage lambda
        )
        result = retriever.fetch_features()

        features = result[10710]["features"]
        # Should have some features
        assert features["domain"] != ""  # realm
        assert features["genus"] == "Lambdavirus"
        # Missing ranks should be empty strings, not cause errors
        assert isinstance(features["order"], str)
        assert isinstance(features["family"], str)

    def test_error_handling_invalid_taxon(self, ensure_taxdb):
        """Test graceful handling of invalid taxon IDs."""
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=[99999999],
            features=["genus", "species"],  # Invalid ID
        )
        result = retriever.fetch_features()

        # Should return empty features for invalid ID
        features = result[99999999]["features"]
        assert features["genus"] == ""
        assert features["species"] == ""

    def test_partial_features(self, ensure_taxdb):
        """Test requesting only subset of features."""
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=[9606],
            features=["domain", "genus", "species"],  # Human
        )
        result = retriever.fetch_features()

        features = result[9606]["features"]
        assert len(features) == 3
        assert features["domain"] == "Eukaryota"
        assert features["genus"] == "Homo"
        assert features["species"] == "Homo sapiens"

    def test_batch_retrieval(self, ensure_taxdb):
        """Test efficient batch retrieval of multiple organisms."""
        taxon_ids = [511145, 9606, 2697049]  # Bacteria, Human, Virus
        retriever = TaxonomyFeatureRetriever(
            taxon_ids=taxon_ids, features=["domain", "species"]
        )
        result = retriever.fetch_features()

        assert len(result) == 3
        assert all(taxon_id in result for taxon_id in taxon_ids)
        assert all("domain" in result[tid]["features"] for tid in taxon_ids)
        assert all("species" in result[tid]["features"] for tid in taxon_ids)
