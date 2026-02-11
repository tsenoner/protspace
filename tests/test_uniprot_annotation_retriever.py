import io
import json
from unittest.mock import Mock, patch

from src.protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
    ProteinAnnotations,
    UniProtRetriever,
)

# Alias for test compatibility
UniProtAnnotationRetriever = UniProtRetriever


class TestUniProtAnnotationRetrieverInit:
    """Test UniProtAnnotationRetriever initialization."""

    def test_init_with_headers_and_annotations(self):
        """Test initialization with both headers and annotations."""
        headers = ["P01308", "P01315"]
        annotations = ["length", "organism_id"]

        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)

        assert retriever.headers == headers
        assert retriever.annotations == annotations

    def test_init_with_pipe_headers(self):
        """Test initialization with headers containing pipe notation."""
        headers = ["sp|P01308|INS_HUMAN", "tr|P01315|INSL3_HUMAN"]
        annotations = ["length"]

        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)

        # Should extract accession IDs from pipe notation
        assert retriever.headers == ["P01308", "P01315"]
        assert retriever.annotations == annotations

    def test_init_with_defaults(self):
        """Test initialization with default values."""
        retriever = UniProtAnnotationRetriever()

        assert retriever.headers == []
        assert retriever.annotations is None


class TestManageHeaders:
    """Test the _manage_headers method."""

    def test_manage_headers_swissprot_format(self):
        """Test header management with SwissProt format."""
        retriever = UniProtAnnotationRetriever()
        headers = ["sp|P01308|INS_HUMAN", "sp|P01315|INSL3_HUMAN"]

        result = retriever._manage_headers(headers)

        assert result == ["P01308", "P01315"]

    def test_manage_headers_trembl_format(self):
        """Test header management with TrEMBL format."""
        retriever = UniProtAnnotationRetriever()
        headers = ["tr|A0A0A0MRZ7|A0A0A0MRZ7_HUMAN", "tr|Q8N2C7|Q8N2C7_HUMAN"]

        result = retriever._manage_headers(headers)

        assert result == ["A0A0A0MRZ7", "Q8N2C7"]

    def test_manage_headers_mixed_formats(self):
        """Test header management with mixed formats."""
        retriever = UniProtAnnotationRetriever()
        headers = ["sp|P01308|INS_HUMAN", "P01315", "tr|Q8N2C7|Q8N2C7_HUMAN"]

        result = retriever._manage_headers(headers)

        assert result == ["P01308", "P01315", "Q8N2C7"]

    def test_manage_headers_simple_format(self):
        """Test header management with simple accession format."""
        retriever = UniProtAnnotationRetriever()
        headers = ["P01308", "P01315", "Q8N2C7"]

        result = retriever._manage_headers(headers)

        assert result == ["P01308", "P01315", "Q8N2C7"]

    def test_manage_headers_case_insensitive(self):
        """Test that header management is case insensitive."""
        retriever = UniProtAnnotationRetriever()
        headers = ["SP|P01308|INS_HUMAN", "TR|P01315|INSL3_HUMAN"]

        result = retriever._manage_headers(headers)

        assert result == ["P01308", "P01315"]


class TestFetchAnnotations:
    """Test the fetch_annotations method."""

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_fetch_annotations_success(self, mock_client_class):
        """Test successful annotation fetching with new unipressed implementation."""
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
                "annotations": [],
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
                "annotations": [],
                "keywords": [],
                "entryAudit": {},
            },
        ]

        mock_client_class.fetch_many.return_value = mock_records

        # Create retriever and test
        headers = ["P01308", "P01315"]
        annotations = ["entry", "length", "organism_id"]
        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)

        result = retriever.fetch_annotations()

        # Verify results
        assert len(result) == 2
        assert isinstance(result[0], ProteinAnnotations)
        assert result[0].identifier == "P01308"
        assert result[0].annotations["length"] == "110"
        assert result[0].annotations["annotation_score"] == "5.0"
        assert result[0].annotations["reviewed"] == "Swiss-Prot"

        assert result[1].identifier == "P01315"
        assert result[1].annotations["length"] == "142"
        assert result[1].annotations["annotation_score"] == "4.0"

        # Verify API call
        mock_client_class.fetch_many.assert_called_once_with(["P01308", "P01315"])

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_fetch_annotations_batching_logic(self, mock_client_class):
        """Test annotation fetching with batching behavior."""
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
                    "annotations": [],
                    "keywords": [],
                    "entryAudit": {},
                }
                for i, acc in enumerate(batch)
            ]

        mock_client_class.fetch_many.side_effect = mock_fetch_many

        # Create retriever and test
        annotations = ["entry", "length"]
        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)

        result = retriever.fetch_annotations()

        # Verify results
        assert len(result) == 150
        # Verify API was called multiple times for batching
        assert mock_client_class.fetch_many.call_count == 2  # 100 + 50

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_fetch_annotations_handles_errors(self, mock_client_class):
        """Test handling of API errors."""
        # Mock API to raise an exception
        mock_client_class.fetch_many.side_effect = Exception("API Error")

        # Create retriever and test
        headers = ["P01308"]
        annotations = ["entry", "length"]
        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)

        result = retriever.fetch_annotations()

        # Should return result with empty annotations due to error handling
        assert len(result) == 1
        assert result[0].identifier == "P01308"
        # All annotations should be empty strings due to error
        assert all(v == "" for v in result[0].annotations.values())

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_fetch_annotations_stores_uniprot_annotations(self, mock_client_class):
        """Test that fetch_annotations stores UNIPROT_ANNOTATIONS including organism_id."""
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
                "annotations": [],
                "keywords": [{"name": "Diabetes mellitus", "id": "KW-0001"}],
                "entryAudit": {
                    "firstPublicDate": "2020-01-01",
                    "lastAnnotationUpdateDate": "2023-01-01",
                },
            }
        ]

        mock_client_class.fetch_many.return_value = mock_records

        # Request annotations (actual storage is UNIPROT_ANNOTATIONS)
        headers = ["P01308"]
        annotations = ["entry", "length"]
        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)

        result = retriever.fetch_annotations()

        # Should return exactly UNIPROT_ANNOTATIONS
        assert len(result) == 1
        assert len(result[0].annotations) == len(UNIPROT_ANNOTATIONS)

        # Check all UNIPROT_ANNOTATIONS are present
        for annotation in UNIPROT_ANNOTATIONS:
            assert annotation in result[0].annotations

        # Verify specific raw values
        assert result[0].annotations["length"] == "110"
        assert result[0].annotations["annotation_score"] == "5.0"
        assert result[0].annotations["organism_id"] == "9606"
        assert result[0].annotations["reviewed"] == "Swiss-Prot"
        assert (
            result[0].annotations["gene_name"] == "INS"
        )  # Gene name from genes[0].geneName

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_reviewed_field_parsing_swiss_prot_and_trembl(self, mock_client_class):
        """End-to-end test: reviewed field correctly parsed for both Swiss-Prot and TrEMBL entries."""
        # Mock API responses with both reviewed (Swiss-Prot) and unreviewed (TrEMBL) entries
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
                "annotations": [],
                "keywords": [],
                "entryAudit": {},
            },
            {
                "primaryAccession": "Q12345",
                "uniProtkbId": "TEST_HUMAN",
                "sequence": {"value": "MAPRLCLLLL", "length": 142, "molWeight": 15000},
                "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
                "proteinDescription": {
                    "recommendedName": {"fullName": {"value": "Test protein"}}
                },
                "genes": [{"geneName": {"value": "TEST"}}],
                "entryType": "UniProtKB unreviewed (TrEMBL)",
                "annotationScore": 3.0,
                "proteinExistence": "2: Evidence at transcript level",
                "comments": [],
                "uniProtKBCrossReferences": [],
                "annotations": [],
                "keywords": [],
                "entryAudit": {},
            },
        ]

        mock_client_class.fetch_many.return_value = mock_records

        # Create retriever and fetch
        headers = ["P01308", "Q12345"]
        annotations = ["entry", "reviewed", "annotation_score"]
        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)
        result = retriever.fetch_annotations()

        # Verify we have both entries
        assert len(result) == 2

        # Verify Swiss-Prot entry (reviewed) returns "Swiss-Prot"
        assert result[0].identifier == "P01308"
        assert result[0].annotations["reviewed"] == "Swiss-Prot"

        # Verify TrEMBL entry (unreviewed) returns "TrEMBL"
        assert result[1].identifier == "Q12345"
        assert result[1].annotations["reviewed"] == "TrEMBL"


class TestConstants:
    """Test module constants."""

    def test_uniprot_annotations_constant(self):
        """Test that UNIPROT_ANNOTATIONS contains expected annotations including organism_id."""
        expected_annotations = [
            "protein_existence",
            "annotation_score",
            "protein_families",
            "gene_name",
            "length",
            "reviewed",
            "fragment",
            "cc_subcellular_location",
            "sequence",
            "xref_pdb",
            "organism_id",
            "protein_name",
            "uniprot_kb_id",
        ]

        for annotation in expected_annotations:
            assert annotation in UNIPROT_ANNOTATIONS

        assert len(UNIPROT_ANNOTATIONS) == 13

    def test_protein_annotations_namedtuple(self):
        """Test ProteinAnnotations namedtuple structure."""
        annotations_dict = {"length": "110", "organism_id": "9606"}
        protein_annotations = ProteinAnnotations(
            identifier="P01308", annotations=annotations_dict
        )

        assert protein_annotations.identifier == "P01308"
        assert protein_annotations.annotations == annotations_dict
        assert protein_annotations.annotations["length"] == "110"
        assert protein_annotations.annotations["organism_id"] == "9606"


def _make_mock_record(accession, entry_name="TEST_HUMAN", length=110, organism_id=9606,
                      protein_name="Test protein", entry_type="UniProtKB reviewed (Swiss-Prot)",
                      annotation_score=5.0):
    """Helper to build a minimal mock UniProt JSON record."""
    return {
        "primaryAccession": accession,
        "uniProtkbId": entry_name,
        "sequence": {"value": "MALWMRLLPL", "length": length, "molWeight": 11500},
        "organism": {"scientificName": "Homo sapiens", "taxonId": organism_id},
        "proteinDescription": {
            "recommendedName": {"fullName": {"value": protein_name}}
        },
        "genes": [{"geneName": {"value": "TEST"}}],
        "entryType": entry_type,
        "annotationScore": annotation_score,
        "proteinExistence": "1: Evidence at protein level",
        "comments": [],
        "uniProtKBCrossReferences": [],
        "annotations": [],
        "keywords": [],
        "entryAudit": {},
    }


def _make_search_page(records):
    """Build a TextIOWrapper mimicking unipressed search().each_page() output."""
    content = json.dumps({"results": records})
    return io.TextIOWrapper(io.BytesIO(content.encode("utf-8")), encoding="utf-8")


class TestExtractAnnotations:
    """Test the _extract_annotations static method."""

    def test_extract_annotations_returns_all_keys(self):
        """All UNIPROT_ANNOTATIONS keys are present in the result."""
        from src.protspace.data.parsers.uniprot_parser import UniProtEntry

        record = _make_mock_record("P99999")
        entry = UniProtEntry(record)
        result = UniProtRetriever._extract_annotations(entry)

        assert set(result.keys()) == set(UNIPROT_ANNOTATIONS)

    def test_extract_annotations_values_are_strings(self):
        """All values should be strings (for CSV/Parquet compatibility)."""
        from src.protspace.data.parsers.uniprot_parser import UniProtEntry

        record = _make_mock_record("P99999")
        entry = UniProtEntry(record)
        result = UniProtRetriever._extract_annotations(entry)

        for key, value in result.items():
            assert isinstance(value, str), f"{key} should be a string, got {type(value)}"

    def test_extract_annotations_specific_values(self):
        """Spot-check specific annotation values."""
        from src.protspace.data.parsers.uniprot_parser import UniProtEntry

        record = _make_mock_record("P99999", length=200, organism_id=9606,
                                   annotation_score=3.0)
        entry = UniProtEntry(record)
        result = UniProtRetriever._extract_annotations(entry)

        assert result["length"] == "200"
        assert result["organism_id"] == "9606"
        assert result["annotation_score"] == "3.0"
        assert result["reviewed"] == "Swiss-Prot"


class TestResolveInactiveEntries:
    """Test the _resolve_inactive_entries method."""

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_resolve_merged_entry(self, mock_client_class):
        """A merged accession should resolve to its replacement, keeping the original ID."""
        replacement_record = _make_mock_record("Q076D1", protein_name="Crotastatin")
        page = _make_search_page([replacement_record])

        mock_search_result = Mock()
        mock_search_result.each_page.return_value = iter([page])
        mock_client_class.search.return_value = mock_search_result

        retriever = UniProtRetriever(headers=[])
        result = retriever._resolve_inactive_entries(["C5H5D1"])

        assert len(result) == 1
        assert result[0].identifier == "C5H5D1"  # original accession preserved
        assert result[0].annotations["protein_name"] == "Crotastatin"
        assert result[0].annotations["length"] == "110"
        mock_client_class.search.assert_called_once_with(
            query="sec_acc:C5H5D1", format="json"
        )

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_resolve_demerged_entry_takes_first(self, mock_client_class):
        """A demerged accession returns multiple results; we take the first."""
        records = [
            _make_mock_record("P0DRL2", protein_name="Protein A"),
            _make_mock_record("P0DRL1", protein_name="Protein B"),
        ]
        page = _make_search_page(records)

        mock_search_result = Mock()
        mock_search_result.each_page.return_value = iter([page])
        mock_client_class.search.return_value = mock_search_result

        retriever = UniProtRetriever(headers=[])
        result = retriever._resolve_inactive_entries(["D5KR58"])

        assert len(result) == 1
        assert result[0].identifier == "D5KR58"
        assert result[0].annotations["protein_name"] == "Protein A"

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_resolve_no_results_returns_empty_annotations(self, mock_client_class):
        """When search returns no results, empty annotations are created."""
        page = _make_search_page([])

        mock_search_result = Mock()
        mock_search_result.each_page.return_value = iter([page])
        mock_client_class.search.return_value = mock_search_result

        retriever = UniProtRetriever(headers=[])
        result = retriever._resolve_inactive_entries(["XXXXXX"])

        assert len(result) == 1
        assert result[0].identifier == "XXXXXX"
        assert all(v == "" for v in result[0].annotations.values())

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_resolve_api_error_returns_empty_annotations(self, mock_client_class):
        """When the search API raises an exception, empty annotations are created."""
        mock_client_class.search.side_effect = Exception("Network error")

        retriever = UniProtRetriever(headers=[])
        result = retriever._resolve_inactive_entries(["BROKEN"])

        assert len(result) == 1
        assert result[0].identifier == "BROKEN"
        assert all(v == "" for v in result[0].annotations.values())

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_resolve_multiple_missing(self, mock_client_class):
        """Multiple missing accessions are each resolved independently."""
        def fake_search(query, format):
            acc = query.split(":")[1]
            record = _make_mock_record(f"NEW_{acc}", protein_name=f"Resolved {acc}")
            page = _make_search_page([record])
            mock_result = Mock()
            mock_result.each_page.return_value = iter([page])
            return mock_result

        mock_client_class.search.side_effect = fake_search

        retriever = UniProtRetriever(headers=[])
        result = retriever._resolve_inactive_entries(["AAA", "BBB", "CCC"])

        assert len(result) == 3
        assert [r.identifier for r in result] == ["AAA", "BBB", "CCC"]
        assert result[0].annotations["protein_name"] == "Resolved AAA"
        assert result[2].annotations["protein_name"] == "Resolved CCC"


class TestFetchAnnotationsWithMissingEntries:
    """Test that fetch_annotations detects and resolves missing entries."""

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_missing_entries_are_resolved(self, mock_client_class):
        """When fetch_many drops an entry, it gets resolved via secondary accession."""
        # fetch_many returns only P01308, dropping C5H5D1
        mock_client_class.fetch_many.return_value = [
            _make_mock_record("P01308", protein_name="Insulin"),
        ]

        # search resolves C5H5D1 → Q076D1
        replacement = _make_mock_record("Q076D1", protein_name="Crotastatin")
        page = _make_search_page([replacement])
        mock_search_result = Mock()
        mock_search_result.each_page.return_value = iter([page])
        mock_client_class.search.return_value = mock_search_result

        retriever = UniProtRetriever(headers=["P01308", "C5H5D1"])
        result = retriever.fetch_annotations()

        assert len(result) == 2
        identifiers = {r.identifier for r in result}
        assert identifiers == {"P01308", "C5H5D1"}

        resolved = [r for r in result if r.identifier == "C5H5D1"][0]
        assert resolved.annotations["protein_name"] == "Crotastatin"

    @patch(
        "src.protspace.data.annotations.retrievers.uniprot_retriever.UniprotkbClient"
    )
    def test_no_missing_entries_skips_resolution(self, mock_client_class):
        """When all entries are returned, _resolve_inactive_entries is not called."""
        mock_client_class.fetch_many.return_value = [
            _make_mock_record("P01308"),
            _make_mock_record("P01315"),
        ]

        retriever = UniProtRetriever(headers=["P01308", "P01315"])
        result = retriever.fetch_annotations()

        assert len(result) == 2
        mock_client_class.search.assert_not_called()
