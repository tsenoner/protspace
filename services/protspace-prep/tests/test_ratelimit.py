from types import SimpleNamespace

from protspace_prep.ratelimit import client_key


def _request(headers: dict, client_host: str | None):
    client = SimpleNamespace(host=client_host) if client_host else None
    return SimpleNamespace(headers=headers, client=client)


def test_client_key_uses_request_client_host():
    assert client_key(_request({}, "192.0.2.5")) == "192.0.2.5"


def test_client_key_ignores_spoofable_forwarded_for_header():
    req = _request({"x-forwarded-for": "203.0.113.7, 10.0.0.1"}, "10.0.0.1")
    assert client_key(req) == "10.0.0.1"


def test_client_key_unknown_when_no_peer():
    assert client_key(_request({}, None)) == "unknown"
