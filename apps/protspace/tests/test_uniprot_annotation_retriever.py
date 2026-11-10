import json
from unittest.mock import patch

import pytest

from protspace.data.annotations.retrievers.uniprot_retriever import (
    UNIPROT_ANNOTATIONS,
    ProteinAnnotations,
    UniProtRetriever,
)

# Alias for test compatibility
UniProtAnnotationRetriever = UniProtRetriever

_FETCH_ONE_PATCH = (
    "protspace.data.annotations.retrievers.uniprot_retriever._fetch_one_with_timeout"
)
_UNIPARC_PATCH = (
    "protspace.data.annotations.retrievers.uniprot_retriever._fetch_uniparc_sequence"
)
_FETCH_MANY_PATCH = (
    "protspace.data.annotations.retrievers.uniprot_retriever._fetch_many_accessions"
)
_SEARCH_SEC_ACC_PATCH = (
    "protspace.data.annotations.retrievers.uniprot_retriever._search_sec_acc"
)
_SEARCH_INACTIVE_PATCH = (
    "protspace.data.annotations.retrievers.uniprot_retriever._search_inactive_records"
)
_SEARCH_UNIPARC_PATCH = (
    "protspace.data.annotations.retrievers.uniprot_retriever._search_uniparc_sequences"
)


@pytest.fixture
def no_bulk_answers():
    """The bulk inactive-entry requests answer nothing, so every inactive
    entry goes through the per-entry lookups these tests mock."""
    with (
        patch(_SEARCH_INACTIVE_PATCH, return_value={}) as search,
        patch(_SEARCH_UNIPARC_PATCH, return_value={}),
        patch(_FETCH_MANY_PATCH, return_value=[]),
    ):
        yield search


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
        from protspace.data.parsers.uniprot_parser import UniProtEntry

        record = _make_mock_record("P99999")
        entry = UniProtEntry(record)
        result = UniProtRetriever._extract_annotations(entry)

        assert set(result.keys()) == set(UNIPROT_ANNOTATIONS)

    def test_extract_annotations_values_are_strings(self):
        """All values should be strings (for CSV/Parquet compatibility)."""
        from protspace.data.parsers.uniprot_parser import UniProtEntry

        record = _make_mock_record("P99999")
        entry = UniProtEntry(record)
        result = UniProtRetriever._extract_annotations(entry)

        for key, value in result.items():
            assert isinstance(value, str), (
                f"{key} should be a string, got {type(value)}"
            )

    def test_extract_annotations_specific_values(self):
        """Spot-check specific annotation values."""
        from protspace.data.parsers.uniprot_parser import UniProtEntry

        record = _make_mock_record(
            "P99999", length=200, organism_id=9606, annotation_score=3.0
        )
        entry = UniProtEntry(record)
        result = UniProtRetriever._extract_annotations(entry)

        assert result["length"] == "200"
        assert result["organism_id"] == "9606"
        assert result["annotation_score"] == "3.0"
        assert result["reviewed"] == "Swiss-Prot"


@pytest.mark.usefixtures("no_bulk_answers")
class TestResolveInactiveEntries:
    """The per-entry lookup an inactive entry falls back to when the bulk
    requests leave it unsettled (here: the bulk search answers nothing)."""

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


@pytest.mark.usefixtures("no_bulk_answers")
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


def _endpoint(url: str, params: dict | None) -> str:
    """Name a fake UniProt request: the URL's last segment, plus the field a
    search queries, so the three searches are told apart
    (``search:accession``, ``search:sec_acc``, ``search:upi``)."""
    endpoint = url.rsplit("/", 1)[-1]
    if endpoint == "search":
        endpoint += ":" + params["query"].split(":", 1)[0]
    return endpoint


def _queried(params: dict) -> list[str]:
    """The values an ``A OR B`` search or a comma-joined batch asks for."""
    if "accessions" in params:
        return params["accessions"].split(",")
    return [term.split(":", 1)[1] for term in params["query"].split(" OR ")]


class _FakeUniProt:
    """UniProt over ``requests.Session.get``, answering the batch, single
    entry, bulk and UniParc endpoints from one table, so the bulk path and the
    per-entry path can be compared on the same data.

    *active* maps an accession to its active record; *inactive* maps an
    accession to the stub its single lookup and the ``accession:`` search
    return (a merged one is redirected to its target by the single lookup,
    as UniProt's 303 does); *uniparc* maps a UniParc ID to a sequence.
    *override* maps an endpoint name to a (status, body, headers) answer, or a
    list of them consumed one per request, after which the table answers.
    ``timed`` lists every request as (endpoint, time sent), on the clock
    :meth:`on_a_fake_clock` installs (0.0 without it).
    """

    def __init__(self, monkeypatch, *, active, inactive=None, uniparc=None):
        import requests
        from requests.structures import CaseInsensitiveDict

        self.active = active
        self.inactive = inactive or {}
        self.uniparc = uniparc or {}
        self.override: dict = {}
        self.release: dict[str, str] = {}
        self.sessions: list = []
        self.timed: list[tuple[str, float]] = []
        self.clock = {"now": 0.0}

        def fake_get(session, url, params=None, timeout=None):
            endpoint = _endpoint(url, params)
            self.timed.append((endpoint, self.clock["now"]))
            self.sessions.append(session)
            status, body, headers = self._answer(endpoint, url, params)
            response = requests.Response()
            response.url = url
            response.status_code = status
            headers = dict(headers)
            if endpoint in self.release:
                # Real servers send it lower-case; lookups must not care.
                headers["x-uniprot-release"] = self.release[endpoint]
            response.headers = CaseInsensitiveDict(headers)
            response._content = json.dumps(body or {}).encode()
            return response

        def forbidden(*_args, **_kwargs):
            raise AssertionError("a UniProt request bypassed the session")

        monkeypatch.setattr(requests.Session, "get", fake_get)
        monkeypatch.setattr(requests, "get", forbidden)

    @property
    def sent(self) -> list[str]:
        return [endpoint for endpoint, _ in self.timed]

    def _answer(self, endpoint, url, params):
        answer = self.override.get(endpoint)
        if isinstance(answer, list) and answer:
            return answer.pop(0)
        if isinstance(answer, tuple):
            return answer
        if endpoint == "accessions":
            found = [self.active[a] for a in _queried(params) if a in self.active]
            return 200, {"results": found}, {}
        if endpoint == "search:accession":
            found = [
                {"primaryAccession": a, **self.inactive[a]}
                for a in _queried(params)
                if a in self.inactive
            ]
            return 200, {"results": found}, {}
        if endpoint == "search:upi":
            found = [
                {"uniParcId": upi, "sequence": {"value": self.uniparc[upi]}}
                for upi in _queried(params)
                if upi in self.uniparc
            ]
            return 200, {"results": found}, {}
        if endpoint == "search:sec_acc":
            return 200, {"results": []}, {}
        name = endpoint.removesuffix(".json")
        if name in self.uniparc:
            sequence = self.uniparc[name]
            return 200, {"sequence": {"value": sequence, "length": len(sequence)}}, {}
        if name in self.active:
            return 200, self.active[name], {}
        stub = self.inactive.get(name)
        if stub is None:
            return 404, None, {}
        reason = stub.get("inactiveReason", {})
        target = (reason.get("mergeDemergeTo") or [None])[0]
        if reason.get("inactiveReasonType") == "MERGED" and target in self.active:
            return 200, self.active[target], {}
        return 200, stub, {}

    def on_a_fake_clock(self, monkeypatch):
        """Take the retry backoff out: a wait advances ``clock`` instead."""
        from protspace.data.annotations.retrievers import http_utils

        clock = self.clock

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
        return self


def _deleted(uniparc_id: str | None = None) -> dict:
    return {
        "entryType": "Inactive",
        "inactiveReason": {
            "inactiveReasonType": "DELETED",
            "deletedReason": "Not part of a reference proteome",
        },
        "extraAttributes": {"uniParcId": uniparc_id} if uniparc_id else {},
    }


def _merged(target: str) -> dict:
    return {
        "entryType": "Inactive",
        "inactiveReason": {
            "inactiveReasonType": "MERGED",
            "mergeDemergeTo": [target],
        },
        "extraAttributes": {},
    }


class TestUniProtRelease:
    """The UniProtKB release travels in the X-UniProt-Release header of the
    responses the retriever already receives; no extra request is made."""

    @staticmethod
    def _serve(monkeypatch):
        """P01308 comes back from the batch endpoint; P99999 is a deleted
        entry the bulk search and UniParc search settle; Q88888 is unknown to
        the bulk search, so it is looked up on its own (404) and then by a
        secondary-accession search."""
        return _FakeUniProt(
            monkeypatch,
            active={"P01308": _make_mock_record("P01308")},
            inactive={"P99999": _deleted("UPI0000000001")},
            uniparc={"UPI0000000001": "MKV"},
        )

    def test_releases_are_collected_from_every_response(self, monkeypatch):
        uniprot = self._serve(monkeypatch)
        uniprot.release = {
            "accessions": "2026_03",
            "search:accession": "2026_02",
            "search:upi": "2026_01",
            "search:sec_acc": "2026_04",
        }
        retriever = UniProtRetriever(headers=["P01308", "P99999", "Q88888"])

        result = retriever.fetch_annotations()

        assert {r.identifier for r in result} == {"P01308", "P99999", "Q88888"}
        # Every path was exercised, and none made a request of its own.
        assert uniprot.sent == [
            "accessions",
            "search:accession",
            "Q88888.json",
            "search:sec_acc",
            "search:upi",
        ]
        assert retriever.releases == {
            "2026_01",
            "2026_02",
            "2026_03",
            "2026_04",
        }

    def test_every_request_goes_through_one_session(self, monkeypatch):
        """A new connection per request held UniProt to 208 entries a second;
        one session reaches 308 (about 31 min for Swiss-Prot)."""
        from protspace.data.annotations.retrievers.http_utils import PooledSession

        uniprot = self._serve(monkeypatch)
        uniprot.release = {"accessions": "2026_03"}
        retriever = UniProtRetriever(headers=["P01308", "P99999", "Q88888"])

        retriever.fetch_annotations()

        assert len(uniprot.sent) == 5
        assert len({id(session) for session in uniprot.sessions}) == 1
        assert isinstance(uniprot.sessions[0], PooledSession)
        assert retriever.releases == {"2026_03"}

    def test_no_release_header_leaves_the_set_empty(self, monkeypatch):
        self._serve(monkeypatch)
        retriever = UniProtRetriever(headers=["P01308", "P99999", "Q88888"])

        retriever.fetch_annotations()

        assert retriever.releases == set()

    def test_a_retriever_that_fetched_nothing_has_an_empty_set(self):
        assert UniProtRetriever(headers=["P01308"]).releases == set()


class TestUniProtRetryAfter:
    """A `Retry-After` on any UniProt response holds every later request of
    the fetch: the bulk inactive-entry requests, which retry, and the
    single-attempt lookups that resolve an inactive entry on its own, which
    raise at once, as before, but pass the pause on."""

    def test_a_retry_after_on_an_entry_lookup_holds_the_next_request(self, monkeypatch):
        uniprot = _FakeUniProt(
            monkeypatch, active={"P01308": _make_mock_record("P01308")}
        ).on_a_fake_clock(monkeypatch)
        uniprot.override["P99999.json"] = (429, None, {"Retry-After": "3"})

        rows = UniProtRetriever(headers=["P01308", "P99999"]).fetch_annotations()

        assert {row.identifier for row in rows} == {"P01308", "P99999"}
        # The secondary-accession search waits out the pause.
        assert uniprot.timed == [
            ("accessions", 0.0),
            ("search:accession", 0.0),
            ("P99999.json", 0.0),
            ("search:sec_acc", 3.0),
        ]

    def test_a_retry_after_on_a_uniparc_lookup_holds_the_next_request(
        self, monkeypatch
    ):
        uniprot = _FakeUniProt(
            monkeypatch,
            active={"P01308": _make_mock_record("P01308")},
            inactive={
                "P99999": _deleted("UPI0000000001"),
                "P99998": _deleted("UPI0000000002"),
            },
        ).on_a_fake_clock(monkeypatch)
        # The UniParc search knows neither id, so each is looked up alone.
        uniprot.override["UPI0000000001.json"] = (429, None, {"Retry-After": "2"})

        UniProtRetriever(headers=["P01308", "P99999", "P99998"]).fetch_annotations()

        assert uniprot.timed == [
            ("accessions", 0.0),
            ("search:accession", 0.0),
            ("search:upi", 0.0),
            ("UPI0000000001.json", 0.0),
            ("UPI0000000002.json", 2.0),
        ]

    def test_a_retry_after_on_the_bulk_search_holds_and_retries_it(self, monkeypatch):
        uniprot = _FakeUniProt(
            monkeypatch,
            active={"P01308": _make_mock_record("P01308")},
            inactive={"P99999": _deleted("UPI0000000001")},
            uniparc={"UPI0000000001": "MKV"},
        ).on_a_fake_clock(monkeypatch)
        uniprot.override["search:accession"] = [(429, None, {"Retry-After": "2"})]

        rows = UniProtRetriever(headers=["P01308", "P99999"]).fetch_annotations()

        assert {r.identifier: r.annotations["sequence"] for r in rows}[
            "P99999"
        ] == "MKV"
        assert uniprot.timed == [
            ("accessions", 0.0),
            ("search:accession", 0.0),
            ("search:accession", 2.0),
            ("search:upi", 2.0),
        ]


class TestBulkInactiveResolution:
    """A batch's inactive entries cost a bulk search, one fetch of the merge
    targets and one UniParc search, with the values the per-entry lookup
    gives them; whatever those leave unsettled is looked up on its own."""

    ACTIVE = {
        "P01308": _make_mock_record("P01308", protein_name="Insulin"),
        "Q076D1": _make_mock_record("Q076D1", protein_name="Crotastatin", length=77),
    }
    INACTIVE = {
        "A0A001": _deleted("UPI0000000001"),
        "A0A002": _merged("Q076D1"),
        "A0A003": _deleted(),  # no UniParc id: no sequence to recover
        "A0A004": _merged("Q99999"),  # target itself gone
    }
    UNIPARC = {"UPI0000000001": "MKVLAAGIV"}
    HEADERS = ["P01308", "A0A001", "A0A002", "A0A003", "A0A004", "A0A005"]

    def _serve(self, monkeypatch):
        return _FakeUniProt(
            monkeypatch,
            active=self.ACTIVE,
            inactive=self.INACTIVE,
            uniparc=self.UNIPARC,
        )

    def test_a_batch_costs_three_bulk_requests(self, monkeypatch):
        uniprot = self._serve(monkeypatch)
        retriever = UniProtRetriever(headers=self.HEADERS[:4])

        rows = {r.identifier: r.annotations for r in retriever.fetch_annotations()}

        assert uniprot.sent == [
            "accessions",
            "search:accession",
            "accessions",  # the merge targets
            "search:upi",
        ]
        assert rows["A0A002"]["protein_name"] == "Crotastatin"
        assert rows["A0A002"]["length"] == "77"
        assert rows["A0A001"]["sequence"] == "MKVLAAGIV"
        assert rows["A0A001"]["length"] == "9"
        assert rows["A0A001"]["protein_name"] == ""
        assert set(rows["A0A003"].values()) == {""}

    def test_only_what_the_bulk_requests_miss_is_looked_up_alone(self, monkeypatch):
        """An accession the search does not know is looked up alone (then by
        secondary accession), and so is a merge target the batch endpoint does
        not return; nothing else is."""
        uniprot = self._serve(monkeypatch)

        rows = {
            r.identifier: r.annotations
            for r in UniProtRetriever(headers=self.HEADERS).fetch_annotations()
        }

        singles = [e for e in uniprot.sent if e.endswith(".json") or "sec_acc" in e]
        assert singles == ["A0A005.json", "search:sec_acc", "Q99999.json"]
        # Merged into an entry that is gone too: deleted, like A0A005.
        assert set(rows["A0A004"].values()) == set(rows["A0A005"].values()) == {""}

    @pytest.mark.parametrize(
        "failing", ["search:accession", "accessions", "search:upi"]
    )
    def test_the_bulk_path_gives_the_per_entry_values(self, monkeypatch, failing):
        """Every value and count is the same whether the bulk requests answer
        or one of them fails and its accessions go one by one."""
        self._serve(monkeypatch)
        bulk = UniProtRetriever(headers=self.HEADERS)
        expected = {r.identifier: r.annotations for r in bulk.fetch_annotations()}

        uniprot = self._serve(monkeypatch)
        # The batch endpoint itself must still answer: only the call after
        # the batch fails.
        if failing == "accessions":
            batch = (200, {"results": [self.ACTIVE["P01308"]]}, {})
            uniprot.override["accessions"] = [batch, (400, None, {})]
        else:
            uniprot.override[failing] = (400, None, {})
        fallback = UniProtRetriever(headers=self.HEADERS)
        got = {r.identifier: r.annotations for r in fallback.fetch_annotations()}

        assert got == expected
        assert set(got) == set(self.HEADERS)

    def test_an_unreadable_record_does_not_fail_the_batch(self, monkeypatch):
        """Parsing ran inside each entry's own try before; one record that
        cannot be read must not mark the batch failed and append its proteins
        a second time, empty."""
        self._serve(monkeypatch)
        extract = UniProtRetriever._extract_annotations

        def picky(entry):
            if entry.entry == "Q076D1":
                raise TypeError("unexpected shape")
            return extract(entry)

        monkeypatch.setattr(
            UniProtRetriever, "_extract_annotations", staticmethod(picky)
        )
        retriever = UniProtRetriever(headers=self.HEADERS[:3])

        rows = retriever.fetch_annotations()

        assert [r.identifier for r in rows] == ["P01308", "A0A001", "A0A002"]
        assert retriever.failed_batch_count == 0
        assert rows[0].annotations["protein_name"] == "Insulin"
        # Merged into the unreadable entry: left unresolved, like a deleted one.
        assert set(rows[2].annotations.values()) == {""}

    def test_failed_bulk_requests_warn_once(self, monkeypatch, caplog):
        uniprot = self._serve(monkeypatch)
        batch = (200, {"results": [self.ACTIVE["P01308"]]}, {})
        uniprot.override["accessions"] = [batch, (400, None, {})]
        uniprot.override["search:accession"] = (400, None, {})
        uniprot.override["search:upi"] = (400, None, {})
        retriever = UniProtRetriever(headers=self.HEADERS)

        with caplog.at_level("WARNING"):
            retriever.fetch_annotations()

        bulk = [r for r in caplog.records if "bulk UniProt" in r.getMessage()]
        assert retriever.bulk_fallbacks == 3
        assert [r.getMessage() for r in bulk] == [
            "3 bulk UniProt lookups for inactive entries failed; those entries "
            "were looked up one by one"
        ]
