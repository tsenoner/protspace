from __future__ import annotations
import asyncio
import logging
from pathlib import Path
from typing import Awaitable, Callable, Sequence

from protspace.data.loaders.h5 import parse_identifier

from .config import Settings
from .jobs import JobContext, PipelineFailure

logger = logging.getLogger("protspace_prep.pipeline")

# Human-readable step names for user-facing failure messages.
_STEP_LABELS = {
    "embed": "embedding",
    "annotate": "annotation",
    "project": "projection",
    "bundle": "bundling",
}

EmitFn = Callable[[str, dict], Awaitable[None]]

_BIOCENTRAL_DOWN_PATTERNS = (
    "connection refused",
    "cannot connect to host",
    "connectionerror",
    "temporary failure in name resolution",
    "name or service not known",
    "503 service unavailable",
    "503 server error",
    "no healthy biocentral",
)

_BIOCENTRAL_FRIENDLY_MESSAGE = (
    "Biocentral embedding service is unavailable. "
    "For larger jobs or while we're down, you can run the same pipeline in Google Colab."
)


def _classify_failure(exc: PipelineFailure) -> PipelineFailure:
    """Return a possibly re-tagged PipelineFailure. Pass-through if no match.

    Inspects both the curated message and the raw ``detail`` (subprocess
    stderr), since the down-patterns originate in subprocess output that is no
    longer embedded in the user-facing message.
    """
    haystack = f"{exc} {exc.detail or ''}".lower()
    if any(p in haystack for p in _BIOCENTRAL_DOWN_PATTERNS):
        return PipelineFailure(_BIOCENTRAL_FRIENDLY_MESSAGE, code="BIOCENTRAL_UNAVAILABLE")
    return exc


def _normalize_fasta_headers(input_path: Path, output_path: Path) -> None:
    """Rewrite *input_path* into *output_path* with parsed-identifier headers.

    ``embed`` keys H5 by the raw first token (e.g. ``sp|P12345|NAME_HUMAN``)
    while ``annotate`` runs the same header through ``parse_identifier``
    (→ ``P12345``). Without normalisation the bundle carries two different keys
    for the same protein and the frontend join in ``bundle.ts`` produces zero
    merged annotations. Normalising up-front makes both paths emit identical
    identifiers. Plain headers (no UniProt pipes) are left untouched.
    """
    with open(input_path, encoding="utf-8") as fin, open(output_path, "w", encoding="utf-8") as fout:
        for line in fin:
            if line.startswith(">"):
                stripped = line[1:].strip()
                if not stripped:
                    fout.write(line)
                    continue
                token = stripped.split()[0]
                fout.write(f">{parse_identifier(token)}\n")
            else:
                fout.write(line)


async def run_protspace_prepare(
    ctx: JobContext,
    emit: EmitFn,
    *,
    settings: Settings,
) -> Path:
    """Drive the protspace pipeline as four subprocess calls.

    ``embed`` and ``annotate`` are network-bound and independent, so they run
    in parallel via a TaskGroup. ``project`` then ``bundle`` run in sequence.
    The whole run shares a single wall-clock budget from
    ``settings.pipeline_timeout_seconds``.
    """
    embed_dir = ctx.output_dir / "embed"
    project_dir = ctx.output_dir / "project"
    annotations_path = ctx.output_dir / "annotations.parquet"
    bundle_path = ctx.output_dir / "data.parquetbundle"
    embed_dir.mkdir(parents=True, exist_ok=True)
    project_dir.mkdir(parents=True, exist_ok=True)

    normalized_fasta = ctx.output_dir / "input.normalized.fasta"
    _normalize_fasta_headers(ctx.fasta_path, normalized_fasta)

    embed_cmd = [
        "protspace",
        "embed",
        "-i",
        str(normalized_fasta),
        "-e",
        settings.embedder,
        "-o",
        str(embed_dir),
    ]
    annotate_cmd = [
        "protspace",
        "annotate",
        "-i",
        str(normalized_fasta),
        "-a",
        settings.annotations,
        "-o",
        str(annotations_path),
    ]

    try:
        async with asyncio.timeout(settings.pipeline_timeout_seconds):
            await emit("embedding", {})
            await emit("annotating", {})
            try:
                async with asyncio.TaskGroup() as tg:
                    tg.create_task(_run_step("embed", embed_cmd))
                    tg.create_task(_run_step("annotate", annotate_cmd))
            except ExceptionGroup as eg:
                failures = [e for e in eg.exceptions if isinstance(e, PipelineFailure)]
                if failures:
                    classified = [_classify_failure(e) for e in failures]
                    if any(c.code == "BIOCENTRAL_UNAVAILABLE" for c in classified):
                        raise PipelineFailure(_BIOCENTRAL_FRIENDLY_MESSAGE, code="BIOCENTRAL_UNAVAILABLE") from eg
                    # Preserve the per-step diagnostic detail (subprocess stderr)
                    # so it stays available for server-side logging; the joined
                    # message remains the curated, user-facing text.
                    detail = "; ".join(e.detail for e in failures if e.detail) or None
                    raise PipelineFailure(
                        "; ".join(str(e) for e in failures), detail=detail
                    ) from eg
                raise

            h5_files = sorted(embed_dir.glob("*.h5"))
            if not h5_files:
                raise PipelineFailure("protspace embed produced no HDF5 file.")

            await emit("projecting", {})
            project_cmd = [
                "protspace",
                "project",
                "-i",
                str(h5_files[0]),
                "-m",
                settings.methods,
                "-o",
                str(project_dir),
            ]
            await _run_step("project", project_cmd)

            await emit("bundling", {})
            bundle_cmd = [
                "protspace",
                "bundle",
                "-p",
                str(project_dir),
                "-a",
                str(annotations_path),
                "-o",
                str(bundle_path),
            ]
            await _run_step("bundle", bundle_cmd)
    except asyncio.TimeoutError:
        raise PipelineFailure(
            f"protspace pipeline timed out after {settings.pipeline_timeout_seconds}s."
        )

    if not bundle_path.exists():
        raise PipelineFailure(
            "protspace bundle reported success but produced no .parquetbundle file."
        )
    return bundle_path


async def _run_step(name: str, cmd: Sequence[str]) -> None:
    """Run one protspace subcommand. Raise PipelineFailure on non-zero exit.

    ``job_id`` is not threaded in: it is bound in ``contextvars`` by the job
    runner and attached to every log line automatically. Stderr is consumed
    line-by-line so the subprocess never blocks on a full pipe; the last 50
    lines are kept for the failure log. Cancellation kills the subprocess
    before propagating.
    """
    logger.info("pipeline step starting", extra={"step": name, "cmd": " ".join(cmd)})
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    last_lines: list[str] = []

    async def _drain() -> int:
        assert process.stderr is not None
        while True:
            raw = await process.stderr.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            last_lines.append(line)
            if len(last_lines) > 50:
                last_lines.pop(0)
        return await process.wait()

    try:
        returncode = await _drain()
    except asyncio.CancelledError:
        process.kill()
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            pass
        raise

    if returncode != 0:
        tail = "\n".join(last_lines[-10:]) or "no output"
        logger.error(
            "pipeline step failed",
            extra={"step": name, "returncode": returncode, "stderr_tail": tail},
        )
        label = _STEP_LABELS.get(name, name)
        raise PipelineFailure(
            f"The {label} step failed. Please try again; if it persists, "
            f"report this with the reference shown below.",
            detail=f"protspace {name} exited with code {returncode}: {tail}",
        )


