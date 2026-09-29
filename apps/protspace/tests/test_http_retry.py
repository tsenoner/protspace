"""Transient HTTP failures must not be recorded as permanent data gaps.

A Swiss-Prot-scale run fetches UniProt 100 accessions at a time, so a full run
is thousands of sequential requests. Callers treat a failed request as a batch
of proteins with no data, so an unretried blip costs real annotations.
"""

from unittest.mock import Mock

import pytest
import requests

from protspace.data.annotations.retrievers import http_utils


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
