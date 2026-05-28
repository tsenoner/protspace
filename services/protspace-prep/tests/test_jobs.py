import asyncio
from pathlib import Path

import pytest
import structlog

from protspace_prep.jobs import (
    JobRegistry,
    JobStatus,
    PipelineFailure,
)


@pytest.fixture
def tmp_job_root(tmp_path: Path) -> Path:
    return tmp_path / "jobs"


async def _fake_pipeline_success(ctx, emit):
    await emit("embedding", {"current": 1, "total": 1})
    await emit("projecting", {})
    bundle = ctx.output_dir / "data.parquetbundle"
    bundle.parent.mkdir(parents=True, exist_ok=True)
    bundle.write_bytes(b"fake-bundle-bytes")
    return bundle


async def _fake_pipeline_failure(ctx, emit):
    await emit("embedding", {})
    raise PipelineFailure("Biocentral returned 503: unavailable")


async def test_submit_runs_pipeline_and_publishes_terminal_done(tmp_job_root):
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=2,
        pipeline=_fake_pipeline_success,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    events = []
    async for event in registry.subscribe(job_id):
        events.append(event)
    statuses = [e.event for e in events]
    assert statuses[0] == "queued"
    assert statuses[-1] == "done"
    state = registry.get(job_id)
    assert state.status is JobStatus.DONE
    assert state.bundle_path is not None
    assert state.bundle_path.read_bytes() == b"fake-bundle-bytes"


async def test_submit_runs_pipeline_and_publishes_terminal_error(tmp_job_root):
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=2,
        pipeline=_fake_pipeline_failure,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    events = [e async for e in registry.subscribe(job_id)]
    assert events[-1].event == "error"
    assert "Biocentral returned 503" in events[-1].data["message"]
    # The error event is self-describing so the user has a reportable reference.
    assert events[-1].data["job_id"] == job_id
    state = registry.get(job_id)
    assert state.status is JobStatus.ERROR


async def test_pipeline_runs_with_job_id_bound_in_contextvars(tmp_job_root):
    seen: dict[str, object] = {}

    async def _capture_context_pipeline(ctx, emit):
        seen.update(structlog.contextvars.get_contextvars())
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle

    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=_capture_context_pipeline,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    async for _ in registry.subscribe(job_id):
        pass
    # Every log line emitted during the job carries this job_id automatically.
    assert seen.get("job_id") == job_id


async def test_semaphore_caps_active_jobs(tmp_job_root):
    started = asyncio.Event()
    release = asyncio.Event()
    active = 0
    peak = 0

    async def slow_pipeline(ctx, emit):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        started.set()
        await release.wait()
        active -= 1
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle

    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=2,
        pipeline=slow_pipeline,
    )
    job_ids = [await registry.submit(b">i\nM\n", original_name="t.fasta") for _ in range(4)]
    await started.wait()
    await asyncio.sleep(0.05)
    assert peak == 2
    release.set()
    for job_id in job_ids:
        async for _ in registry.subscribe(job_id):
            pass
    assert peak == 2


async def test_multiple_concurrent_subscribers_each_receive_full_stream(tmp_job_root):
    release = asyncio.Event()

    async def gated_pipeline(ctx, emit):
        await emit("embedding", {})
        await release.wait()
        await emit("bundling", {})
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle

    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=gated_pipeline,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")

    async def collect():
        return [e async for e in registry.subscribe(job_id)]

    await asyncio.sleep(0.05)
    a = asyncio.create_task(collect())
    b = asyncio.create_task(collect())
    await asyncio.sleep(0.05)
    release.set()
    events_a, events_b = await asyncio.gather(a, b)
    stages_a = [e.event for e in events_a]
    stages_b = [e.event for e in events_b]
    assert stages_a[-1] == "done" and stages_b[-1] == "done"
    assert "progress" in stages_a and "progress" in stages_b


async def test_late_subscriber_receives_queued_then_terminal(tmp_job_root):
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=_fake_pipeline_success,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    async for _ in registry.subscribe(job_id):
        pass
    events = [e async for e in registry.subscribe(job_id)]
    assert len(events) == 2
    assert events[0].event == "queued"
    assert events[1].event in {"done", "error"}


async def test_get_returns_none_for_unknown_job(tmp_job_root):
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=_fake_pipeline_success,
    )
    assert registry.get("does-not-exist") is None


async def test_peek_bundle_and_mark_consumed(tmp_job_root):
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=_fake_pipeline_success,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    async for _ in registry.subscribe(job_id):
        pass
    path = registry.peek_bundle(job_id)
    assert path is not None and path.exists()
    registry.mark_consumed(job_id)
    assert registry.peek_bundle(job_id) is None


async def test_running_and_queued_counts(tmp_job_root):
    release = asyncio.Event()

    async def gated(ctx, emit):
        await release.wait()
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle

    registry = JobRegistry(job_root=tmp_job_root, max_concurrent=1, pipeline=gated)
    a = await registry.submit(b">a\nM\n", original_name="t.fasta")
    b = await registry.submit(b">b\nM\n", original_name="t.fasta")
    await asyncio.sleep(0.05)
    assert registry.counts() == {"running": 1, "queued": 1}
    release.set()
    async for _ in registry.subscribe(a): pass
    async for _ in registry.subscribe(b): pass
    assert registry.counts() == {"running": 0, "queued": 0}


async def test_sweep_removes_expired_directories(tmp_path):
    from protspace_prep.jobs import JobRegistry
    job_root = tmp_path / "jobs"
    registry = JobRegistry(
        job_root=job_root,
        max_concurrent=1,
        pipeline=lambda ctx, emit: _fake_pipeline_success(ctx, emit),
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    async for _ in registry.subscribe(job_id):
        pass
    import os, time
    job_dir = job_root / job_id
    past = time.time() - 10_000
    os.utime(job_dir, (past, past))

    removed = registry.sweep_expired(ttl_seconds=3600)
    assert job_id in removed
    assert not job_dir.exists()
    assert registry.get(job_id) is None


async def test_sweep_evicts_consumed_jobs_without_waiting_for_ttl(tmp_job_root):
    """A downloaded (consumed) job is reclaimed on the next sweep regardless of
    its directory mtime, freeing intermediate artifacts ahead of the TTL."""
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=_fake_pipeline_success,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    async for _ in registry.subscribe(job_id):
        pass
    job_dir = tmp_job_root / job_id
    assert job_dir.exists()

    registry.mark_consumed(job_id)
    # Directory mtime is fresh (within TTL); only the consumed flag drives eviction.
    removed = registry.sweep_expired(ttl_seconds=3600)
    assert job_id in removed
    assert registry.get(job_id) is None
    assert not job_dir.exists()


# ---------------------------------------------------------------------------
# §2.2 — queue_position + running in queued event
# ---------------------------------------------------------------------------

async def test_queued_event_includes_queue_position_and_running(tmp_job_root):
    gate = asyncio.Event()

    async def blocking_pipeline(ctx, emit):
        await gate.wait()
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle

    registry = JobRegistry(job_root=tmp_job_root, max_concurrent=1, pipeline=blocking_pipeline)
    job_id_a = await registry.submit(b">a\nM\n", original_name="a.fasta")
    job_id_b = await registry.submit(b">b\nM\n", original_name="b.fasta")
    # Let the tasks start so the semaphore is acquired by job A
    await asyncio.sleep(0.05)

    # Use direct state inspection — the queued event was published at submit time
    state_a = registry.get(job_id_a)
    state_b = registry.get(job_id_b)
    assert state_a.queue_position == 0
    assert state_b.queue_position == 1

    # Verify the queued event payload by subscribing to the late-subscriber path
    # (job A is running, so terminal_event may not be set yet; check job B which is queued)
    collected_b: list = []
    async def collect_b():
        async for e in registry.subscribe(job_id_b):
            collected_b.append(e)
            if e.event == "queued":
                break

    await asyncio.create_task(collect_b())
    queued_b = next(e for e in collected_b if e.event == "queued")
    assert queued_b.data["queue_position"] == 1
    assert "running" in queued_b.data

    gate.set()
    # Drain both jobs so tmp dirs are cleaned up
    async for _ in registry.subscribe(job_id_a): pass
    async for _ in registry.subscribe(job_id_b): pass


async def test_error_event_includes_code_when_pipeline_failure_has_code(tmp_job_root):
    async def coded_failure_pipeline(ctx, emit):
        raise PipelineFailure("nope", code="BIOCENTRAL_UNAVAILABLE")

    registry = JobRegistry(job_root=tmp_job_root, max_concurrent=1, pipeline=coded_failure_pipeline)
    job_id = await registry.submit(b">id\nM\n", original_name="t.fasta")
    events = [e async for e in registry.subscribe(job_id)]
    error_event = next(e for e in events if e.event == "error")
    assert error_event.data.get("code") == "BIOCENTRAL_UNAVAILABLE"


async def test_error_event_omits_code_when_pipeline_failure_has_no_code(tmp_job_root):
    async def plain_failure_pipeline(ctx, emit):
        raise PipelineFailure("nope")

    registry = JobRegistry(job_root=tmp_job_root, max_concurrent=1, pipeline=plain_failure_pipeline)
    job_id = await registry.submit(b">id\nM\n", original_name="t.fasta")
    events = [e async for e in registry.subscribe(job_id)]
    error_event = next(e for e in events if e.event == "error")
    assert "code" not in error_event.data


# ---------------------------------------------------------------------------
# Fix 3 — subscribe() race between yield queued and queue registration
# ---------------------------------------------------------------------------

async def test_subscribe_after_instant_pipeline_receives_done(tmp_job_root):
    """Submit with an instantly-terminating pipeline and subscribe immediately.

    Should reliably receive [queued, done] without hanging regardless of the
    race between pipeline completion and queue registration.
    """
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=4,
        pipeline=_fake_pipeline_success,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    # Give the task a chance to run (may already be done by here)
    await asyncio.sleep(0)
    events = [e async for e in registry.subscribe(job_id)]
    statuses = [e.event for e in events]
    assert statuses[0] == "queued"
    assert statuses[-1] in {"done", "error"}
    assert "done" in statuses


async def test_subscribe_race_repeated(tmp_job_root):
    """Stress test: run the instant-pipeline subscribe race many times."""
    for _ in range(20):
        registry = JobRegistry(
            job_root=tmp_job_root,
            max_concurrent=4,
            pipeline=_fake_pipeline_success,
        )
        job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
        # Yield control so the pipeline task can run
        await asyncio.sleep(0)
        events = [e async for e in registry.subscribe(job_id)]
        assert events[-1].event == "done", f"Expected done, got {[e.event for e in events]}"


# ---------------------------------------------------------------------------
# Fix 4 — Sweeper hangs live subscribers
# ---------------------------------------------------------------------------

async def test_sweep_notifies_live_subscriber(tmp_job_root):
    """A subscriber blocked on queue.get() must unblock when sweep_expired runs."""
    gate = asyncio.Event()

    async def gated_pipeline(ctx, emit):
        await gate.wait()
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle

    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=gated_pipeline,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")

    collected: list[str] = []

    async def consume():
        async for event in registry.subscribe(job_id):
            collected.append(event.event)

    consumer_task = asyncio.create_task(consume())
    # Let consumer register and block
    await asyncio.sleep(0.05)

    # Backdate the job directory so sweep_expired considers it expired
    import os, time
    job_dir = tmp_job_root / job_id
    past = time.time() - 10_000
    os.utime(job_dir, (past, past))

    registry.sweep_expired(ttl_seconds=3600)

    # Consumer should unblock (receive None sentinel) and finish promptly
    try:
        await asyncio.wait_for(consumer_task, timeout=1.0)
    except asyncio.TimeoutError:
        consumer_task.cancel()
        pytest.fail("Subscriber task hung after sweep_expired — sentinel not delivered")

    # Gate never released, so no done event; subscriber simply terminates on None
    assert "queued" in collected


# ---------------------------------------------------------------------------
# Fix 5 — _run() doesn't handle CancelledError
# ---------------------------------------------------------------------------

async def test_cancelled_job_publishes_error_event(tmp_job_root):
    """Cancelling a running job task must publish an error event and set ERROR status."""
    gate = asyncio.Event()

    async def gated_pipeline(ctx, emit):
        await gate.wait()
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle

    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        pipeline=gated_pipeline,
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")

    collected: list = []

    async def consume():
        async for event in registry.subscribe(job_id):
            collected.append(event)

    consumer_task = asyncio.create_task(consume())
    # Let the pipeline task start and block on gate
    await asyncio.sleep(0.05)

    # Cancel the pipeline task
    pipeline_task = registry._tasks[job_id]
    pipeline_task.cancel()

    # Consumer should receive the error event and finish
    try:
        await asyncio.wait_for(consumer_task, timeout=1.0)
    except asyncio.TimeoutError:
        consumer_task.cancel()
        pytest.fail("Subscriber did not receive error event after job cancellation")

    events = [e.event for e in collected]
    assert "error" in events, f"Expected error event, got {events}"
    error_data = next(e.data for e in collected if e.event == "error")
    assert "cancelled" in error_data.get("message", "").lower()

    state = registry.get(job_id)
    assert state is not None
    assert state.status is JobStatus.ERROR
