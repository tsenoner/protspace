"""ProtSpace CLI application — typer-based command interface."""

import logging

import typer

logger = logging.getLogger(__name__)

# Command help panels. Panels render in the order they are first registered
# (see _register_commands below); commands appear within a panel in registration
# order. Defined here so every command references the exact same string.
PANEL_START = "Start here"
PANEL_STAGES = "Pipeline stages · run individually"
PANEL_REFINE = "Refine"
PANEL_VISUALIZE = "Visualize"

_HELP = """ProtSpace — prepare protein language model (pLM) embeddings for interactive exploration.

Reveal relationships that sequence similarity misses. Most users only need 'prepare' to build a bundle, then explore it in the browser at https://protspace.app/explore.

\b
Quick start:
  1. protspace prepare -i embeddings.h5 -m pca2,umap2 -o out/
  2. Drag out/data.parquetbundle onto https://protspace.app/explore   (recommended)
     — or view it locally:  protspace serve out/data.parquetbundle
"""

app = typer.Typer(
    name="protspace",
    help=_HELP,
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
    """Register all subcommands on the typer app.

    Import order defines both the panel order and the within-panel command
    order in ``protspace --help``, so it follows the pipeline flow:
    prepare (entry point) → stages → refine → visualize.
    """
    # Order is load-bearing (drives help panel/command order), so keep it as-is
    # rather than letting isort alphabetize it.
    from protspace.cli import (  # noqa: F401, I001
        prepare,
        embed,
        project,
        annotate,
        stats,
        bundle,
        transfer,
        style,
        serve,
    )


# Defer registration until the app module is fully loaded
_register_commands()
