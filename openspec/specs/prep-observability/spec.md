# prep-observability Specification

## Purpose

Structured, correlated logging and user-facing error references for the `protspace-prep` service.

## Requirements

### Requirement: Structured logging pipeline

The `protspace-prep` service SHALL route all log output through a single `structlog`-based pipeline configured once at startup, before any module acquires a logger. The renderer SHALL be selectable via environment: human-readable console output by default, single-line JSON when JSON output is enabled. Logs emitted through the stdlib `logging` module (application code, uvicorn, third-party libraries) SHALL flow through the same formatter without per-call-site changes.

#### Scenario: Console rendering in development

- **WHEN** the service starts with JSON logging disabled
- **THEN** log records are rendered as human-readable console lines including timestamp, level, logger name, and event

#### Scenario: JSON rendering in production

- **WHEN** the service starts with JSON logging enabled
- **THEN** each log record is emitted as a single valid JSON object on one line, including timestamp, level, logger name, and event fields

#### Scenario: Existing stdlib loggers are upgraded without rewrites

- **WHEN** existing code calls `logging.getLogger("protspace_prep.*")` and logs an event
- **THEN** that record is rendered through the same `structlog` formatter as the rest of the pipeline

#### Scenario: Configuration runs before loggers are acquired

- **WHEN** the application is assembled
- **THEN** logging is configured before any logger is acquired, so no early logger is cached without the configured formatter

### Requirement: job_id correlation on pipeline logs

Every log line emitted during the execution of a preparation job SHALL carry the job's `job_id` as a structured field. The background pipeline task SHALL clear any inherited request/context state and bind `job_id` at the start of execution, so logs are not mislabeled with the submitting request's context and so library logs emitted within the job's async context are also correlated.

#### Scenario: Pipeline log lines carry job_id

- **WHEN** the pipeline emits any log line while processing a job
- **THEN** the log record includes the `job_id` of that job as a structured field

#### Scenario: No leakage of submitting request context

- **WHEN** the background pipeline task begins executing
- **THEN** context inherited from the request that submitted the job is cleared before `job_id` is bound

### Requirement: Failure detail is logged, not shown to users

When a preparation step fails, the full diagnostic detail (such as subprocess exit code and captured stderr) SHALL be recorded in the structured logs correlated by `job_id`. The message returned to the user SHALL be a curated, friendly description and SHALL NOT contain raw subprocess stderr output. Curated, intentionally user-facing failure messages (e.g. dependency-unavailable guidance) MAY still be shown verbatim.

#### Scenario: Subprocess failure detail goes to logs

- **WHEN** a `protspace` subprocess exits non-zero
- **THEN** the exit code and captured stderr tail are written to the structured logs with the job's `job_id`
- **AND** the user-facing failure message does not contain the raw stderr output

#### Scenario: Unexpected exception is logged with traceback

- **WHEN** an unexpected exception is raised during job execution
- **THEN** the exception and traceback are logged with the job's `job_id`
- **AND** the user receives a generic failure message rather than the exception detail

#### Scenario: Curated failure messages are preserved

- **WHEN** the pipeline raises a curated user-facing failure (e.g. an upstream embedding service is unavailable)
- **THEN** that curated message is shown to the user unchanged

### Requirement: job_id is propagated to the user as an error reference

The service SHALL include the `job_id` in the SSE `error` event payload so the failure is self-describing, and the frontend SHALL expose the `job_id` on the surfaced error so a user can quote it when reporting a problem.

#### Scenario: Error event carries job_id

- **WHEN** a job fails and an `error` event is emitted on the job's event stream
- **THEN** the event payload includes the `job_id`

#### Scenario: Frontend exposes the reference

- **WHEN** the frontend receives a job failure
- **THEN** the resulting error carries the `job_id` so the prep UI can present it as a reportable reference
