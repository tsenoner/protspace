import json
from unittest.mock import patch

from src.protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
    ProteinAnnotations,
    UniProtRetriever,
)

# Alias for test compatibility
UniProtAnnotationRetriever = UniProtRetriever

_FETCH_ONE_PATCH = (
    "src.protspace.data.annotations.retrievers"
    ".uniprot_retriever._fetch_one_with_timeout"
)
_UNIPARC_PATCH = (
    "src.protspace.data.annotations.retrievers"
    ".uniprot_retriever._fetch_uniparc_sequence"
)
_FETCH_MANY_PATCH = (
    "src.protspace.data.annotations.retrievers.uniprot_retriever._fetch_many_accessions"
)
_SEARCH_SEC_ACC_PATCH = (
    "src.protspace.data.annotations.retrievers.uniprot_retriever._search_sec_acc"
)


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
        """Headers with pipe notation are passed through as-is (no stripping)."""
        headers = ["sp|P01308|INS_HUMAN", "tr|P01315|INSL3_HUMAN"]
        annotations = ["length"]

        retriever = UniProtAnnotationRetriever(headers=headers, annotations=annotations)

        # Headers are kept as-is; non-UniProt IDs are filtered before API calls
        assert retriever.headers == headers
        assert retriever.annotations == annotations

    def test_init_with_defaults(self):
        """Test initialization with default values."""
        retriever = UniProtAnnotationRetriever()

        assert retriever.headers == []
        assert retriever.annotations is None


class TestFetchAnnotations:
    """Test the fetch_annotations method."""

    @patch(_FETCH_MANY_PATCH)
    def test_fetch_annotations_swiss_prot_and_trembl(self, mock_fetch_many):
        """Each record becomes one row of every UNIPROT_ANNOTATIONS column, in
        request order, with Swiss-Prot and TrEMBL entries told apart."""
        mock_fetch_many.return_value = [
            _make_mock_record(
                "P01308", entry_name="INS_HUMAN", length=110, gene_name="INS"
            ),
            _make_mock_record(
                "Q12345",
                length=142,
                organism_id=10090,
                entry_type="UniProtKB unreviewed (TrEMBL)",
                annotation_score=3.0,
            ),
        ]
        retriever = UniProtAnnotationRetriever(
            headers=["P01308", "Q12345"], annotations=["entry", "length"]
        )

        result = retriever.fetch_annotations()

        assert [p.identifier for p in result] == ["P01308", "Q12345"]
        for protein in result:
            assert isinstance(protein, ProteinAnnotations)
            assert set(protein.annotations) == set(UNIPROT_ANNOTATIONS)
        checked = ("length", "annotation_score", "organism_id", "reviewed", "gene_name")
        assert [{k: p.annotations[k] for k in checked} for p in result] == [
            {
                "length": "110",
                "annotation_score": "5.0",
                "organism_id": "9606",
                "reviewed": "Swiss-Prot",
                "gene_name": "INS",  # from genes[0].geneName
            },
            {
                "length": "142",
                "annotation_score": "3.0",
                "organism_id": "10090",
                "reviewed": "TrEMBL",
                "gene_name": "TEST",
            },
        ]

    @patch(_FETCH_MANY_PATCH)
    def test_fetch_annotations_batching_logic(self, mock_fetch_many):
        """Test annotation fetching with batching behavior."""
        headers = [f"P{i:05d}" for i in range(150)]  # More than batch size (100)
        mock_fetch_many.side_effect = lambda batch, **kwargs: [
            _make_mock_record(acc, length=100 + i) for i, acc in enumerate(batch)
        ]

        retriever = UniProtAnnotationRetriever(
            headers=headers, annotations=["entry", "length"]
        )

        result = retriever.fetch_annotations()

        assert [p.identifier for p in result] == headers
        assert retriever.failed_batch_count == 0
        # Verify API was called multiple times for batching
        assert mock_fetch_many.call_count == 2  # 100 + 50

    @patch(_FETCH_MANY_PATCH)
    def test_fetch_annotations_handles_errors(self, mock_fetch_many):
        """Test handling of API errors."""
        mock_fetch_many.side_effect = Exception("API Error")

        retriever = UniProtAnnotationRetriever(
            headers=["P01308"], annotations=["entry", "length"]
        )

        result = retriever.fetch_annotations()

        # Should return result with empty annotations due to error handling
        assert len(result) == 1
        assert result[0].identifier == "P01308"
        # All annotations should be empty strings due to error
        assert all(v == "" for v in result[0].annotations.values())
        assert retriever.failed_batch_count == 1


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
            "ec",
            "go_bp",
            "go_cc",
            "go_mf",
            "keyword",
            "sequence",
            "xref_pdb",
            "organism_id",
            "protein_name",
            "uniprot_kb_id",
        ]

        for annotation in expected_annotations:
            assert annotation in UNIPROT_ANNOTATIONS

        assert len(UNIPROT_ANNOTATIONS) == 18

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


def _make_mock_record(
    accession,
    entry_name="TEST_HUMAN",
    length=110,
    organism_id=9606,
    protein_name="Test protein",
    entry_type="UniProtKB reviewed (Swiss-Prot)",
    annotation_score=5.0,
    gene_name="TEST",
):
    """Helper to build a minimal mock UniProt JSON record."""
    return {
        "primaryAccession": accession,
        "uniProtkbId": entry_name,
        "sequence": {"value": "MALWMRLLPL", "length": length, "molWeight": 11500},
        "organism": {"scientificName": "Homo sapiens", "taxonId": organism_id},
        "proteinDescription": {
            "recommendedName": {"fullName": {"value": protein_name}}
        },
        "genes": [{"geneName": {"value": gene_name}}],
        "entryType": entry_type,
        "annotationScore": annotation_score,
        "proteinExistence": "1: Evidence at protein level",
        "comments": [],
        "uniProtKBCrossReferences": [],
        "annotations": [],
        "keywords": [],
        "entryAudit": {},
    }


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
            assert isinstance(value, str), (
                f"{key} should be a string, got {type(value)}"
            )

    def test_extract_annotations_specific_values(self):
        """Spot-check specific annotation values."""
        from src.protspace.data.parsers.uniprot_parser import UniProtEntry

        record = _make_mock_record(
            "P99999", length=200, organism_id=9606, annotation_score=3.0
        )
        entry = UniProtEntry(record)
        result = UniProtRetriever._extract_annotations(entry)

        assert result["length"] == "200"
        assert result["organism_id"] == "9606"
        assert result["annotation_score"] == "3.0"
        assert result["reviewed"] == "Swiss-Prot"


class TestResolveInactiveEntries:
    """Test the _resolve_inactive_entries method."""

    @patch(_FETCH_ONE_PATCH)
    def test_fetch_one_returns_active_entry(self, mock_fetch_one):
        """fetch_one returns active replacement (transparent merge) → extracts annotations."""
        active_record = _make_mock_record("Q076D1", protein_name="Crotastatin")
        mock_fetch_one.return_value = active_record

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["C5H5D1"])

        assert len(resolved) == 1
        assert resolved[0].identifier == "C5H5D1"  # original accession preserved
        assert resolved[0].annotations["protein_name"] == "Crotastatin"
        assert resolved[0].annotations["length"] == "110"
        assert res_count == 1
        assert del_count == 0
        mock_fetch_one.assert_called_once_with(
            "C5H5D1", on_response=retriever._record_release, session=None
        )

    @patch(_UNIPARC_PATCH)
    @patch(_FETCH_ONE_PATCH)
    def test_fetch_one_returns_inactive_deleted_with_uniparc(
        self, mock_fetch_one, mock_uniparc
    ):
        """Deleted entry recovers sequence from UniParc."""
        mock_fetch_one.return_value = {
            "entryType": "Inactive",
            "inactiveReason": {
                "inactiveReasonType": "DELETED",
                "deletedReason": "Deleted from sequence source (ENSEMBL)",
            },
            "extraAttributes": {"uniParcId": "UPI000012345"},
        }
        mock_uniparc.return_value = ("MALWMRLLPL", 10)

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["X12345"])

        assert len(resolved) == 1
        assert resolved[0].identifier == "X12345"
        assert resolved[0].annotations["sequence"] == "MALWMRLLPL"
        assert resolved[0].annotations["length"] == "10"
        # Other annotations remain empty
        assert resolved[0].annotations["protein_name"] == ""
        assert res_count == 0
        assert del_count == 1
        mock_uniparc.assert_called_once_with(
            "UPI000012345", on_response=retriever._record_release, session=None
        )

    @patch(_UNIPARC_PATCH)
    @patch(_FETCH_ONE_PATCH)
    def test_fetch_one_returns_inactive_deleted_uniparc_fails(
        self, mock_fetch_one, mock_uniparc
    ):
        """Deleted entry with UniParc fetch failure → empty annotations."""
        mock_fetch_one.return_value = {
            "entryType": "Inactive",
            "inactiveReason": {
                "inactiveReasonType": "DELETED",
                "deletedReason": "Deleted from sequence source (ENSEMBL)",
            },
            "extraAttributes": {"uniParcId": "UPI000012345"},
        }
        mock_uniparc.return_value = ("", 0)

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["X12345"])

        assert len(resolved) == 1
        assert resolved[0].annotations["sequence"] == ""
        assert resolved[0].annotations["length"] == ""
        assert del_count == 1

    @patch(_FETCH_ONE_PATCH)
    def test_fetch_one_returns_inactive_merged(self, mock_fetch_one):
        """fetch_one returns Inactive with MERGED + mergeDemergeTo → fetches target."""
        inactive_result = {
            "entryType": "Inactive",
            "inactiveReason": {
                "inactiveReasonType": "MERGED",
                "mergeDemergeTo": ["Q076D1"],
            },
            "extraAttributes": {},
        }
        target_record = _make_mock_record("Q076D1", protein_name="Crotastatin")

        mock_fetch_one.side_effect = [inactive_result, target_record]

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["C5H5D1"])

        assert len(resolved) == 1
        assert resolved[0].identifier == "C5H5D1"
        assert resolved[0].annotations["protein_name"] == "Crotastatin"
        assert res_count == 1
        assert del_count == 0
        assert mock_fetch_one.call_count == 2

    @patch(_UNIPARC_PATCH)
    @patch(_FETCH_ONE_PATCH)
    def test_fetch_one_merged_target_also_inactive(self, mock_fetch_one, mock_uniparc):
        """When merged target is also inactive, entry is counted as deleted."""
        inactive_result = {
            "entryType": "Inactive",
            "inactiveReason": {
                "inactiveReasonType": "MERGED",
                "mergeDemergeTo": ["Q99999"],
            },
            "extraAttributes": {},
        }
        target_also_inactive = {
            "entryType": "Inactive",
            "inactiveReason": {"inactiveReasonType": "DELETED"},
            "extraAttributes": {},
        }

        mock_fetch_one.side_effect = [
            inactive_result,
            target_also_inactive,
        ]
        mock_uniparc.return_value = ("", 0)  # no UniParc ID in extraAttributes

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["Z12345"])

        assert len(resolved) == 1
        assert resolved[0].identifier == "Z12345"
        assert resolved[0].annotations["sequence"] == ""
        assert res_count == 0
        assert del_count == 1

    @patch(_SEARCH_SEC_ACC_PATCH)
    @patch(_FETCH_ONE_PATCH)
    def test_fetch_one_fails_falls_back_to_sec_acc(self, mock_fetch_one, mock_search):
        """When fetch_one raises, falls back to sec_acc: search."""
        mock_fetch_one.side_effect = Exception("404 Not Found")

        replacement_record = _make_mock_record("Q076D1", protein_name="Crotastatin")
        mock_search.return_value = [replacement_record]

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["C5H5D1"])

        assert len(resolved) == 1
        assert resolved[0].identifier == "C5H5D1"
        assert resolved[0].annotations["protein_name"] == "Crotastatin"
        assert res_count == 1
        assert del_count == 0
        mock_search.assert_called_once_with(
            "C5H5D1", on_response=retriever._record_release, session=None
        )

    @patch(_SEARCH_SEC_ACC_PATCH)
    @patch(_FETCH_ONE_PATCH)
    def test_fetch_one_fails_sec_acc_no_results(self, mock_fetch_one, mock_search):
        """When fetch_one fails and sec_acc returns nothing → empty annotations."""
        mock_fetch_one.side_effect = Exception("404 Not Found")
        mock_search.return_value = []

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["XXXXXX"])

        assert len(resolved) == 1
        assert resolved[0].identifier == "XXXXXX"
        assert all(v == "" for v in resolved[0].annotations.values())
        assert res_count == 0
        assert del_count == 1

    @patch(_SEARCH_SEC_ACC_PATCH)
    @patch(_FETCH_ONE_PATCH)
    def test_both_fetch_one_and_search_fail(self, mock_fetch_one, mock_search):
        """When both fetch_one and search fail → empty annotations."""
        mock_fetch_one.side_effect = Exception("404")
        mock_search.side_effect = Exception("Network error")

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(["BROKEN"])

        assert len(resolved) == 1
        assert resolved[0].identifier == "BROKEN"
        assert all(v == "" for v in resolved[0].annotations.values())
        assert res_count == 0
        assert del_count == 1

    @patch(_UNIPARC_PATCH)
    @patch(_FETCH_ONE_PATCH)
    def test_resolve_multiple_mixed(self, mock_fetch_one, mock_uniparc):
        """Multiple missing accessions with mixed outcomes."""
        active_record = _make_mock_record("NEW_AAA", protein_name="Resolved AAA")
        deleted_result = {
            "entryType": "Inactive",
            "inactiveReason": {
                "inactiveReasonType": "DELETED",
                "deletedReason": "Deleted",
            },
            "extraAttributes": {"uniParcId": "UPI0000BBB"},
        }
        active_record_ccc = _make_mock_record("NEW_CCC", protein_name="Resolved CCC")

        mock_fetch_one.side_effect = [
            active_record,
            deleted_result,
            active_record_ccc,
        ]
        mock_uniparc.return_value = ("SEQBBB", 6)

        retriever = UniProtRetriever(headers=[])
        resolved, res_count, del_count = retriever._resolve_inactive_entries(
            ["AAA", "BBB", "CCC"]
        )

        assert len(resolved) == 3
        assert [r.identifier for r in resolved] == ["AAA", "BBB", "CCC"]
        assert resolved[0].annotations["protein_name"] == "Resolved AAA"
        assert resolved[1].annotations["sequence"] == "SEQBBB"
        assert resolved[1].annotations["length"] == "6"
        assert resolved[1].annotations["protein_name"] == ""
        assert resolved[2].annotations["protein_name"] == "Resolved CCC"
        assert res_count == 2
        assert del_count == 1


class TestFetchAnnotationsWithMissingEntries:
    """Test that fetch_annotations detects and resolves missing entries."""

    @patch(_FETCH_ONE_PATCH)
    @patch(_FETCH_MANY_PATCH)
    def test_missing_entries_are_resolved(self, mock_fetch_many, mock_fetch_one):
        """When fetch_many drops an entry, it gets resolved via fetch_one."""
        # fetch_many returns only P01308, dropping C5H5D1
        mock_fetch_many.return_value = [
            _make_mock_record("P01308", protein_name="Insulin"),
        ]

        # fetch_one resolves C5H5D1 → active replacement
        replacement = _make_mock_record("Q076D1", protein_name="Crotastatin")
        mock_fetch_one.return_value = replacement

        retriever = UniProtRetriever(headers=["P01308", "C5H5D1"])
        result = retriever.fetch_annotations()

        assert len(result) == 2
        identifiers = {r.identifier for r in result}
        assert identifiers == {"P01308", "C5H5D1"}

        resolved = [r for r in result if r.identifier == "C5H5D1"][0]
        assert resolved.annotations["protein_name"] == "Crotastatin"

    @patch(_FETCH_ONE_PATCH)
    @patch(_FETCH_MANY_PATCH)
    def test_no_missing_entries_skips_resolution(self, mock_fetch_many, mock_fetch_one):
        """When all entries are returned, _resolve_inactive_entries is not called."""
        mock_fetch_many.return_value = [
            _make_mock_record("P01308"),
            _make_mock_record("P01315"),
        ]

        retriever = UniProtRetriever(headers=["P01308", "P01315"])
        result = retriever.fetch_annotations()

        assert len(result) == 2
        mock_fetch_one.assert_not_called()


class TestUniProtRelease:
    """The UniProtKB release travels in the X-UniProt-Release header of the
    responses the retriever already receives; no extra request is made."""

    @staticmethod
    def _serve(monkeypatch, release_by_endpoint: dict[str, str]):
        """Fake UniProt: P01308 comes back from the batch endpoint; P99999 is
        a deleted entry resolved one by one (its sequence from UniParc);
        Q88888 is missing from the single-entry endpoint and found by a
        secondary-accession search. Each endpoint reports its own release."""
        import requests
        from requests.structures import CaseInsensitiveDict

        bodies = {
            "accessions": {"results": [_make_mock_record("P01308")]},
            "P99999.json": {
                "entryType": "Inactive",
                "inactiveReason": {"inactiveReasonType": "DELETED"},
                "extraAttributes": {"uniParcId": "UPI0000000001"},
            },
            "Q88888.json": None,  # 404
            "search": {"results": [_make_mock_record("Q88880")]},
            "UPI0000000001.json": {"sequence": {"value": "MKV", "length": 3}},
        }
        requested = []
        sessions = []

        def fake_get(session, url, params=None, timeout=None):
            endpoint = url.rsplit("/", 1)[-1]
            requested.append(endpoint)
            sessions.append(session)
            response = requests.Response()
            response.url = url
            release = release_by_endpoint.get(endpoint)
            # Real servers send it lower-case; lookups must not care.
            response.headers = CaseInsensitiveDict(
                {"x-uniprot-release": release} if release else {}
            )
            body = bodies[endpoint]
            response.status_code = 404 if body is None else 200
            response._content = b"{}" if body is None else json.dumps(body).encode()
            return response

        def forbidden(*_args, **_kwargs):
            raise AssertionError("a UniProt request bypassed the session")

        monkeypatch.setattr(requests.Session, "get", fake_get)
        monkeypatch.setattr(requests, "get", forbidden)
        return requested, sessions

    def test_releases_are_collected_from_every_response(self, monkeypatch):
        requested, _ = self._serve(
            monkeypatch,
            {
                "accessions": "2026_03",
                "P99999.json": "2026_02",
                "UPI0000000001.json": "2026_01",
                "search": "2026_04",
            },
        )
        retriever = UniProtRetriever(headers=["P01308", "P99999", "Q88888"])

        result = retriever.fetch_annotations()

        assert {r.identifier for r in result} == {"P01308", "P99999", "Q88888"}
        # Every path was exercised, and none made a request of its own.
        assert sorted(requested) == sorted(
            ["accessions", "P99999.json", "UPI0000000001.json", "Q88888.json", "search"]
        )
        assert retriever.releases == {"2026_01", "2026_02", "2026_03", "2026_04"}

    def test_every_request_goes_through_one_session(self, monkeypatch):
        """A new connection per request held UniProt to 208 entries a second;
        one session reaches 308 (about 31 min for Swiss-Prot)."""
        from protspace.data.annotations.retrievers.http_utils import PooledSession

        requested, sessions = self._serve(monkeypatch, {"accessions": "2026_03"})
        retriever = UniProtRetriever(headers=["P01308", "P99999", "Q88888"])

        retriever.fetch_annotations()

        # The batch, the inactive entry, UniParc, the missing entry and the
        # secondary-accession search: five requests, one session.
        assert len(requested) == 5
        assert len({id(session) for session in sessions}) == 1
        assert isinstance(sessions[0], PooledSession)
        assert retriever.releases == {"2026_03"}

    def test_no_release_header_leaves_the_set_empty(self, monkeypatch):
        self._serve(monkeypatch, {})
        retriever = UniProtRetriever(headers=["P01308", "P99999", "Q88888"])

        retriever.fetch_annotations()

        assert retriever.releases == set()

    def test_a_retriever_that_fetched_nothing_has_an_empty_set(self):
        assert UniProtRetriever(headers=["P01308"]).releases == set()


class TestUniProtRetryAfter:
    """A `Retry-After` on any UniProt response holds every later request of
    the fetch, including the single-attempt lookups that resolve an inactive
    entry: they raise at once, as before, but pass the pause on."""

    @staticmethod
    def _serve(monkeypatch, answers: dict[str, tuple[int, dict | None, dict]]):
        """Fake UniProt over the session, on a fake clock. *answers* maps an
        endpoint to its status, JSON body and headers. Returns the list of
        (endpoint, time sent) the fetch produced."""
        import requests
        from requests.structures import CaseInsensitiveDict

        from protspace.data.annotations.retrievers import http_utils

        clock = {"now": 0.0}

        def advance(seconds, stop=None):
            clock["now"] += seconds
            return False

        class _Time:
            @staticmethod
            def monotonic():
                return clock["now"]

            @staticmethod
            def sleep(seconds):
                advance(seconds)

        monkeypatch.setattr(http_utils, "time", _Time)
        monkeypatch.setattr(http_utils, "_sleep", advance)
        sent = []

        def fake_get(session, url, params=None, timeout=None):
            endpoint = url.rsplit("/", 1)[-1]
            sent.append((endpoint, clock["now"]))
            status, body, headers = answers[endpoint]
            response = requests.Response()
            response.url = url
            response.status_code = status
            response.headers = CaseInsensitiveDict(headers)
            response._content = json.dumps(body or {}).encode()
            return response

        monkeypatch.setattr(requests.Session, "get", fake_get)
        return sent

    def test_a_retry_after_on_an_entry_lookup_holds_the_next_request(self, monkeypatch):
        sent = self._serve(
            monkeypatch,
            {
                "accessions": (200, {"results": [_make_mock_record("P01308")]}, {}),
                "P99999.json": (429, None, {"Retry-After": "3"}),
                "search": (200, {"results": []}, {}),
            },
        )

        rows = UniProtRetriever(headers=["P01308", "P99999"]).fetch_annotations()

        assert {row.identifier for row in rows} == {"P01308", "P99999"}
        # The secondary-accession search waits out the pause.
        assert sent == [("accessions", 0.0), ("P99999.json", 0.0), ("search", 3.0)]

    def test_a_retry_after_on_a_uniparc_lookup_holds_the_next_request(
        self, monkeypatch
    ):
        deleted = {
            "entryType": "Inactive",
            "inactiveReason": {"inactiveReasonType": "DELETED"},
            "extraAttributes": {"uniParcId": "UPI0000000001"},
        }
        sent = self._serve(
            monkeypatch,
            {
                "accessions": (200, {"results": [_make_mock_record("P01308")]}, {}),
                "P99999.json": (200, deleted, {}),
                "UPI0000000001.json": (429, None, {"Retry-After": "2"}),
                "Q88888.json": (404, None, {}),
                "search": (200, {"results": []}, {}),
            },
        )

        UniProtRetriever(headers=["P01308", "P99999", "Q88888"]).fetch_annotations()

        assert sent == [
            ("accessions", 0.0),
            ("P99999.json", 0.0),
            ("UPI0000000001.json", 0.0),
            ("Q88888.json", 2.0),
            ("search", 2.0),
        ]
