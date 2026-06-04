## Context

`protspace-prep` is a FastAPI job service: `POST /api/prepare` validates an upload and spawns a detached `asyncio` task that runs the `protspace` pipeline (four subprocesses); clients watch progress over SSE (`GET .../{job_id}/events`) and download the result (`GET .../{job_id}/bundle`). A single logical operation therefore spans **four async contexts** — the submit request, the long-lived background pipeline task, the SSE request, and the bundle request.

Today logging is stdlib `logging` to stdout (unstructured), job state is in-memory and swept after `bundle_ttl_seconds` (default 1h), and the SSE `error` event carries only `{"message": ...}`. The standard request-id-per-request pattern (e.g. `asgi-correlation-id`) does not fit: `request_id` changes 3× across one job's lifecycle and is absent in the background task. The stable, user-held key is `job_id`.

## Goals / Non-Goals

**Goals:**

- One `structlog` pipeline; console in dev, JSON in prod; existing `logging` calls upgraded with no rewrites.
- `job_id` attached to every log line emitted during a job, automatically.
- `job_id` surfaced to the user as an error-reporting reference.
- Stop leaking raw subprocess stderr to end users; send detail to logs instead.

**Non-Goals:**

- `request_id` / `asgi-correlation-id` / last-resort exception middleware.
- Trace propagation through the Caddy proxy layer (429/503/504 before FastAPI).
- Pushing `job_id` into the `protspace` subprocess (no `protspace` changes).
- Rolling this baseline out to other services (`perf/`, etc.).
- Building/operating the log-shipping backend (an ops assumption, see Risks).

## Decisions

**1. `job_id` is the trace ID; `request_id` is not adopted.**
`job_id` is server-generated, user-held end-to-end, and outlives any request. Adopting `request_id` too would add a dependency and middleware for marginal value on the synchronous HTTP edges, which users rarely report. Chosen: `job_id` only. _Alternative considered:_ add `asgi-correlation-id` for the HTTP edges — deferred as out of scope.

**2. Root `ProcessorFormatter` bridges stdlib → structlog.**
Attaching a `structlog.stdlib.ProcessorFormatter` to the root logger means every existing `logging.getLogger("protspace_prep.*")` call (and uvicorn/library logs) renders through the same chain — no call-site changes. _Alternative:_ rewrite every call site to `structlog.get_logger()` — rejected as needless churn.

**3. Bind `job_id` via `contextvars` in `_run`, not by threading arguments.**
`structlog.contextvars.merge_contextvars` attaches bound values to every record in the same async context. Binding `job_id` once at the top of `_run` correlates all downstream logs, including the `protspace` library's, with zero plumbing. The pipeline's manual `job=%s` threading becomes redundant for logging. _Alternative:_ `logger.bind()` returning new loggers — rejected; not context-scoped, must be threaded everywhere.

**4. Clear context before binding in `_run`.**
`asyncio.create_task(self._run(...))` is created inside `submit()` and **copies the current context**. Without `clear_contextvars()` first, pipeline logs would inherit and be mislabeled with the submit request's context. Clear, then bind `job_id`.

**5. Invert error-detail flow in the pipeline.**
On subprocess failure, log `{step, returncode, stderr_tail}` (job_id auto-attached) and raise a `PipelineFailure` with a curated message — do **not** embed raw stderr in the message that becomes the SSE error shown to users. Keep the existing curated failures (e.g. Biocentral-unavailable) as user-facing. This is the one user-visible behavior change.

**6. Add `job_id` to the SSE `error` payload; surface it on the frontend.**
The `error` event becomes self-describing (`{"message", "code"?, "job_id"}`); replayed terminal events to late subscribers carry it too. `FastaPrepError` gains a `job_id` field so the UI can render a reference. Display format (raw hex vs. shortened) is a UI detail.

## Risks / Trade-offs

- **Reported `job_id` points at nothing if logs aren't durable** → In prod, ship JSON logs to a store queryable by `job_id`; treated as an ops assumption, called out in the proposal. Without it the reference is cosmetic.
- **Users lose the raw stderr they previously saw** → Net positive for support, but the curated message must be specific enough (include the failing step) to be actionable.
- **Duplicate log handlers under `--reload` / `fastapi dev`** → `setup_logging()` must be idempotent (clear root handlers or guard with a module-level flag).
- **Logger acquired before `setup_logging()`** → cached without the formatter. Mitigation: call `setup_logging()` as the first thing in `app.py`, before constructing the app or registry.
- **`contextvars` across `asyncio.to_thread` / subprocess** → contextvars copy into threads (fine) but **not** across process boundaries; the subprocess's own stdout/stderr is out of scope by decision (no protspace change).

## Migration Plan

1. Add `structlog`, settings, `logger.py`; wire `setup_logging()` in `app.py`. Existing logs immediately render through structlog — verify dev console output unchanged in spirit.
2. Bind `job_id` in `_run`; confirm pipeline log lines carry `job_id`.
3. Invert pipeline failure logging; confirm users no longer see raw stderr and detail appears in logs under the `job_id`.
4. Add `job_id` to the SSE `error` payload; update `fasta-prep-client.ts`.
5. Flip JSON mode on; confirm one valid JSON object per line.

Rollback: revert the change set; no schema/state migration, no persisted data touched.

## Open Questions

- Production log destination and retention for the `job_id` lookup story (ops decision, outside this change).
- Frontend display format for the `job_id` reference (raw 32-char hex vs. shortened) — deferred to the UI work; the backend contract only guarantees the value is present.
