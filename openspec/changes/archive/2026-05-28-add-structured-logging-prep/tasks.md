## 1. Logging setup

- [x] 1.1 Add `structlog` to `services/protspace-prep/pyproject.toml` dependencies and lock (`uv lock`)
- [x] 1.2 Add `log_level` and `log_json_format` to `Settings` and `load_settings()` in `config.py`, following the existing `os.getenv` dataclass pattern (env vars `PREP_LOG_LEVEL`, `PREP_LOG_JSON_FORMAT`)
- [x] 1.3 Create `src/protspace_prep/logger.py` with an idempotent `setup_logging(json_logs, log_level)`: structlog processor chain incl. `merge_contextvars`, console vs. JSON renderer, root `ProcessorFormatter` with `foreign_pre_chain`, and uvicorn logger taming. Guard against duplicate handlers under `--reload`.
- [x] 1.4 Call `setup_logging()` in `app.py` as the first thing, before constructing the app/registry or acquiring any logger

## 2. job_id correlation

- [x] 2.1 At the top of `JobRegistry._run`, `clear_contextvars()` then `bind_contextvars(job_id=job_id)` so inherited submit-request context is dropped and all downstream logs carry `job_id`
- [x] 2.2 Remove now-redundant manual `job=%s` threading in `pipeline.py` logging (keep `job_id` as a function arg only where still used for non-logging purposes)

## 3. Error-detail inversion

- [x] 3.1 In `pipeline._run_step`, on non-zero exit log a structured `logger.error` with `step`, `returncode`, and `stderr_tail`; raise `PipelineFailure` with a curated message that names the failing step but excludes raw stderr
- [x] 3.2 Verify the unexpected-exception path in `JobRegistry._run` still `logger.exception(...)` with `job_id` bound and returns a generic user message
- [x] 3.3 Confirm curated failures (e.g. `BIOCENTRAL_UNAVAILABLE`) remain shown to the user unchanged

## 4. Propagate job_id to the user

- [x] 4.1 Add `job_id` to the `Event("error", ...)` payload(s) in `JobRegistry` (both the `PipelineFailure` and unexpected-exception branches), so terminal-event replay to late subscribers includes it
- [x] 4.2 In `app/src/explore/fasta-prep-client.ts`, read `job_id` from the parsed `error` event and attach it to `FastaPrepError`

## 5. Verification

- [x] 5.1 Smoke test: run a job, confirm pipeline log lines include `job_id`
- [x] 5.2 Smoke test: force a subprocess failure; confirm stderr detail appears in logs under the `job_id` and the user-facing message contains no raw stderr
- [x] 5.3 Confirm the SSE `error` event payload carries `job_id` and the frontend `FastaPrepError` exposes it
- [x] 5.4 Flip `PREP_LOG_JSON_FORMAT=true`; confirm one valid JSON object per log line and uvicorn logs render through structlog
- [x] 5.5 Run the existing prep test suite (`pytest`) and frontend tests touching `fasta-prep-client` to confirm no regressions
