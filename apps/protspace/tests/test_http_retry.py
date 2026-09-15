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
