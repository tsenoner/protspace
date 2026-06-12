"""Structured logging setup for protspace-prep.

A single `structlog` pipeline renders human-readable console output in
development and single-line JSON in production. A root `ProcessorFormatter`
bridges the stdlib `logging` module so existing `logging.getLogger(...)` calls
(and uvicorn / third-party libraries) flow through the same chain without
per-call-site changes. `merge_contextvars` attaches request-scoped context
(notably ``job_id``) bound via `structlog.contextvars`.
"""

from __future__ import annotations
import logging

import structlog
from structlog.types import EventDict, Processor


def _drop_color_message_key(_, __, event_dict: EventDict) -> EventDict:
    """Uvicorn duplicates the message under `color_message`; drop it."""
    event_dict.pop("color_message", None)
    return event_dict


def setup_logging(json_logs: bool = False, log_level: str = "INFO") -> None:
    """Configure structlog + stdlib logging.

    Idempotent within a process: existing root handlers are cleared before a
    new one is attached, so uvicorn ``--reload`` / ``fastapi dev`` re-runs do
    not stack duplicate output.
    """
    timestamper = structlog.processors.TimeStamper(fmt="iso")

    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.stdlib.ExtraAdder(),
        _drop_color_message_key,
        timestamper,
        structlog.processors.StackInfoRenderer(),
    ]

    if json_logs:
        # ConsoleRenderer pretty-prints exceptions itself; for JSON we format
        # exc_info into a string field instead.
        shared_processors.append(structlog.processors.format_exc_info)

    structlog.configure(
        processors=shared_processors
        + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    log_renderer: Processor = (
        structlog.processors.JSONRenderer()
        if json_logs
        else structlog.dev.ConsoleRenderer()
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        # Applied only to records originating from stdlib `logging`.
        foreign_pre_chain=shared_processors,
        # Applied to ALL records after the pre_chain.
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            log_renderer,
        ],
    )

    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level.upper())

    # Route uvicorn error logs through the root handler.
    for _log in ("uvicorn", "uvicorn.error"):
        logging.getLogger(_log).handlers.clear()
        logging.getLogger(_log).propagate = True

    # Silence native uvicorn access logs; this service does not re-emit them.
    logging.getLogger("uvicorn.access").handlers.clear()
    logging.getLogger("uvicorn.access").propagate = False
