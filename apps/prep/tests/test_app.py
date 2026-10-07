import asyncio
import os
import time

from protspace_prep.app import create_app


async def test_healthz_reports_ok_and_zero_jobs(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["jobs"] == {"running": 0, "queued": 0}


async def test_lifespan_sweeper_removes_expired_job_dirs(tmp_path, monkeypatch):
    """The background sweeper enforces the published two-hour retention.

    httpx's ASGITransport never runs the lifespan, so drive it directly. The
    interval is parsed with int(), so 1s is the shortest the loop can run.
    """
    job_root = tmp_path / "jobs"
    monkeypatch.setenv("PREP_JOB_ROOT", str(job_root))
    monkeypatch.setenv("PREP_SWEEP_INTERVAL_SECONDS", "1")
    app = create_app()
    ttl = app.state.settings.bundle_ttl_seconds

    expired = job_root / "expired"
    fresh = job_root / "fresh"
    expired.mkdir()
    fresh.mkdir()
    past = time.time() - ttl - 60
    os.utime(expired, (past, past))

    async with app.router.lifespan_context(app):
        deadline = time.monotonic() + 3
        while expired.exists() and time.monotonic() < deadline:
            await asyncio.sleep(0.05)

    assert not expired.exists()
    # A job younger than the TTL survives, so the sweep honours the TTL.
    assert fresh.exists()
