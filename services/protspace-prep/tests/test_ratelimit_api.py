import pytest
from httpx import ASGITransport, AsyncClient

from protspace_prep.app import create_app


async def _fake_success(ctx, emit):
    out = ctx.output_dir / "data.parquetbundle"
    out.write_bytes(b"FAKE_BUNDLE")
    return out


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("PREP_JOB_ROOT", str(tmp_path / "jobs"))
    monkeypatch.setenv("PREP_SEQUENCE_MIN_COUNT", "1")

    def _build(client=("203.0.113.99", 12345)):
        app = create_app(pipeline=_fake_success)
        transport = ASGITransport(app=app, client=client)
        return AsyncClient(transport=transport, base_url="http://test")

    return _build


async def test_rate_limit_returns_429_after_threshold(make_client, monkeypatch):
    monkeypatch.setenv("PREP_RATE_LIMIT", "2/hour")
    files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
    async with make_client() as c:
        r1 = await c.post("/api/prepare", files=files)
        r2 = await c.post("/api/prepare", files=files)
        r3 = await c.post("/api/prepare", files=files)
    assert r1.status_code == 202
    assert r2.status_code == 202
    assert r3.status_code == 429


async def test_rate_limit_is_per_client_ip(make_client, monkeypatch):
    monkeypatch.setenv("PREP_RATE_LIMIT", "1/hour")
    files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
    async with make_client(client=("198.51.100.1", 11111)) as c:
        a1 = await c.post("/api/prepare", files=files)
        a2 = await c.post("/api/prepare", files=files)
    async with make_client(client=("198.51.100.2", 22222)) as c:
        b1 = await c.post("/api/prepare", files=files)
    assert a1.status_code == 202
    assert a2.status_code == 429
    assert b1.status_code == 202


async def test_rate_limit_ignores_spoofed_forwarded_for(make_client, monkeypatch):
    """A client cannot escape its bucket by varying X-Forwarded-For; the key is
    the ASGI peer, not the spoofable header."""
    monkeypatch.setenv("PREP_RATE_LIMIT", "1/hour")
    files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
    async with make_client(client=("198.51.100.5", 33333)) as c:
        r1 = await c.post("/api/prepare", files=files, headers={"X-Forwarded-For": "1.1.1.1"})
        r2 = await c.post("/api/prepare", files=files, headers={"X-Forwarded-For": "2.2.2.2"})
    assert r1.status_code == 202
    assert r2.status_code == 429


async def test_cors_preflight_allows_configured_origin(make_client, monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGIN", "https://protspace.app")
    async with make_client() as c:
        r = await c.options(
            "/api/prepare",
            headers={"Origin": "https://protspace.app", "Access-Control-Request-Method": "POST"},
        )
    assert r.headers.get("access-control-allow-origin") == "https://protspace.app"


async def test_cors_absent_for_unconfigured_origin(make_client, monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGIN", "https://protspace.app")
    async with make_client() as c:
        r = await c.options(
            "/api/prepare",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
        )
    assert r.headers.get("access-control-allow-origin") is None


async def test_rate_limit_429_carries_retry_after(make_client, monkeypatch):
    monkeypatch.setenv("PREP_RATE_LIMIT", "1/hour")
    files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
    async with make_client() as c:
        await c.post("/api/prepare", files=files)
        r = await c.post("/api/prepare", files=files)
    assert r.status_code == 429
    assert r.headers.get("retry-after") is not None
