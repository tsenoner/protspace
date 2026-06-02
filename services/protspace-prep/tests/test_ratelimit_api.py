import pytest
from httpx import ASGITransport, AsyncClient

from protspace_prep.app import create_app


async def _fake_success(ctx, emit):
    out = ctx.output_dir / "data.parquetbundle"
    out.write_bytes(b"FAKE_BUNDLE")
    return out


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    # Env vars (PREP_RATE_LIMIT, CORS_ALLOWED_ORIGIN) must be set by each test
    # BEFORE calling _build(), because load_settings() reads env at create_app time.
    monkeypatch.setenv("PREP_JOB_ROOT", str(tmp_path / "jobs"))
    monkeypatch.setenv("PREP_SEQUENCE_MIN_COUNT", "1")

    def _build():
        app = create_app(pipeline=_fake_success)
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    return _build


async def test_rate_limit_returns_429_after_threshold(make_client, monkeypatch):
    monkeypatch.setenv("PREP_RATE_LIMIT", "2/hour")
    files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
    headers = {"X-Forwarded-For": "203.0.113.99"}
    async with make_client() as c:
        r1 = await c.post("/api/prepare", files=files, headers=headers)
        r2 = await c.post("/api/prepare", files=files, headers=headers)
        r3 = await c.post("/api/prepare", files=files, headers=headers)
    assert r1.status_code == 202
    assert r2.status_code == 202
    assert r3.status_code == 429


async def test_rate_limit_is_per_client_ip(make_client, monkeypatch):
    monkeypatch.setenv("PREP_RATE_LIMIT", "1/hour")
    files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
    async with make_client() as c:
        a1 = await c.post("/api/prepare", files=files, headers={"X-Forwarded-For": "198.51.100.1"})
        a2 = await c.post("/api/prepare", files=files, headers={"X-Forwarded-For": "198.51.100.1"})
        b1 = await c.post("/api/prepare", files=files, headers={"X-Forwarded-For": "198.51.100.2"})
    assert a1.status_code == 202
    assert a2.status_code == 429
    assert b1.status_code == 202


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
    headers = {"X-Forwarded-For": "203.0.113.1"}
    async with make_client() as c:
        await c.post("/api/prepare", files=files, headers=headers)
        r = await c.post("/api/prepare", files=files, headers=headers)
    assert r.status_code == 429
    assert r.headers.get("retry-after") is not None
