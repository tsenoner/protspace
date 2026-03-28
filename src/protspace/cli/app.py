"""ProtSpace CLI application — typer-based command interface."""

import logging

import typer

logger = logging.getLogger(__name__)

app = typer.Typer(
    name="protspace",
    help="ProtSpace — interactive visualization of protein language model embeddings.",
    no_args_is_help=True,
    pretty_exceptions_enable=True,
    pretty_exceptions_show_locals=False,
    pretty_exceptions_short=True,
    context_settings={"help_option_names": ["-h", "--help"]},
)


# ---------------------------------------------------------------------------
# Shared utilities
# ---------------------------------------------------------------------------


class _TqdmLoggingHandler(logging.StreamHandler):
    """Logging handler that uses tqdm.write() to avoid garbling progress bars."""

    def emit(self, record):
        try:
            from tqdm import tqdm

            msg = self.format(record)
            tqdm.write(msg, file=self.stream)
            self.flush()
        except Exception:
            self.handleError(record)


def setup_logging(verbosity: int) -> None:
    """Configure logging based on verbosity level.

    Args:
        verbosity: 0=WARNING, 1=INFO, 2+=DEBUG
    """
    level = [logging.WARNING, logging.INFO, logging.DEBUG][min(verbosity, 2)]

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    handler = _TqdmLoggingHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    root.addHandler(handler)

    for name in ("urllib3", "requests", "urllib3.connectionpool"):
        logging.getLogger(name).setLevel(logging.WARNING)


# ---------------------------------------------------------------------------
# Register subcommands (imported lazily to keep startup fast)
# ---------------------------------------------------------------------------


def _register_commands() -> None:
    """Register all subcommands on the typer app."""
    from protspace.cli import (  # noqa: F401
        annotate,
        bundle,
        embed,
        prepare,
        project,
        serve,
        style,
    )


# Defer registration until the app module is fully loaded
_register_commands()
