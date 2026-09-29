"""Transient HTTP failures must not be recorded as permanent data gaps.

A Swiss-Prot-scale run fetches UniProt 100 accessions at a time, so a full run
is thousands of sequential requests. Callers treat a failed request as a batch
of proteins with no data, so an unretried blip costs real annotations.
"""

import random
import threading
import time
from unittest.mock import Mock

import pytest
import requests

from protspace.data.annotations.retrievers import http_utils

# The fixture below stubs `time.sleep` out; the concurrency tests need a real
# delay to shuffle the order in which parallel calls finish.
_real_sleep = time.sleep


@pytest.fixture(autouse=True)
def _no_sleeping(monkeypatch):
    monkeypatch.setattr(http_utils.time, "sleep", lambda _: None)


def _response(status: int, payload: dict | None = None, headers: dict | None = None):
    response = Mock(spec=requests.Response)
    response.status_code = status
    response.headers = headers or {}
    response.json.return_value = payload or {}
    response.raise_for_status.side_effect = (
        requests.HTTPError(f"{status}") if status >= 400 else None
    )
    return response


def test_a_transient_status_is_retried_until_it_succeeds(monkeypatch):
    responses = [
        _response(503),
        _response(502),
        _response(200, {"results": [{"a": 1}]}),
    ]
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return responses[len(calls) - 1]

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    assert http_utils.paginated_get("https://example.test/x") == [{"a": 1}]
    assert len(calls) == 3


def test_a_connection_error_is_retried(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        if len(calls) == 1:
            raise requests.ConnectionError("reset")
        return _response(200, {"results": []})

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    assert http_utils.paginated_get("https://example.test/x") == []
    assert len(calls) == 2


def test_a_client_error_is_not_retried(monkeypatch):
    """A bad accession does not become good by asking again."""
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return _response(400)

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    with pytest.raises(requests.HTTPError):
        http_utils.paginated_get("https://example.test/x")
    assert len(calls) == 1


def test_retries_are_bounded(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return _response(503)

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    with pytest.raises(requests.HTTPError):
        http_utils.paginated_get("https://example.test/x")
    assert len(calls) == http_utils.MAX_ATTEMPTS


def test_retry_after_header_is_honoured(monkeypatch):
    slept = []
    monkeypatch.setattr(http_utils.time, "sleep", slept.append)
    responses = [_response(429, headers={"Retry-After": "7"}), _response(200)]
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return responses[len(calls) - 1]

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    http_utils.paginated_get("https://example.test/x")
    assert slept == [7.0]


def test_an_absurd_retry_after_is_capped(monkeypatch):
    slept = []
    monkeypatch.setattr(http_utils.time, "sleep", slept.append)
    responses = [_response(429, headers={"Retry-After": "99999"}), _response(200)]
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return responses[len(calls) - 1]

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    http_utils.paginated_get("https://example.test/x")
    assert slept == [http_utils.MAX_BACKOFF_SECONDS]


class TestPostWithRetry:
    """A POST (InterPro's batched match lookup) gets the same retry policy."""

    @staticmethod
    def _serve(monkeypatch, *outcomes):
        """Answer successive POSTs with *outcomes*: a response or an exception."""
        calls = []

        def fake_post(url, json=None, headers=None, timeout=None):
            calls.append({"url": url, "json": json, "timeout": timeout})
            outcome = outcomes[len(calls) - 1]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr(http_utils.requests, "post", fake_post)
        return calls

    def test_a_transient_status_is_retried_until_it_succeeds(self, monkeypatch):
        calls = self._serve(
            monkeypatch, _response(503), _response(200, {"results": [{"a": 1}]})
        )

        response = http_utils.post_with_retry(
            "https://example.test/x", json={"md5": ["A"]}, timeout=30
        )

        assert response.json() == {"results": [{"a": 1}]}
        assert len(calls) == 2
        # Every attempt resends the same body with the caller's timeout.
        assert all(c["json"] == {"md5": ["A"]} and c["timeout"] == 30 for c in calls)

    def test_retry_after_header_is_honoured(self, monkeypatch):
        slept = []
        monkeypatch.setattr(http_utils.time, "sleep", slept.append)
        self._serve(
            monkeypatch, _response(429, headers={"Retry-After": "7"}), _response(200)
        )

        http_utils.post_with_retry("https://example.test/x", json={})

        assert slept == [7.0]

    def test_a_client_error_is_not_retried(self, monkeypatch):
        calls = self._serve(monkeypatch, _response(400), _response(200))

        with pytest.raises(requests.HTTPError):
            http_utils.post_with_retry("https://example.test/x", json={})
        assert len(calls) == 1

    def test_retries_are_bounded(self, monkeypatch):
        calls = self._serve(
            monkeypatch, *[_response(503)] * (http_utils.MAX_ATTEMPTS + 1)
        )

        with pytest.raises(requests.HTTPError):
            http_utils.post_with_retry("https://example.test/x", json={})
        assert len(calls) == http_utils.MAX_ATTEMPTS

    @pytest.mark.parametrize(
        "error",
        [
            requests.Timeout("slow"),
            requests.ConnectionError("reset"),
            requests.exceptions.ChunkedEncodingError("dropped mid-body"),
        ],
    )
    def test_a_network_error_is_retried(self, monkeypatch, error):
        calls = self._serve(monkeypatch, error, _response(200))

        assert http_utils.post_with_retry("https://example.test/x", json={})
        assert len(calls) == 2

    def test_a_network_error_on_every_attempt_is_raised(self, monkeypatch):
        calls = self._serve(
            monkeypatch,
            *[requests.Timeout("slow")] * http_utils.MAX_ATTEMPTS,
        )

        with pytest.raises(requests.Timeout):
            http_utils.post_with_retry("https://example.test/x", json={})
        assert len(calls) == http_utils.MAX_ATTEMPTS


def test_on_response_sees_every_page(monkeypatch):
    """Callers read response headers (UniProt's release) through this hook."""
    pages = [
        _response(
            200,
            {"results": [{"a": 1}]},
            headers={"Link": '<https://example.test/x?cursor=2>; rel="next"'},
        ),
        _response(200, {"results": [{"a": 2}]}),
    ]
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return pages[len(calls) - 1]

    monkeypatch.setattr(http_utils.requests, "get", fake_get)
    seen = []

    results = http_utils.paginated_get(
        "https://example.test/x", on_response=seen.append
    )

    assert results == [{"a": 1}, {"a": 2}]
    assert seen == pages


class TestSession:
    """A session reuses connections: opening one per request held TED to 7
    requests a second against 124 with one session and 8 in parallel."""

    @staticmethod
    def _session(monkeypatch, method, *outcomes):
        """A `PooledSession` answering successive *method* calls with *outcomes*,
        and module-level `requests` calls that fail the test."""
        session = http_utils.PooledSession(2)
        calls = []

        def fake(url, **kwargs):
            calls.append((url, kwargs))
            return outcomes[len(calls) - 1]

        def forbidden(*_args, **_kwargs):
            raise AssertionError("a request bypassed the session")

        monkeypatch.setattr(session, method, fake)
        monkeypatch.setattr(http_utils.requests, "get", forbidden)
        monkeypatch.setattr(http_utils.requests, "post", forbidden)
        return session, calls

    def test_get_with_retry_sends_through_the_session(self, monkeypatch):
        session, calls = self._session(
            monkeypatch, "get", _response(503), _response(200)
        )

        http_utils.get_with_retry(
            "https://example.test/x", params={"q": 1}, timeout=5, session=session
        )

        assert (
            calls
            == [("https://example.test/x", {"params": {"q": 1}, "timeout": 5})] * 2
        )

    def test_post_with_retry_sends_through_the_session(self, monkeypatch):
        session, calls = self._session(monkeypatch, "post", _response(200))

        http_utils.post_with_retry(
            "https://example.test/x",
            json={"md5": ["A"]},
            headers={"Accept": "application/json"},
            timeout=30,
            session=session,
        )

        assert calls == [
            (
                "https://example.test/x",
                {
                    "json": {"md5": ["A"]},
                    "headers": {"Accept": "application/json"},
                    "timeout": 30,
                },
            )
        ]

    def test_paginated_get_follows_pages_through_the_session(self, monkeypatch):
        session, calls = self._session(
            monkeypatch,
            "get",
            _response(
                200,
                {"results": [{"a": 1}]},
                headers={"Link": '<https://example.test/x?cursor=2>; rel="next"'},
            ),
            _response(200, {"results": [{"a": 2}]}),
        )

        results = http_utils.paginated_get("https://example.test/x", session=session)

        assert results == [{"a": 1}, {"a": 2}]
        assert [url for url, _ in calls] == [
            "https://example.test/x",
            "https://example.test/x?cursor=2",
        ]

    def test_the_pool_holds_a_connection_per_worker(self):
        session = http_utils.PooledSession(8)

        adapter = session.get_adapter("https://alphafold.ebi.ac.uk/api/domains/P1")
        assert adapter._pool_maxsize == 8

    def test_a_retry_after_pauses_every_request_on_the_session(self, monkeypatch):
        """Under concurrency one request's backoff would leave the other
        workers firing at a server that asked for a pause."""
        slept = []
        monkeypatch.setattr(http_utils.time, "sleep", slept.append)
        session, calls = self._session(
            monkeypatch,
            "get",
            _response(429, headers={"Retry-After": "5"}),
            _response(200),
            _response(200),
        )

        http_utils.get_with_retry("https://example.test/a", session=session)
        # With `sleep` stubbed no time passes, so this request starts while the
        # pause the first one received still holds: it waits too.
        http_utils.get_with_retry("https://example.test/b", session=session)

        assert len(calls) == 3
        assert slept == [pytest.approx(5.0, abs=0.5), pytest.approx(5.0, abs=0.5)]

    def test_a_backoff_without_retry_after_stays_with_its_request(self, monkeypatch):
        slept = []
        monkeypatch.setattr(http_utils.time, "sleep", slept.append)
        session, _ = self._session(
            monkeypatch, "get", _response(503), _response(200), _response(200)
        )

        http_utils.get_with_retry("https://example.test/a", session=session)
        http_utils.get_with_retry("https://example.test/b", session=session)

        assert slept == [http_utils.BACKOFF_BASE_SECONDS]


class TestMapInOrder:
    """TED at Swiss-Prot scale is 573K requests: they run a bounded number at a
    time, and their results come back in input order."""

    @staticmethod
    def _jittered(record=None):
        """A call that takes 0-3 ms, so parallel calls finish out of order."""
        lock = threading.Lock()
        state = {"active": 0, "peak": 0, "started": 0}

        def call(item):
            with lock:
                state["active"] += 1
                state["started"] += 1
                state["peak"] = max(state["peak"], state["active"])
            try:
                _real_sleep(random.Random(item).uniform(0, 0.003))
                return item * 2
            finally:
                with lock:
                    state["active"] -= 1

        return call, state

    @pytest.mark.parametrize("workers", [1, 4, 16])
    def test_results_keep_the_input_order(self, workers):
        call, _ = self._jittered()

        assert list(http_utils.map_in_order(call, range(300), workers)) == [
            i * 2 for i in range(300)
        ]

    def test_no_more_than_the_given_number_run_at_once(self):
        call, state = self._jittered()

        list(http_utils.map_in_order(call, range(300), 4))

        assert 1 < state["peak"] <= 4

    def test_submissions_stay_a_bounded_distance_ahead(self):
        """A 573K-accession run must not queue 573K requests up front."""
        call, state = self._jittered()
        workers = 4
        ahead = []

        for consumed, _ in enumerate(
            http_utils.map_in_order(call, range(200), workers)
        ):
            ahead.append(state["started"] - consumed)

        assert max(ahead) <= 2 * workers + 1

    def test_one_worker_runs_each_call_inline_when_its_result_is_needed(self):
        threads, seen = [], []

        def call(item):
            threads.append(threading.get_ident())
            seen.append(item)
            return item

        results = http_utils.map_in_order(call, range(5), 1)
        assert next(results) == 0
        assert seen == [0]
        assert list(results) == [1, 2, 3, 4]
        assert set(threads) == {threading.get_ident()}

    def test_closing_early_starts_nothing_more_and_leaves_nothing_running(self):
        """An outage breaker stops consuming; no request may outlive the fetch."""
        call, state = self._jittered()
        workers = 4

        results = http_utils.map_in_order(call, range(1000), workers)
        for _ in range(3):
            next(results)
        results.close()

        assert state["active"] == 0
        started = state["started"]
        assert started <= 3 + 2 * workers
        _real_sleep(0.02)
        assert state["started"] == started

    def test_an_error_raised_by_a_call_ends_the_iteration_at_its_item(self):
        call, state = self._jittered()

        def failing(item):
            if item == 5:
                raise ValueError("boom")
            return call(item)

        yielded = []
        with pytest.raises(ValueError, match="boom"):
            for value in http_utils.map_in_order(failing, range(100), 4):
                yielded.append(value)

        assert yielded == [0, 2, 4, 6, 8]
        assert state["active"] == 0
