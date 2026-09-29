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


# TED fetches through the shared retry helper, so that is the seam to patch.
_REQUESTS_PATCH = (
    "src.protspace.data.annotations.retrievers.ted_retriever.get_with_retry"
)
_CATH_NAMES_PATCH = (
    "src.protspace.data.annotations.retrievers.ted_retriever.get_cath_names"
)


class TestTedRetriever:
    """Unit tests with mocked AlphaFold API."""

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_single_domain(self, mock_get, mock_cath_names):
        """Single domain with CATH name."""
        mock_cath_names.return_value = {"2.60.40.720": "Immunoglobulin-like"}
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("2.60.40.720", 95.1)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

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
    def test_multiple_domains(self, mock_get, mock_cath_names):
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
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["P04637"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        ted_value = result[0].annotations["ted_domains"]
        assert "2.60.40.720 (Immunoglobulin-like)|95.1" in ted_value
        assert "3.40.50.300 (P-loop NTPases)|88.3" in ted_value
        assert ";" in ted_value

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_no_domains(self, mock_get, mock_cath_names):
        """Protein with no domains returns empty string."""
        mock_cath_names.return_value = {}
        mock_resp = MagicMock()
        mock_resp.json.return_value = {}  # Empty response
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == ""

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_unlabeled_domain_preserves_ted_label(self, mock_get, mock_cath_names):
        """Domain with cath_label '-' keeps the TED source label."""
        mock_cath_names.return_value = {}
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("-", 90.5)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == "-|90.5"

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_unlabeled_domain_keeps_source_order_with_labeled_domains(
        self, mock_get, mock_cath_names
    ):
        """A mixed TED response keeps every domain in source order."""
        mock_cath_names.return_value = {}
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [
                _make_domain("3.40.50.2000", 94.1909),
                _make_domain("-", 96.7064),
                _make_domain("3.40.50.2000", 95.113),
            ]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["W6JQJ9"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert (
            result[0].annotations["ted_domains"]
            == "3.40.50.2000|94.2;-|96.7;3.40.50.2000|95.1"
        )

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_null_plddt_does_not_drop_the_other_domains(
        self, mock_get, mock_cath_names
    ):
        """A null pLDDT must not blank the whole accession via the outer except."""
        mock_cath_names.return_value = {}
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [
                _make_domain("3.40.50.2000", None),
                _make_domain("2.60.40.720", 88.25),
            ]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["W6JQJ9"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert (
            result[0].annotations["ted_domains"] == "3.40.50.2000|0.0;2.60.40.720|88.2"
        )

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_api_error_returns_empty(self, mock_get, mock_cath_names):
        """API error returns empty annotation."""
        mock_cath_names.return_value = {}
        mock_get.side_effect = Exception("Connection error")

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == ""
        assert retriever.failed_lookup_count == 1

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_unknown_accession_is_an_absence_not_a_failed_lookup(
        self, mock_get, mock_cath_names
    ):
        """A 404 is AlphaFold's normal answer for an accession it does not model.

        Counting it as a lost lookup would mark the whole TED source incomplete
        on any ordinary run — custom identifiers and unmodelled proteins both
        404 — and keep the column out of the annotation cache forever.
        """
        mock_cath_names.return_value = {}
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_resp.raise_for_status.side_effect = AssertionError(
            "a 404 must not be raised as a failure"
        )
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["NOT_IN_AFDB"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == ""
        assert retriever.failed_lookup_count == 0

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_cath_name_not_found(self, mock_get, mock_cath_names):
        """CATH code without a name shows code only."""
        mock_cath_names.return_value = {}  # No names
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("3.40.50.2300", 96.8)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert result[0].annotations["ted_domains"] == "3.40.50.2300|96.8"

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_partial_cath_code(self, mock_get, mock_cath_names):
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
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()

        assert (
            "2.60.40 (Immunoglobulin-like)|91.0" in result[0].annotations["ted_domains"]
        )

    @patch(_CATH_NAMES_PATCH)
    @patch(_REQUESTS_PATCH)
    def test_ted_name_with_semicolon_is_encoded(self, mock_get, mock_cath_names):
        """CATH domain names containing ';' must be percent-encoded by the real emit path.

        Regression guard for the `encode_field` wrap in `_format_domains`
        (ted_retriever.py): exercises the real fetch_annotations -> _format_domains
        -> _resolve_cath_name pipeline (with `get_cath_names` mocked to return a
        `;`-bearing name) rather than a hand-built string, so reverting the wrap
        (`f"{cath_label} ({name})|..."` instead of
        `f"{cath_label} ({encode_field(name)})|..."`) would make this test fail.
        """
        from protspace.data.annotations.encoding import decode_field, encode_field

        raw_name = "Immunoglobulin-like; Ig fold"
        mock_cath_names.return_value = {"2.60.40.720": raw_name}
        mock_resp = MagicMock()
        mock_resp.json.return_value = _make_alphafold_response(
            [_make_domain("2.60.40.720", 95.1)]
        )
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        retriever = TedRetriever(headers=["P01308"], annotations=TED_ANNOTATIONS)
        result = retriever.fetch_annotations()
        ted_value = result[0].annotations["ted_domains"]

        encoded_name = encode_field(raw_name)
        assert ted_value == f"2.60.40.720 ({encoded_name})|95.1"
        assert "%3B" in ted_value

        # No raw ';' survives inside the emitted cell (the reserved
        # domain-separator character), only its percent-encoded form.
        assert ";" not in ted_value

        # Decoding the emitted name restores the exact original (round-trip).
        name_in_parens = ted_value.split("(", 1)[1].rsplit(")", 1)[0]
        assert name_in_parens == encoded_name
        assert decode_field(name_in_parens) == raw_name


class TestTedConstants:
    def test_ted_annotations(self):
        assert TED_ANNOTATIONS == ["ted_domains"]


class _AlphaFoldDomains:
    """Stands in for ``get_with_retry`` against the AlphaFold domains API.

    *outcomes* maps an accession to the answers of its successive lookups:
    ``"ok"`` (one domain), ``"404"`` (unknown accession) or ``"fail"``
    (raises). The last answer repeats. Unlisted accessions answer ``"ok"``.
    """

    def __init__(self, outcomes=None):
        self.outcomes = outcomes or {}
        self.calls: list[tuple[str, int]] = []

    def __call__(self, url, timeout=None, attempts=None):
        accession = url.rsplit("/", 1)[-1]
        seen = sum(1 for acc, _ in self.calls if acc == accession)
        self.calls.append((accession, attempts))
        answers = self.outcomes.get(accession, ["ok"])
        answer = answers[min(seen, len(answers) - 1)]
        if answer == "fail":
            raise ConnectionError(f"AlphaFold unavailable for {accession}")
        response = MagicMock()
        response.status_code = 404 if answer == "404" else 200
        response.raise_for_status = MagicMock()
        response.json.return_value = _make_alphafold_response(
            [_make_domain("3.40.50.300", 88.3)]
        )
        return response


def _ted(headers, fake):
    retriever = TedRetriever(headers=headers, annotations=TED_ANNOTATIONS)
    with patch(_REQUESTS_PATCH, side_effect=fake), patch(_CATH_NAMES_PATCH) as names:
        names.return_value = {}
        rows = retriever.fetch_annotations()
    return retriever, rows


class TestFinalRetryPass:
    """TED is one request per accession, 18-40 h at Swiss-Prot scale. A lookup
    that failed its small first-pass budget used to discard the whole source;
    now failed lookups get one more try after every other accession."""

    def test_a_lookup_recovered_in_the_final_pass_is_used(self, caplog):
        fake = _AlphaFoldDomains({"Q9FAIL": ["fail", "ok"]})

        with caplog.at_level("WARNING"):
            retriever, rows = _ted(["Q9FAIL", "P01308"], fake)

        # Results keep the input order, with the recovered domains in place.
        assert [r.identifier for r in rows] == ["Q9FAIL", "P01308"]
        assert rows[0].annotations["ted_domains"] == "3.40.50.300|88.3"
        assert retriever.failed_lookup_count == 0
        assert [acc for acc, _ in fake.calls] == ["Q9FAIL", "P01308", "Q9FAIL"]
        assert "TED" not in caplog.text

    def test_a_lookup_failing_both_passes_counts_once_and_is_named(self, caplog):
        fake = _AlphaFoldDomains({"Q9FAIL": ["fail"], "Q9GOOD": ["fail", "ok"]})

        with caplog.at_level("WARNING"):
            retriever, rows = _ted(["Q9FAIL", "Q9GOOD", "P01308"], fake)

        assert retriever.failed_lookup_count == 1
        by_id = {r.identifier: r.annotations["ted_domains"] for r in rows}
        assert by_id == {
            "Q9FAIL": "",
            "Q9GOOD": "3.40.50.300|88.3",
            "P01308": "3.40.50.300|88.3",
        }
        warnings = [r for r in caplog.records if r.levelname == "WARNING"]
        assert len(warnings) == 1
        message = warnings[0].getMessage()
        assert "Q9FAIL" in message
        assert "recovered 1 of 2" in message
        assert "1 still failed" in message

    def test_the_final_pass_stops_after_ten_consecutive_failures(self):
        headers = [f"P{i:05d}" for i in range(15)]
        fake = _AlphaFoldDomains(dict.fromkeys(headers, ["fail"]))

        retriever, rows = _ted(headers, fake)

        # 15 first-pass lookups, then 10 final-pass attempts before giving up.
        assert len(fake.calls) == 15 + 10
        assert retriever.failed_lookup_count == 15
        assert all(r.annotations["ted_domains"] == "" for r in rows)

    def test_a_success_resets_the_consecutive_failure_count(self):
        down = [f"P{i:05d}" for i in range(9)]
        headers = [*down, "Q9BACK", *(f"Q{i:05d}" for i in range(9))]
        outcomes = dict.fromkeys(headers, ["fail"])
        outcomes["Q9BACK"] = ["fail", "ok"]
        fake = _AlphaFoldDomains(outcomes)

        retriever, _ = _ted(headers, fake)

        # 9 failures, a recovery, 9 more failures: never 10 in a row, so every
        # failed accession got its final-pass lookup.
        assert len(fake.calls) == 2 * len(headers)
        assert retriever.failed_lookup_count == len(headers) - 1

    def test_an_unknown_accession_is_not_retried(self):
        fake = _AlphaFoldDomains({"NOT_IN_AFDB": ["404"]})

        retriever, rows = _ted(["NOT_IN_AFDB"], fake)

        assert fake.calls == [("NOT_IN_AFDB", 2)]
        assert rows[0].annotations["ted_domains"] == ""
        assert retriever.failed_lookup_count == 0

    def test_the_first_pass_keeps_its_small_budget(self):
        from protspace.data.annotations.retrievers.http_utils import MAX_ATTEMPTS

        fake = _AlphaFoldDomains({"Q9FAIL": ["fail", "ok"]})

        _ted(["Q9FAIL", "P01308"], fake)

        assert fake.calls == [
            ("Q9FAIL", 2),
            ("P01308", 2),
            ("Q9FAIL", MAX_ATTEMPTS),
        ]
