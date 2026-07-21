from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from protspace_prep.api import _safe_download_name
from protspace_prep.app import create_app
from protspace_prep.jobs import JobContext, PipelineFailure


async def _fake_success(ctx: JobContext, emit) -> Path:
    await emit("embedding", {})
    await emit("bundling", {})
    out = ctx.output_dir / "data.parquetbundle"
    out.write_bytes(b"FAKE_BUNDLE")
    return out


async def _fake_failure(ctx: JobContext, emit) -> Path:
    await emit("embedding", {})
    raise PipelineFailure("Biocentral returned 503: nope")


@pytest.fixture
def app_factory(tmp_path, monkeypatch):
    monkeypatch.setenv("PREP_JOB_ROOT", str(tmp_path / "jobs"))
    # These tests exercise API plumbing with tiny fixtures, not the product
    # sequence-count floor; pin the minimum so they stay decoupled from it.
    monkeypatch.setenv("PREP_SEQUENCE_MIN_COUNT", "1")

    def _make(pipeline=_fake_success):
        return create_app(pipeline=pipeline)

    return _make


async def _client(app):
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_post_prepare_rejects_oversized_upload(app_factory, monkeypatch):
    monkeypatch.setenv("PREP_UPLOAD_MAX_BYTES", "10")
    app = app_factory()
    async with await _client(app) as c:
        files = {"file": ("seq.fasta", b">a\nMKTKTKTKTKT\n", "text/plain")}
        r = await c.post("/api/prepare", files=files)
    assert r.status_code == 400
    assert r.json()["code"] == "FILE_TOO_LARGE"


async def test_post_prepare_rejects_malformed(app_factory):
    app = app_factory()
    async with await _client(app) as c:
        files = {"file": ("seq.fasta", b"no header here\n", "text/plain")}
        r = await c.post("/api/prepare", files=files)
    assert r.status_code == 400
    assert r.json()["code"] == "MALFORMED_FASTA"


async def test_post_prepare_returns_job_id_and_sse_drives_to_done(app_factory):
    app = app_factory()
    async with await _client(app) as c:
        files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
        r = await c.post("/api/prepare", files=files)
        assert r.status_code == 202
        job_id = r.json()["job_id"]

        async with c.stream("GET", f"/api/prepare/{job_id}/events") as stream:
            assert stream.status_code == 200
            events = []
            async for chunk in stream.aiter_lines():
                if chunk.startswith("event: "):
                    events.append(chunk[len("event: ") :])
                if "event: done" in chunk or "event: error" in chunk:
                    pass
        assert "queued" in events
        assert "done" in events

        r = await c.get(f"/api/prepare/{job_id}/bundle")
        assert r.status_code == 200
        assert r.content == b"FAKE_BUNDLE"

        r = await c.get(f"/api/prepare/{job_id}/bundle")
        assert r.status_code == 410


async def test_failure_surfaces_error_event_and_no_download(app_factory):
    app = app_factory(pipeline=_fake_failure)
    async with await _client(app) as c:
        files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
        r = await c.post("/api/prepare", files=files)
        job_id = r.json()["job_id"]
        async with c.stream("GET", f"/api/prepare/{job_id}/events") as stream:
            text = "".join([chunk async for chunk in stream.aiter_text()])
        assert "event: error" in text
        assert "Biocentral returned 503" in text
        r = await c.get(f"/api/prepare/{job_id}/bundle")
        assert r.status_code == 409


async def test_unknown_job_id_returns_404(app_factory):
    app = app_factory()
    unknown = "0" * 32  # valid uuid4-hex shape, but never issued
    async with await _client(app) as c:
        r = await c.get(f"/api/prepare/{unknown}/events")
        assert r.status_code == 404
        r = await c.get(f"/api/prepare/{unknown}/bundle")
        assert r.status_code == 404


async def test_malformed_job_id_is_rejected_before_lookup(app_factory):
    """IDs that don't match the uuid4-hex shape are rejected with 422."""
    app = app_factory()
    async with await _client(app) as c:
        r = await c.get("/api/prepare/does-not-exist/events")
        assert r.status_code == 422
        r = await c.get("/api/prepare/does-not-exist/bundle")
        assert r.status_code == 422


async def test_healthz_reflects_running_jobs(app_factory):
    app = app_factory()
    async with await _client(app) as c:
        r = await c.get("/healthz")
        assert r.status_code == 200
        assert r.json()["jobs"] == {"running": 0, "queued": 0}


async def test_post_prepare_returns_503_when_queue_full(app_factory, monkeypatch):
    """When pending jobs hit the cap, the endpoint rejects with 503 + Retry-After."""
    import asyncio

    monkeypatch.setenv("PREP_MAX_CONCURRENT_JOBS", "1")
    monkeypatch.setenv("PREP_MAX_PENDING_JOBS", "1")
    gate = asyncio.Event()

    async def gated(ctx, emit):
        await gate.wait()
        out = ctx.output_dir / "data.parquetbundle"
        out.write_bytes(b"BUNDLE")
        return out

    app = app_factory(pipeline=gated)
    async with await _client(app) as c:
        files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
        r1 = await c.post("/api/prepare", files=files)
        assert r1.status_code == 202
        # First job occupies the single pending slot (running); second is over cap.
        r2 = await c.post("/api/prepare", files=files)
    assert r2.status_code == 503
    assert r2.headers.get("retry-after") == "30"
    gate.set()


# ---------------------------------------------------------------------------
# Fix 1 — Content-Disposition header injection
# ---------------------------------------------------------------------------


class TestSafeDownloadName:
    def test_normal_name(self):
        assert _safe_download_name("my_sequences.fasta") == "my_sequences.parquetbundle"

    def test_strips_extension(self):
        assert _safe_download_name("data.txt") == "data.parquetbundle"

    def test_hostile_double_quote(self):
        result = _safe_download_name('foo".bar')
        assert '"' not in result
        assert result.endswith(".parquetbundle")

    def test_hostile_crlf(self):
        result = _safe_download_name("evil\r\nX-Header: pwn")
        assert "\r" not in result
        assert "\n" not in result
        assert result.endswith(".parquetbundle")

    def test_empty_stem_falls_back_to_protspace(self):
        result = _safe_download_name(".fasta")
        assert result == "protspace.parquetbundle"

    def test_long_stem_is_capped(self):
        long_name = "a" * 200 + ".fasta"
        result = _safe_download_name(long_name)
        stem = result[: -len(".parquetbundle")]
        assert len(stem) <= 80

    def test_no_extension_input(self):
        result = _safe_download_name("myfile")
        assert result == "myfile.parquetbundle"


async def test_bundle_download_with_hostile_filename_produces_safe_header(app_factory):
    """End-to-end: upload a file with a hostile name; Content-Disposition must be clean."""
    app = app_factory()
    async with await _client(app) as c:
        hostile = 'evil"\r\nX-Injected: pwn'
        files = {"file": (hostile, b">P12345\nMKTAYIAK\n", "text/plain")}
        r = await c.post("/api/prepare", files=files)
        assert r.status_code == 202
        job_id = r.json()["job_id"]

        # Drain SSE to completion
        async with c.stream("GET", f"/api/prepare/{job_id}/events") as stream:
            async for chunk in stream.aiter_lines():
                if "done" in chunk or "error" in chunk:
                    pass

        r = await c.get(f"/api/prepare/{job_id}/bundle")
        assert r.status_code == 200

        cd = r.headers.get("content-disposition", "")
        assert (
            '"' not in cd.split("filename=", 1)[-1].lstrip('"').rstrip('"')
            or cd.count('"') == 2
        )
        assert "\r" not in cd
        assert "\n" not in cd
        assert "X-Injected" not in r.headers


# ---------------------------------------------------------------------------
# Fix 2 — SSE keep-alive frames
# ---------------------------------------------------------------------------


async def test_sse_keepalive_frame_emitted_on_slow_pipeline(app_factory, monkeypatch):
    """When no event arrives within the keepalive interval, a comment frame
    is sent — and the stream must keep flowing afterwards (regression: a prior
    implementation cancelled the in-flight `__anext__()` on each keepalive,
    exhausting the subscriber generator so the stream truncated silently).
    """
    import asyncio

    import protspace_prep.api as api_module

    # Speed up: use a very short keepalive interval so the test doesn't take 15s.
    monkeypatch.setattr(api_module, "_KEEPALIVE_INTERVAL_SECONDS", 0.05)

    gate = asyncio.Event()

    async def gated_pipeline(ctx, emit):
        # Hold long enough for several keepalive intervals to fire before we
        # produce a terminal event.
        await gate.wait()
        out = ctx.output_dir / "data.parquetbundle"
        out.write_bytes(b"BUNDLE")
        return out

    app = app_factory(pipeline=gated_pipeline)
    async with await _client(app) as c:
        files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
        r = await c.post("/api/prepare", files=files)
        assert r.status_code == 202
        job_id = r.json()["job_id"]

        # Release the gate after enough wall time for several keepalives
        # to fire, so the stream is exercised across the keepalive boundary.
        async def release_gate():
            await asyncio.sleep(0.3)
            gate.set()

        release_task = asyncio.create_task(release_gate())

        text = ""
        async with c.stream("GET", f"/api/prepare/{job_id}/events") as stream:
            async for chunk in stream.aiter_text():
                text += chunk

        await release_task

        assert ":\n\n" in text, "Expected at least one SSE keepalive comment frame"
        # The stream must keep delivering events after the keepalive — this
        # is the regression we're guarding against.
        assert "event: done" in text, (
            f"Stream truncated after keepalive — got:\n{text!r}"
        )
        # And the keepalive must come BEFORE the done event (i.e. the stream
        # really did wait through a keepalive interval before completing).
        assert text.index(":\n\n") < text.index("event: done")


# ---------------------------------------------------------------------------
# Fix 6 — bundle() marks consumed before read
# ---------------------------------------------------------------------------


async def test_bundle_expired_returns_410_and_does_not_consume(app_factory):
    """If the bundle file is missing when the download is requested, return 410.
    The consumed flag must not be set so the state is preserved for diagnostics."""
    app = app_factory()
    async with await _client(app) as c:
        files = {"file": ("seq.fasta", b">P12345\nMKTAYIAK\n", "text/plain")}
        r = await c.post("/api/prepare", files=files)
        assert r.status_code == 202
        job_id = r.json()["job_id"]

        async with c.stream("GET", f"/api/prepare/{job_id}/events") as stream:
            async for chunk in stream.aiter_lines():
                if "done" in chunk or "error" in chunk:
                    pass

        # Delete the bundle file to simulate expiry before download
        registry = app.state.registry
        state = registry.get(job_id)
        assert state is not None and state.bundle_path is not None
        state.bundle_path.unlink(missing_ok=True)

        r1 = await c.get(f"/api/prepare/{job_id}/bundle")
        assert r1.status_code == 410
        # consumed must not have been set
        assert not state.consumed
