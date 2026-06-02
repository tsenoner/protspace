from types import SimpleNamespace

from protspace_prep.ratelimit import client_key


def _request(headers: dict, client_host: str | None):
    client = SimpleNamespace(host=client_host) if client_host else None
    return SimpleNamespace(headers=headers, client=client)


def test_client_key_prefers_first_forwarded_for_hop():
    req = _request({"x-forwarded-for": "203.0.113.7, 10.0.0.1"}, "10.0.0.1")
    assert client_key(req) == "203.0.113.7"


def test_client_key_falls_back_to_peer():
    assert client_key(_request({}, "192.0.2.5")) == "192.0.2.5"


def test_client_key_unknown_when_no_peer():
    assert client_key(_request({}, None)) == "unknown"


def test_client_key_ignores_blank_forwarded_for():
    req = _request({"x-forwarded-for": "  "}, "192.0.2.5")
    assert client_key(req) == "192.0.2.5"
