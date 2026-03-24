"""ProtSpace CLI application — typer-based command interface."""

import hashlib
import logging
from pathlib import Path

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
# Shared utilities (absorbed from common_args.py)
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


def compute_cache_hash(identifiers: list[str]) -> str:
    """Compute MD5 hash of sorted identifiers for cache naming."""
    sorted_ids = sorted(identifiers)
    hash_input = "".join(sorted_ids).encode("utf-8")
    return hashlib.md5(hash_input).hexdigest()[:16]


def determine_output_paths(
    output_arg: Path | None,
    input_path: Path | None,
    non_binary: bool,
    bundled: bool,
    keep_tmp: bool,
    identifiers: list[str] | None = None,
) -> tuple[Path, Path | None]:
    """Determine output file path and intermediate directory."""
    if input_path:
        base_dir = input_path.parent
        input_stem = input_path.stem
    else:
        base_dir = Path(".")
        input_stem = "protspace"

    if non_binary:
        ext = ".json"
    else:
        ext = ".parquetbundle" if bundled else ""

    if output_arg is None:
        if bundled or non_binary:
            output_path = base_dir / f"{input_stem}{ext}"
        else:
            output_path = base_dir / "protspace"
    else:
        if output_arg.suffix:
            if non_binary:
                output_path = output_arg.with_suffix(".json")
            elif bundled:
                output_path = output_arg.with_suffix(".parquetbundle")
            else:
                output_path = output_arg.with_suffix("")
        else:
            if bundled or non_binary:
                output_path = output_arg.with_suffix(ext)
            else:
                output_path = output_arg

    if keep_tmp and identifiers:
        cache_hash = compute_cache_hash(identifiers)
        intermediate_dir = base_dir / "tmp" / cache_hash
    else:
        intermediate_dir = None

    return output_path, intermediate_dir


def parse_custom_names(custom_names_arg: str | None) -> dict:
    """Parse custom names argument into dictionary."""
    custom_names = {}
    if custom_names_arg:
        for name_spec in custom_names_arg.split(","):
            try:
                method, name = name_spec.split("=")
                custom_names[method] = name
            except ValueError:
                logger.warning(f"Invalid custom name specification: {name_spec}")
    return custom_names


# ---------------------------------------------------------------------------
# Register subcommands (imported lazily to keep startup fast)
# ---------------------------------------------------------------------------


def _register_commands() -> None:
    """Register all subcommands on the typer app."""
    from protspace.cli.prepare import prepare  # noqa: F401
    from protspace.cli.serve import serve  # noqa: F401
    from protspace.cli.style import style  # noqa: F401


_register_commands()
