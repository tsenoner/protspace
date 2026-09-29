"""Transient HTTP failures must not be recorded as permanent data gaps.

A Swiss-Prot-scale run fetches UniProt 100 accessions at a time, so a full run
is thousands of sequential requests. Callers treat a failed request as a batch
of proteins with no data, so an unretried blip costs real annotations.
"""

import random
import threading
import time
from collections import Counter
from unittest.mock import Mock

import pytest
import requests

from protspace.data.annotations.retrievers import http_utils

# The fixture below replaces the clock `http_utils` sleeps on; the concurrency
# tests need a real delay to shuffle the order in which parallel calls finish.
_real_sleep = time.sleep
_real_wait = http_utils._sleep


class _FakeClock:
    """Stands in for `time` in `http_utils`: a sleep advances the clock at
    once instead of waiting, so a test can tell when each request went out."""

    def __init__(self):
        self.now = 0.0
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds

    def wait(self, seconds: float, stop: threading.Event | None = None) -> bool:
        """Stands in for `http_utils._sleep`: a stopped wait ends at once."""
        if stop is not None and stop.is_set():
            return True
        self.sleep(seconds)
        return stop is not None and stop.is_set()


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    fake = _FakeClock()
    monkeypatch.setattr(http_utils, "time", fake)
    # Looked up on every call, so a test may replace `fake.sleep`.
    monkeypatch.setattr(http_utils, "_sleep", lambda *args: fake.wait(*args))
    return fake


@pytest.fixture
def real_clock(monkeypatch):
    """Real time and real waits, for tests that stop a waiting thread."""
    monkeypatch.setattr(http_utils, "time", time)
    monkeypatch.setattr(http_utils, "_sleep", _real_wait)


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


def test_retry_after_header_is_honoured(monkeypatch, clock):
    responses = [_response(429, headers={"Retry-After": "7"}), _response(200)]
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return responses[len(calls) - 1]

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    http_utils.paginated_get("https://example.test/x")
    assert clock.slept == [7.0]


def test_an_absurd_retry_after_is_capped(monkeypatch, clock):
    responses = [_response(429, headers={"Retry-After": "99999"}), _response(200)]
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(url)
        return responses[len(calls) - 1]

    monkeypatch.setattr(http_utils.requests, "get", fake_get)

    http_utils.paginated_get("https://example.test/x")
    assert clock.slept == [http_utils.MAX_BACKOFF_SECONDS]


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

    def test_retry_after_header_is_honoured(self, monkeypatch, clock):
        self._serve(
            monkeypatch, _response(429, headers={"Retry-After": "7"}), _response(200)
        )

        http_utils.post_with_retry("https://example.test/x", json={})

        assert clock.slept == [7.0]

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
    def _session(monkeypatch, method, *outcomes, sent=None):
        """A `PooledSession` answering successive *method* calls with *outcomes*,
        and module-level `requests` calls that fail the test. *sent*, when
        given, receives the fake clock's time of each request."""
        session = http_utils.PooledSession(2)
        calls = []

        def fake(url, **kwargs):
            calls.append((url, kwargs))
            if sent is not None:
                sent.append(http_utils.time.monotonic())
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

    def test_a_retry_after_pauses_every_request_on_the_session(
        self, monkeypatch, clock
    ):
        """Under concurrency one request's backoff would leave the other
        workers firing at a server that asked for a pause."""
        sent = []
        session, _ = self._session(
            monkeypatch,
            "get",
            _response(429, headers={"Retry-After": "5"}),
            _response(200),
            sent=sent,
        )

        # One request is answered "come back in 5 s" and gives up.
        with pytest.raises(requests.HTTPError):
            http_utils.get_with_retry(
                "https://example.test/a", attempts=1, session=session
            )
        # A second later, another request on the session waits out the rest.
        clock.now += 1.0
        http_utils.get_with_retry("https://example.test/b", session=session)

        assert sent == [0.0, 5.0]

    def test_a_backoff_without_retry_after_stays_with_its_request(
        self, monkeypatch, clock
    ):
        session, _ = self._session(
            monkeypatch, "get", _response(503), _response(200), _response(200)
        )

        http_utils.get_with_retry("https://example.test/a", session=session)
        http_utils.get_with_retry("https://example.test/b", session=session)

        assert clock.slept == [http_utils.BACKOFF_BASE_SECONDS]

    def test_a_pause_extended_while_waiting_is_waited_out(self, monkeypatch, clock):
        """A request already waiting out one `Retry-After` must not wake at
        its old end when another request's `Retry-After` pushes it later."""
        sent = []
        session, _ = self._session(
            monkeypatch,
            "get",
            _response(429, headers={"Retry-After": "1"}),
            _response(200),
            sent=sent,
        )
        real_sleep = clock.sleep

        def sleep(seconds):
            if len(clock.slept) == 0:
                # Half a second into the wait, another request on the session
                # is told to come back in 3 s: the pause now ends at 3.5 s.
                clock.now += 0.5
                session.retry_after.extend(3.0)
                clock.now -= 0.5
            real_sleep(seconds)

        monkeypatch.setattr(clock, "sleep", sleep)

        http_utils.get_with_retry("https://example.test/a", session=session)

        assert sent == [0.0, pytest.approx(3.5)]

    def test_a_pause_extended_by_another_thread_holds_a_waiting_one(
        self, monkeypatch, real_clock
    ):
        """The same with real threads and a real clock: `b` is told to wait
        longer while `a` already waits, and `a` resends only after `b`'s
        pause."""
        session = http_utils.PooledSession(2)
        start = time.monotonic()
        sent: list[tuple[str, float]] = []
        answered = threading.Event()
        b_told_to_wait: list[float] = []

        def fake_get(url, **_kwargs):
            name = url.rsplit("/", 1)[-1]
            sent.append((name, time.monotonic() - start))
            tries = sum(1 for n, _ in sent if n == name)
            if tries > 1:
                return _response(200)
            if name == "a":
                answered.set()
                return _response(429, headers={"Retry-After": "0.1"})
            # b is answered while a waits out its 0.1 s pause.
            answered.wait(1)
            _real_sleep(0.05)
            b_told_to_wait.append(time.monotonic() - start)
            return _response(429, headers={"Retry-After": "0.4"})

        monkeypatch.setattr(session, "get", fake_get)
        b = threading.Thread(
            target=http_utils.get_with_retry,
            args=("https://example.test/b",),
            kwargs={"session": session},
        )
        b.start()
        http_utils.get_with_retry("https://example.test/a", session=session)
        b.join()

        a_resent = [t for n, t in sent if n == "a"][1]
        # a's own pause ended at 0.1 s; b's, which a must honour too, 0.4 s
        # after b was answered (about 0.45 s).
        assert a_resent >= b_told_to_wait[0] + 0.39

    def test_a_stopped_session_sends_nothing(self, monkeypatch):
        session, calls = self._session(monkeypatch, "get", _response(200))
        session.stop.set()

        with pytest.raises(http_utils.FetchStopped):
            http_utils.get_with_retry("https://example.test/x", session=session)
        assert calls == []

    @pytest.mark.parametrize(
        "headers", [{}, {"Retry-After": "30"}], ids=["backoff", "retry-after"]
    )
    def test_stopping_the_session_ends_a_wait_between_attempts(
        self, monkeypatch, real_clock, headers
    ):
        """A tripped breaker or an interrupt must not wait out the retry
        budget of a request whose result is no longer wanted: it gives up
        with the error of the attempt it made."""
        session = http_utils.PooledSession(2)
        answered = threading.Event()
        calls = []

        def fake_get(url, **_kwargs):
            calls.append(url)
            answered.set()
            return _response(503, headers=headers)

        monkeypatch.setattr(session, "get", fake_get)
        outcome = {}

        def fetch():
            started = time.monotonic()
            try:
                http_utils.get_with_retry("https://example.test/x", session=session)
            except requests.HTTPError as exc:
                outcome["error"] = exc
            outcome["took"] = time.monotonic() - started

        thread = threading.Thread(target=fetch)
        thread.start()
        assert answered.wait(1)
        session.stop.set()
        thread.join(2)

        assert not thread.is_alive()
        assert len(calls) == 1
        assert "503" in str(outcome["error"])
        # Not the 1 s backoff or 30 s pause, let alone the attempts after it.
        assert outcome["took"] < 0.5


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

    def test_closing_early_sets_stop(self):
        call, _ = self._jittered()
        stop = threading.Event()

        results = http_utils.map_in_order(call, range(100), 4, stop=stop)
        next(results)
        assert not stop.is_set()
        results.close()

        assert stop.is_set()

    def test_running_to_the_end_leaves_stop_clear(self):
        call, _ = self._jittered()
        stop = threading.Event()

        list(http_utils.map_in_order(call, range(50), 4, stop=stop))

        assert not stop.is_set()

    @pytest.mark.parametrize("workers", [1, 4])
    def test_an_interrupt_sets_stop(self, workers):
        stop = threading.Event()

        def call(item):
            if item == 3:
                raise KeyboardInterrupt
            return item

        with pytest.raises(KeyboardInterrupt):
            list(http_utils.map_in_order(call, range(10), workers, stop=stop))
        assert stop.is_set()

    def test_closing_early_releases_calls_waiting_to_retry(
        self, monkeypatch, real_clock
    ):
        """When a breaker closes the iteration, the calls still running give
        up after the attempt they made instead of spending their retry budget
        (1 + 2 + 4 s here) on results nobody will read."""
        session = http_utils.PooledSession(4)
        calls = Counter()
        lock = threading.Lock()

        def fake_get(url, **_kwargs):
            with lock:
                calls[url] += 1
            return _response(200 if url.endswith("/0") else 503)

        monkeypatch.setattr(session, "get", fake_get)
        results = http_utils.map_in_order(
            lambda i: http_utils.get_with_retry(
                f"https://example.test/{i}", session=session
            ),
            range(100),
            4,
            stop=session.stop,
        )

        next(results)
        started = time.monotonic()
        results.close()

        assert time.monotonic() - started < 0.5
        assert set(calls.values()) == {1}

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
