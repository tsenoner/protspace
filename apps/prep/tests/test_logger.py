import json
import logging

import pytest
import structlog

from protspace_prep.jobs import JobRegistry, PipelineFailure
from protspace_prep.logger import setup_logging


@pytest.fixture(autouse=True)
def _restore_logging():
    """setup_logging reconfigures process-global state; put it back afterwards."""
    saved_config = structlog.get_config()
    root = logging.getLogger()
    saved_handlers, saved_level = root.handlers[:], root.level
    uvicorn = {
        name: (logging.getLogger(name).handlers[:], logging.getLogger(name).propagate)
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
    }
    yield
    structlog.configure(**saved_config)
    root.handlers[:] = saved_handlers
    root.setLevel(saved_level)
    for name, (handlers, propagate) in uvicorn.items():
        logging.getLogger(name).handlers[:] = handlers
        logging.getLogger(name).propagate = propagate


def _json_lines(err: str) -> list[dict]:
    return [json.loads(line) for line in err.splitlines()]


def test_json_logs_render_one_json_object_per_line(capsys):
    # The handler binds sys.stderr when created, so configure under capsys.
    setup_logging(json_logs=True)
    logging.getLogger("protspace_prep.test").info("hello")
    records = _json_lines(capsys.readouterr().err)
    assert len(records) == 1
    record = records[0]
    assert record["event"] == "hello"
    assert record["level"] == "info"
    assert record["logger"] == "protspace_prep.test"
    assert "timestamp" in record


def test_console_logs_are_human_readable(capsys):
    setup_logging(json_logs=False)
    logging.getLogger("protspace_prep.test").info("hello")
    err = capsys.readouterr().err
    assert "hello" in err
    assert "protspace_prep.test" in err
    with pytest.raises(json.JSONDecodeError):
        json.loads(err)


async def test_job_failures_are_logged_with_job_id(tmp_path, capsys):
    """Failure detail and tracebacks reach the logs, correlated by job_id."""
    setup_logging(json_logs=True)

    async def failing(ctx, emit):
        raise PipelineFailure("The embedding step failed.", detail="stderr tail")

    async def crashing(ctx, emit):
        raise RuntimeError("boom")

    job_ids = {}
    for name, pipeline in {"failing": failing, "crashing": crashing}.items():
        registry = JobRegistry(
            job_root=tmp_path / name, max_concurrent=1, pipeline=pipeline
        )
        job_ids[name] = await registry.submit(b">id\nM\n", original_name="t.fasta")
        async for _ in registry.subscribe(job_ids[name]):
            pass

    records = {r["event"]: r for r in _json_lines(capsys.readouterr().err)}
    failed = records["job failed"]
    assert failed["job_id"] == job_ids["failing"]
    assert failed["detail"] == "stderr tail"
    crashed = records["Unexpected pipeline failure"]
    assert crashed["job_id"] == job_ids["crashing"]
    assert "Traceback" in crashed["exception"]
    assert "RuntimeError: boom" in crashed["exception"]
