from __future__ import annotations
import asyncio
import logging
import re
from typing import AsyncIterator

from fastapi import APIRouter, File, HTTPException, Path, Request, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

from .config import Settings
from .jobs import JobRegistry, JobStatus
from .sse import KEEPALIVE_FRAME, format_event
from .validation import FastaValidationError, ValidationCode, parse_and_validate

logger = logging.getLogger("protspace_prep.api")

_KEEPALIVE_INTERVAL_SECONDS = 15.0

# Job IDs are server-generated uuid4 hex strings; constrain the path param so
# obviously-invalid IDs are rejected before any lookup (defense in depth).
_JOB_ID = Path(pattern=r"^[0-9a-f]{32}$")


def _safe_download_name(original_name: str) -> str:
    """Sanitize a user-supplied filename to safe ASCII for Content-Disposition.

    Allows only [A-Za-z0-9._-] in the stem, replaces anything else with '_',
    strips leading/trailing dots and dashes, caps at 80 chars, and appends
    the .parquetbundle extension.
    """
    stem = original_name.rsplit(".", 1)[0] if "." in original_name else original_name
    safe = re.sub(r"[^A-Za-z0-9._\-]+", "_", stem).strip("._-")
    safe = (safe[:80] if safe else "") or "protspace"
    return f"{safe}.parquetbundle"


def fasta_validation_error_handler(request: Request, exc: FastaValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": exc.message, "code": exc.code.value},
    )


def make_router(registry: JobRegistry, settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.post("/api/prepare", status_code=status.HTTP_202_ACCEPTED)
    async def submit(file: UploadFile = File(...)):
        body = await file.read(settings.upload_max_bytes + 1)
        if len(body) > settings.upload_max_bytes:
            raise FastaValidationError(
                ValidationCode.FILE_TOO_LARGE,
                f"File exceeds {settings.upload_max_bytes} bytes.",
            )
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise FastaValidationError(
                ValidationCode.MALFORMED_FASTA,
                "FASTA must be UTF-8 text.",
            ) from exc
        parse_and_validate(text, settings)
        job_id = await registry.submit(body, original_name=file.filename or "input.fasta")
        return {"job_id": job_id}

    @router.get("/api/prepare/{job_id}/events")
    async def events(request: Request, job_id: str = _JOB_ID):
        if registry.get(job_id) is None:
            raise HTTPException(status_code=404, detail="Unknown job_id")

        async def stream() -> AsyncIterator[bytes]:
            aiter = registry.subscribe(job_id).__aiter__()
            # Shield the in-flight __anext__() task across keepalive timeouts.
            # Using wait_for directly on __anext__() would cancel the coroutine
            # on timeout, exhausting the generator and silently truncating the
            # stream. shield() keeps the task alive; we only cancel it in finally.
            pending: asyncio.Task | None = None
            try:
                while True:
                    if pending is None:
                        pending = asyncio.create_task(aiter.__anext__())
                    try:
                        event = await asyncio.wait_for(
                            asyncio.shield(pending),
                            timeout=_KEEPALIVE_INTERVAL_SECONDS,
                        )
                    except asyncio.TimeoutError:
                        if await request.is_disconnected():
                            return
                        yield KEEPALIVE_FRAME.encode("utf-8")
                        continue
                    except StopAsyncIteration:
                        return
                    pending = None
                    if await request.is_disconnected():
                        return
                    yield format_event(event.event, event.data).encode("utf-8")
                    if event.event in {"done", "error"}:
                        return
            except Exception:
                logger.exception("SSE stream error for job %s", job_id)
                yield format_event(
                    "error", {"message": "Internal server error."}
                ).encode("utf-8")
            finally:
                if pending is not None and not pending.done():
                    pending.cancel()
                    try:
                        await pending
                    except (asyncio.CancelledError, StopAsyncIteration):
                        pass

        headers = {
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
        return StreamingResponse(stream(), media_type="text/event-stream", headers=headers)

    @router.get("/api/prepare/{job_id}/bundle")
    async def bundle(job_id: str = _JOB_ID):
        state = registry.get(job_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Unknown job_id")
        if state.status is JobStatus.ERROR:
            raise HTTPException(status_code=409, detail=state.error_message or "Job failed.")
        if state.status is not JobStatus.DONE:
            raise HTTPException(status_code=409, detail="Job not finished.")
        if state.consumed:
            raise HTTPException(status_code=410, detail="Bundle already downloaded.")

        path = registry.peek_bundle(job_id)
        if path is None or not path.exists():
            raise HTTPException(status_code=410, detail="Bundle expired.")

        download_name = _safe_download_name(state.original_name)

        def _finalize() -> None:
            # Runs only after the response body streams successfully, so a
            # mid-stream client disconnect leaves the job un-consumed and the
            # bundle on disk — a retry can still download it.
            registry.mark_consumed(job_id)
            path.unlink(missing_ok=True)

        return FileResponse(
            path,
            media_type="application/octet-stream",
            filename=download_name,
            background=BackgroundTask(_finalize),
        )

    return router
