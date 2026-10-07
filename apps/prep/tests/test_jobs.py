import asyncio
from pathlib import Path

import pytest
import structlog

from protspace_prep.jobs import (
    JobRegistry,
    JobStatus,
    PipelineFailure,
    QueueFull,
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
    # The job task copies the submitting request's context; it must not keep it.
    with structlog.contextvars.bound_contextvars(request_id="submitting-request"):
        job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    async for _ in registry.subscribe(job_id):
        pass
    # Every log line emitted during the job carries this job_id automatically,
    # and nothing inherited from the request that submitted it.
    assert seen == {"job_id": job_id}


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
    job_ids = [
        await registry.submit(b">i\nM\n", original_name="t.fasta") for _ in range(4)
    ]
    await started.wait()
    # Not a start barrier: give the other jobs time to (wrongly) start too.
    await asyncio.sleep(0.05)
    assert peak == 2
    release.set()
    for job_id in job_ids:
        async for _ in registry.subscribe(job_id):
            pass
    assert peak == 2


async def test_submit_rejects_when_pending_at_cap(tmp_job_root, gated_pipeline):
    """Once queued + running reaches max_pending, submit() raises QueueFull
    before writing any bytes or creating in-memory state."""
    # max_concurrent=1 so the second job stays queued; cap of 2 fills with
    # one running + one queued, and the third must be rejected.
    registry = JobRegistry(
        job_root=tmp_job_root,
        max_concurrent=1,
        max_pending=2,
        pipeline=gated_pipeline,
    )
    a = await registry.submit(b">a\nM\n", original_name="t.fasta")
    b = await registry.submit(b">b\nM\n", original_name="t.fasta")
    await gated_pipeline.started.wait()
    assert registry.counts() == {"running": 1, "queued": 1}

    with pytest.raises(QueueFull):
        await registry.submit(b">c\nM\n", original_name="t.fasta")
    # No job dir created for the rejected submission.
    assert len(list(tmp_job_root.iterdir())) == 2

    gated_pipeline.release.set()
    async for _ in registry.subscribe(a):
        pass
    async for _ in registry.subscribe(b):
        pass
    # Finished jobs give their slots back; a leak would 503 every later upload.
    assert registry.counts() == {"running": 0, "queued": 0}


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
    # Let both subscribers register before the job can finish.
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
    assert [e.event for e in events] == ["queued", "done"]
    # The replay is the job's real terminal event, not a stand-in.
    assert events[1].data == {"download_url": f"/api/prepare/{job_id}/bundle"}


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
    import os
    import time

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


async def test_queued_event_includes_queue_position_and_running(
    tmp_job_root, gated_pipeline
):
    registry = JobRegistry(
        job_root=tmp_job_root, max_concurrent=1, pipeline=gated_pipeline
    )
    job_id_a = await registry.submit(b">a\nM\n", original_name="a.fasta")
    job_id_b = await registry.submit(b">b\nM\n", original_name="b.fasta")
    # Job A holds the semaphore once it is inside the pipeline.
    await gated_pipeline.started.wait()

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

    gated_pipeline.release.set()
    # Drain both jobs so tmp dirs are cleaned up
    async for _ in registry.subscribe(job_id_a):
        pass
    async for _ in registry.subscribe(job_id_b):
        pass


async def test_error_event_includes_code_when_pipeline_failure_has_code(tmp_job_root):
    async def coded_failure_pipeline(ctx, emit):
        raise PipelineFailure("nope", code="BIOCENTRAL_UNAVAILABLE")

    registry = JobRegistry(
        job_root=tmp_job_root, max_concurrent=1, pipeline=coded_failure_pipeline
    )
    job_id = await registry.submit(b">id\nM\n", original_name="t.fasta")
    events = [e async for e in registry.subscribe(job_id)]
    error_event = next(e for e in events if e.event == "error")
    assert error_event.data.get("code") == "BIOCENTRAL_UNAVAILABLE"


async def test_error_event_omits_code_when_pipeline_failure_has_no_code(tmp_job_root):
    async def plain_failure_pipeline(ctx, emit):
        raise PipelineFailure("nope")

    registry = JobRegistry(
        job_root=tmp_job_root, max_concurrent=1, pipeline=plain_failure_pipeline
    )
    job_id = await registry.submit(b">id\nM\n", original_name="t.fasta")
    events = [e async for e in registry.subscribe(job_id)]
    error_event = next(e for e in events if e.event == "error")
    assert "code" not in error_event.data


async def test_unexpected_exception_publishes_generic_error(tmp_job_root):
    """A non-PipelineFailure crash ends the job with a generic message.

    prep-observability: the user gets "Internal server error." and a reference,
    never the exception text, and subscribers still receive a terminal event.
    """
    secret = "secret internal detail /srv/prep/jobs"

    async def crashing_pipeline(ctx, emit):
        await emit("embedding", {})
        raise RuntimeError(secret)

    registry = JobRegistry(
        job_root=tmp_job_root, max_concurrent=1, pipeline=crashing_pipeline
    )
    job_id = await registry.submit(b">id\nM\n", original_name="t.fasta")

    async def drain():
        return [e async for e in registry.subscribe(job_id)]

    # Bounded: without a terminal event the subscriber would wait forever.
    events = await asyncio.wait_for(drain(), timeout=5)
    assert events[-1].event == "error"
    assert events[-1].data == {"message": "Internal server error.", "job_id": job_id}
    assert all(secret not in str(e.data) for e in events)
    state = registry.get(job_id)
    assert state.status is JobStatus.ERROR
    assert state.error_message == "Internal server error."
    assert registry.counts() == {"running": 0, "queued": 0}


# ---------------------------------------------------------------------------
# Fix 3 — subscribe() race between yield queued and queue registration
# ---------------------------------------------------------------------------


async def test_subscriber_paused_after_queued_still_receives_done(tmp_job_root):
    """The pipeline finishing while a consumer sits between events is not lost.

    The SSE stream awaits between events, so the job can finish after the
    synthetic ``queued`` was yielded but before the next ``queue.get()``. Two
    guards cover that window: the subscriber queue is registered before the
    yield, and ``terminal_event`` is re-checked after it. Either one alone is
    enough, so this fails only when both are gone (``done`` is then published
    to nobody and the stream hangs). A pipeline that finishes before
    ``subscribe()`` takes the late-subscriber replay path instead, so this one
    is gated to stay open until ``queued`` has been consumed.
    """
    gate = asyncio.Event()

    async def gated_pipeline(ctx, emit):
        await gate.wait()
        return await _fake_pipeline_success(ctx, emit)

    registry = JobRegistry(
        job_root=tmp_job_root, max_concurrent=1, pipeline=gated_pipeline
    )
    job_id = await registry.submit(b">id\nMKT\n", original_name="t.fasta")
    events = registry.subscribe(job_id)
    assert (await events.__anext__()).event == "queued"

    gate.set()
    for _ in range(5):
        await asyncio.sleep(0)
    assert registry.get(job_id).status is JobStatus.DONE

    remaining = []
    while not remaining or remaining[-1] not in {"done", "error"}:
        remaining.append((await asyncio.wait_for(events.__anext__(), 1)).event)
    await events.aclose()
    assert remaining[-1] == "done"


# ---------------------------------------------------------------------------
# Fix 4 — Sweeper hangs live subscribers
# ---------------------------------------------------------------------------


async def test_sweep_notifies_live_subscriber(tmp_job_root, gated_pipeline):
    """A subscriber blocked on queue.get() must unblock when sweep_expired runs."""
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
    import os
    import time

    job_dir = tmp_job_root / job_id
    past = time.time() - 10_000
    os.utime(job_dir, (past, past))

    registry.sweep_expired(ttl_seconds=3600)

    # Consumer should unblock (receive None sentinel) and finish promptly
    try:
        await asyncio.wait_for(consumer_task, timeout=1.0)
    except TimeoutError:
        consumer_task.cancel()
        pytest.fail("Subscriber task hung after sweep_expired — sentinel not delivered")

    # Gate never released, so no done event; subscriber simply terminates on None
    assert "queued" in collected


# ---------------------------------------------------------------------------
# Fix 5 — _run() doesn't handle CancelledError
# ---------------------------------------------------------------------------


async def test_cancelled_job_publishes_error_event(tmp_job_root, gated_pipeline):
    """Cancelling a running job task must publish an error event and set ERROR status."""
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
    # Cancel once the pipeline is running and blocked on its gate.
    await gated_pipeline.started.wait()

    # Cancel the pipeline task
    pipeline_task = registry._tasks[job_id]
    pipeline_task.cancel()

    # Consumer should receive the error event and finish
    try:
        await asyncio.wait_for(consumer_task, timeout=1.0)
    except TimeoutError:
        consumer_task.cancel()
        pytest.fail("Subscriber did not receive error event after job cancellation")

    events = [e.event for e in collected]
    assert "error" in events, f"Expected error event, got {events}"
    error_data = next(e.data for e in collected if e.event == "error")
    assert "cancelled" in error_data.get("message", "").lower()

    state = registry.get(job_id)
    assert state is not None
    assert state.status is JobStatus.ERROR
