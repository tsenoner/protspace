"""Tests for TED domain retriever."""

import random
import threading
import time
import zlib
from collections import Counter
from unittest.mock import MagicMock, patch

import pytest

from src.protspace.data.annotations.retrievers.ted_retriever import (
    MAX_CONCURRENT_REQUESTS,
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

    Safe to call from parallel lookups. With *jitter*, each call takes up to
    that many seconds, so parallel lookups finish out of order; with
    *distinct*, each accession gets a domain of its own, so a value landing
    on the wrong protein shows.
    """

    def __init__(self, outcomes=None, jitter=0.0, distinct=False):
        self.outcomes = outcomes or {}
        self.jitter = jitter
        self.distinct = distinct
        self.calls: list[tuple[str, int]] = []
        self.sessions: set[int] = set()
        self.active = 0
        self.peak = 0
        self._lock = threading.Lock()

    def __call__(self, url, timeout=None, attempts=None, session=None):
        accession = url.rsplit("/", 1)[-1]
        with self._lock:
            seen = sum(1 for acc, _ in self.calls if acc == accession)
            self.calls.append((accession, attempts))
            self.sessions.add(id(session))
            self.active += 1
            self.peak = max(self.peak, self.active)
        try:
            if self.jitter:
                time.sleep(random.Random(f"{accession}{seen}").uniform(0, self.jitter))
            answers = self.outcomes.get(accession, ["ok"])
            answer = answers[min(seen, len(answers) - 1)]
            if answer == "fail":
                raise ConnectionError(f"AlphaFold unavailable for {accession}")
            response = MagicMock()
            response.status_code = 404 if answer == "404" else 200
            response.raise_for_status = MagicMock()
            plddt = (
                zlib.crc32(accession.encode()) % 1000 / 10 if self.distinct else 88.3
            )
            response.json.return_value = _make_alphafold_response(
                [_make_domain("3.40.50.300", plddt)]
            )
            return response
        finally:
            with self._lock:
                self.active -= 1


def _ted(headers, fake, **kwargs):
    retriever = TedRetriever(headers=headers, annotations=TED_ANNOTATIONS, **kwargs)
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
        # Two first-pass lookups, in either order when they run in parallel,
        # then the final pass.
        assert Counter(acc for acc, _ in fake.calls[:2]) == {"Q9FAIL": 1, "P01308": 1}
        assert [acc for acc, _ in fake.calls[2:]] == ["Q9FAIL"]
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

        retriever, rows = _ted(headers, fake, max_concurrent_requests=1)

        # 15 first-pass lookups, then 10 final-pass attempts before giving up.
        assert len(fake.calls) == 15 + 10
        assert retriever.failed_lookup_count == 15
        assert all(r.annotations["ted_domains"] == "" for r in rows)

    @pytest.mark.parametrize("workers", [4, 8, 16])
    def test_the_breaker_bounds_a_parallel_final_pass(self, workers):
        """The failures in a row are counted in input order, so the pass stops
        after the same 10 as one lookup at a time; only the lookups already
        submitted ahead, at most two per worker, still go out."""
        headers = [f"P{i:05d}" for i in range(100)]
        fake = _AlphaFoldDomains(dict.fromkeys(headers, ["fail"]), jitter=0.002)

        retriever, rows = _ted(headers, fake, max_concurrent_requests=workers)

        final_pass = len(fake.calls) - len(headers)
        assert 10 <= final_pass <= 10 + 2 * workers
        assert retriever.failed_lookup_count == len(headers)
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

        assert sorted(fake.calls[:2]) == [("P01308", 2), ("Q9FAIL", 2)]
        assert fake.calls[2:] == [("Q9FAIL", MAX_ATTEMPTS)]


class TestStoppingInFlightLookups:
    """Final-pass lookups still retrying when the breaker trips give up after
    the attempt they made: with a 10 s timeout and four attempts, each could
    otherwise hold the fetch for most of a minute."""

    def test_a_tripped_final_pass_breaker_stops_the_lookups_in_flight(
        self, monkeypatch
    ):
        import requests

        from protspace.data.annotations.retrievers import http_utils

        headers = [f"P{i:05d}" for i in range(40)]
        calls = Counter()
        lock = threading.Lock()
        serving = threading.local()
        # The tenth final-pass lookup is answered only once a later one is
        # backing off, so the breaker always trips with a lookup still retrying.
        later_backing_off = threading.Event()

        def fake_get(session, url, params=None, timeout=None):
            accession = url.rsplit("/", 1)[-1]
            with lock:
                calls[accession] += 1
                serving.accession, serving.tries = accession, calls[accession]
            if accession == headers[9] and serving.tries == 3:
                later_backing_off.wait(2)
            raise requests.ConnectionError(f"AlphaFold unavailable for {accession}")

        def backoff(_seconds, stop=None):
            # The first pass (tries 1-2) and the ten final-pass lookups that
            # trip the breaker back off at once; later final-pass lookups wait
            # 5 s unless the fetch is stopped.
            if serving.tries <= 2 or serving.accession in headers[:10]:
                return stop.is_set()
            later_backing_off.set()
            return stop.wait(5)

        monkeypatch.setattr(requests.Session, "get", fake_get)
        monkeypatch.setattr(http_utils, "_sleep", backoff)
        retriever = TedRetriever(headers=headers, annotations=TED_ANNOTATIONS)

        started = time.monotonic()
        with patch(_CATH_NAMES_PATCH, return_value={}):
            retriever.fetch_annotations()

        assert time.monotonic() - started < 2
        assert retriever.failed_lookup_count == len(headers)
        final_pass = {acc: calls[acc] - 2 for acc in headers}
        assert all(final_pass[acc] == http_utils.MAX_ATTEMPTS for acc in headers[:10])
        later = [n for acc, n in final_pass.items() if acc not in headers[:10]]
        # Each later lookup was either never sent or gave up after one attempt.
        assert set(later) <= {0, 1} and 1 in later


class TestParallelLookups:
    """One request at a time over a new connection each took TED about 23 h
    for Swiss-Prot. Parallel lookups over one session must give exactly the
    values, order and failure count of one lookup at a time."""

    @staticmethod
    def _outcomes(headers):
        """A mix: lookups recovered in the final pass, lookups that fail both
        passes (never 10 in a row) and accessions AlphaFold does not know."""
        outcomes = {}
        for i, accession in enumerate(headers):
            if i % 13 == 0:
                outcomes[accession] = ["fail"]
            elif i % 7 == 0:
                outcomes[accession] = ["fail", "ok"]
            elif i % 11 == 0:
                outcomes[accession] = ["404"]
        return outcomes

    @staticmethod
    def _run(headers, workers):
        fake = _AlphaFoldDomains(
            TestParallelLookups._outcomes(headers), jitter=0.002, distinct=True
        )
        retriever, rows = _ted(headers, fake, max_concurrent_requests=workers)
        return fake, retriever, rows

    def test_parallel_lookups_give_the_values_of_one_at_a_time(self):
        headers = [f"Q{i:05d}" for i in range(300)]
        _, sequential, expected = self._run(headers, 1)
        assert sequential.failed_lookup_count == 24  # multiples of 13

        for workers in (8, 16):
            _, parallel, rows = self._run(headers, workers)

            assert rows == expected
            assert parallel.failed_lookup_count == sequential.failed_lookup_count

    def test_by_default_eight_lookups_share_one_session(self):
        from protspace.data.annotations.retrievers.http_utils import PooledSession

        headers = [f"Q{i:05d}" for i in range(200)]
        sessions = []

        def spy(url, timeout=None, attempts=None, session=None):
            sessions.append(session)
            return fake(url, timeout=timeout, attempts=attempts, session=session)

        fake = _AlphaFoldDomains(jitter=0.003)
        _ted(headers, spy)

        assert MAX_CONCURRENT_REQUESTS == 8
        assert 1 < fake.peak <= MAX_CONCURRENT_REQUESTS
        assert len(fake.sessions) == 1
        assert isinstance(sessions[0], PooledSession)

    def test_parallel_lookups_load_the_cath_names_once(self):
        loads = []

        def slow_names():
            loads.append(1)
            time.sleep(0.01)
            return {"3.40.50.300": "P-loop NTPases"}

        headers = [f"Q{i:05d}" for i in range(50)]
        retriever = TedRetriever(headers=headers, annotations=TED_ANNOTATIONS)
        with (
            patch(_REQUESTS_PATCH, side_effect=_AlphaFoldDomains(jitter=0.001)),
            patch(_CATH_NAMES_PATCH, side_effect=slow_names),
        ):
            rows = retriever.fetch_annotations()

        assert len(loads) == 1
        assert {r.annotations["ted_domains"] for r in rows} == {
            "3.40.50.300 (P-loop NTPases)|88.3"
        }
