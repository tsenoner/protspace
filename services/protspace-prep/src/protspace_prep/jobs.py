from __future__ import annotations
import asyncio
import enum
import logging
import shutil
import time
import uuid

import structlog
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

logger = logging.getLogger("protspace_prep.jobs")


class PipelineFailure(Exception):
    """Raised by the pipeline coroutine to surface a user-visible error.

    ``str(exc)`` is the curated, user-facing message. ``detail`` holds raw
    diagnostic output (e.g. subprocess stderr) for server-side logs and failure
    classification; it is never returned to the user.
    """

    def __init__(
        self, message: str, *, code: str | None = None, detail: str | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.detail = detail


class QueueFull(Exception):
    """Raised by ``submit()`` when pending jobs are at the configured ceiling.

    Caps *submission* (not just execution): every accepted upload writes to disk
    and creates permanent in-memory state, so an unbounded enqueue is a DoS vector
    even though the semaphore caps concurrency.
    """


class JobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


@dataclass
class Event:
    event: str  # "queued" | "progress" | "done" | "error"
    data: dict[str, Any]


@dataclass
class JobContext:
    job_id: str
    fasta_path: Path
    output_dir: Path
    original_name: str


@dataclass
class JobState:
    id: str
    status: JobStatus
    original_name: str
    fasta_path: Path
    output_dir: Path
    bundle_path: Optional[Path] = None
    error_message: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    ready_at: Optional[float] = None
    consumed: bool = False
    terminal_event: Optional[Event] = None
    queue_position: int = 0


PipelineFn = Callable[
    [JobContext, Callable[[str, dict[str, Any]], Awaitable[None]]],
    Awaitable[Path],
]


class JobRegistry:
    def __init__(
        self,
        *,
        job_root: Path,
        max_concurrent: int,
        pipeline: PipelineFn,
        max_pending: int = 50,
    ) -> None:
        self._job_root = job_root
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._max_pending = max_pending
        self._pipeline = pipeline
        self._jobs: dict[str, JobState] = {}
        self._subscribers: dict[str, list[asyncio.Queue[Optional[Event]]]] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._running = 0
        self._queued = 0

    def get(self, job_id: str) -> Optional[JobState]:
        return self._jobs.get(job_id)

    def counts(self) -> dict[str, int]:
        return {"running": self._running, "queued": self._queued}

    async def submit(self, fasta_bytes: bytes, *, original_name: str) -> str:
        # Reject before touching disk or creating in-memory state, so a flood of
        # submissions can't accumulate artifacts past the configured ceiling.
        if self._queued + self._running >= self._max_pending:
            raise QueueFull()
        job_id = uuid.uuid4().hex
        job_dir = self._job_root / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        fasta_path = job_dir / "input.fasta"
        fasta_path.write_bytes(fasta_bytes)
        state = JobState(
            id=job_id,
            status=JobStatus.QUEUED,
            original_name=original_name,
            fasta_path=fasta_path,
            output_dir=job_dir,
        )
        queue_position = self._queued
        running = self._running
        state.queue_position = queue_position
        self._jobs[job_id] = state
        self._subscribers[job_id] = []
        self._queued += 1
        await self._publish(
            job_id,
            Event("queued", {"job_id": job_id, "queue_position": queue_position, "running": running}),
        )
        self._tasks[job_id] = asyncio.create_task(self._run(job_id))
        return job_id

    async def subscribe(self, job_id: str) -> AsyncIterator[Event]:
        state = self._jobs.get(job_id)
        if state is None:
            return
        # Late subscriber: synthesize queued then replay terminal event and close.
        if state.terminal_event is not None:
            yield Event("queued", {"job_id": job_id, "queue_position": state.queue_position, "running": self._running})
            yield state.terminal_event
            return

        # Register the queue before yielding the synthetic queued event to avoid
        # the race where the pipeline completes between the terminal_event check
        # above and registration here.
        queue: asyncio.Queue[Optional[Event]] = asyncio.Queue(maxsize=128)
        self._subscribers[job_id].append(queue)
        try:
            yield Event("queued", {"job_id": job_id, "queue_position": state.queue_position, "running": self._running})
            # Re-check after registration: if the pipeline finished in the window
            # between our initial check and queue registration, terminal_event is
            # already set (or the event was already enqueued for us).
            if state.terminal_event is not None:
                yield state.terminal_event
                return
            while True:
                event = await queue.get()
                if event is None:
                    return
                yield event
                if event.event in {"done", "error"}:
                    return
        finally:
            try:
                self._subscribers.get(job_id, []).remove(queue)
            except (ValueError, KeyError):
                pass

    def peek_bundle(self, job_id: str) -> Optional[Path]:
        """Return bundle path if available, without marking consumed."""
        state = self._jobs.get(job_id)
        if state is None or state.status is not JobStatus.DONE or state.consumed:
            return None
        return state.bundle_path

    def mark_consumed(self, job_id: str) -> None:
        """Mark the bundle as consumed after a successful transfer."""
        state = self._jobs.get(job_id)
        if state is not None:
            state.consumed = True

    async def _publish(self, job_id: str, event: Event) -> None:
        is_terminal = event.event in {"done", "error"}
        if is_terminal:
            self._jobs[job_id].terminal_event = event
        for queue in list(self._subscribers.get(job_id, [])):
            self._enqueue(queue, event, terminal=is_terminal)

    @staticmethod
    def _force_put(queue: asyncio.Queue, item) -> None:
        while True:
            try:
                queue.put_nowait(item)
                return
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    return

    @staticmethod
    def _enqueue(
        queue: asyncio.Queue[Optional[Event]],
        event: Event,
        *,
        terminal: bool,
    ) -> None:
        JobRegistry._force_put(queue, event)
        if terminal:
            JobRegistry._force_put(queue, None)

    async def _run(self, job_id: str) -> None:
        # This task is created inside the submit request and inherits a copy of
        # that request's context. Clear it and bind job_id so every log line
        # emitted during the job (including from the protspace library) is
        # correlated by job_id and not mislabeled with the submitting request.
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(job_id=job_id)

        state = self._jobs[job_id]
        acquired = False
        try:
            async with self._semaphore:
                acquired = True
                self._queued -= 1
                self._running += 1
                state.status = JobStatus.RUNNING
                ctx = JobContext(
                    job_id=job_id,
                    fasta_path=state.fasta_path,
                    output_dir=state.output_dir,
                    original_name=state.original_name,
                )

                async def emit(stage: str, payload: dict[str, Any]) -> None:
                    await self._publish(
                        job_id,
                        Event("progress", {"stage": stage, **payload}),
                    )

                bundle = await self._pipeline(ctx, emit)
                state.bundle_path = bundle
                state.status = JobStatus.DONE
                state.ready_at = time.time()
                await self._publish(
                    job_id,
                    Event("done", {"download_url": f"/api/prepare/{job_id}/bundle"}),
                )
        except asyncio.CancelledError:
            state.status = JobStatus.ERROR
            state.error_message = "Job cancelled."
            await self._publish(
                job_id, Event("error", {"message": "Job cancelled.", "job_id": job_id})
            )
            raise
        except PipelineFailure as exc:
            # Expected, user-facing failure. The user sees str(exc); raw
            # diagnostic detail goes to the logs (job_id attached via contextvars).
            logger.warning(
                "job failed", extra={"reason": str(exc), "detail": exc.detail}
            )
            state.status = JobStatus.ERROR
            state.error_message = str(exc)
            payload = {"message": str(exc), "job_id": job_id}
            if exc.code:
                payload["code"] = exc.code
            await self._publish(job_id, Event("error", payload))
        except Exception:
            # job_id is bound in contextvars and attached automatically.
            logger.exception("Unexpected pipeline failure")
            state.status = JobStatus.ERROR
            state.error_message = "Internal server error."
            await self._publish(
                job_id,
                Event("error", {"message": "Internal server error.", "job_id": job_id}),
            )
        finally:
            if acquired:
                self._running -= 1
            else:
                self._queued = max(0, self._queued - 1)

    def evict(self, job_id: str) -> None:
        """Drop all in-memory and on-disk state for a job, unblocking subscribers."""
        for queue in self._subscribers.pop(job_id, []):
            JobRegistry._force_put(queue, None)
        self._tasks.pop(job_id, None)
        state = self._jobs.pop(job_id, None)
        if state is not None:
            shutil.rmtree(state.output_dir, ignore_errors=True)

    def sweep_expired(self, ttl_seconds: int) -> list[str]:
        removed: list[str] = []
        # Reclaim consumed jobs promptly: once the bundle has been downloaded,
        # the job's state only lingers to serve a (now-complete) download, so
        # there's no reason to wait the full TTL to free its disk artifacts.
        for job_id, state in list(self._jobs.items()):
            if state.consumed:
                self.evict(job_id)
                removed.append(job_id)
        if not self._job_root.exists():
            return removed
        cutoff = time.time() - ttl_seconds
        for entry in self._job_root.iterdir():
            try:
                if not entry.is_dir():
                    continue
                if entry.stat().st_mtime < cutoff:
                    shutil.rmtree(entry, ignore_errors=True)
                    removed.append(entry.name)
                    # Notify live subscribers before removing state so they
                    # unblock from queue.get() rather than hanging indefinitely.
                    for queue in self._subscribers.get(entry.name, []):
                        JobRegistry._force_put(queue, None)
                    self._jobs.pop(entry.name, None)
                    self._subscribers.pop(entry.name, None)
                    self._tasks.pop(entry.name, None)
            except OSError:
                continue
        return removed
