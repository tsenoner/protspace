## Why

When a FASTA preparation job fails, users have no way to give us a handle we can trace. The `protspace-prep` service logs with the stdlib `logging` module (unstructured, not queryable), the in-memory job state is swept after 1 hour, and the SSE `error` event carries only a free-text `message` — so a user reporting "my prep failed" hands us nothing we can correlate to logs. Worse, the default subprocess-failure path currently leaks raw `protspace` stderr straight to the browser instead of recording it server-side.

The service already has a perfect durable correlation key — the `job_id` — that the user holds end-to-end (returned by submit, present in the events and bundle URLs). We just need structured logs keyed by it, and the `job_id` surfaced to the user as a reference to quote when reporting errors.

## What Changes

- Add `structlog` and a `setup_logging()` that renders human-readable console output in dev and JSON in production (env-toggled). All existing `logging.getLogger("protspace_prep.*")` calls flow through it unchanged via a root `ProcessorFormatter`.
- Bind `job_id` into `contextvars` at the start of the background pipeline task (`_run`), after clearing inherited context. Every log line emitted during a job — including from the `protspace` library — then carries `job_id` automatically.
- Add `job_id` to the SSE `error` event payload so the error is self-describing and the frontend can surface a reference.
- **BREAKING (user-visible):** invert error detail flow in the pipeline — raw subprocess stderr goes to structured logs (keyed by `job_id`), and the user receives a curated, friendly message plus the `job_id`. Users no longer see raw subprocess stderr.
- Surface `job_id` on the frontend `FastaPrepError` so the prep UI can display "Reference: `<job_id>`".

## Capabilities

### New Capabilities

- `prep-observability`: structured logging for the `protspace-prep` service, `job_id`-based log correlation, and propagation of the `job_id` to users as an error-reporting reference.

### Modified Capabilities

<!-- None — no existing specs in openspec/specs/. -->

## Impact

- **Service:** `services/protspace-prep` — `pyproject.toml` (add `structlog`), `config.py` (log settings), new `logger.py`, `app.py` (call `setup_logging()` first), `jobs.py` (bind `job_id`, error payload), `pipeline.py` (structured failure logging, stop leaking stderr).
- **Frontend:** `app/src/explore/fasta-prep-client.ts` — attach `job_id` to `FastaPrepError`.
- **Ops (assumption, not code):** in production, JSON logs must be shipped to a store queryable by `job_id` (Loki/OpenSearch/etc.), otherwise a reported `job_id` points at nothing once the TTL sweeps the job.
- **No new request-scoped middleware**, no `asgi-correlation-id`, no `request_id`.
