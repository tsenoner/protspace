import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import typer

from protspace.cli.app import app as protspace_cli
from protspace_prep.config import load_settings
from protspace_prep.jobs import JobContext, PipelineFailure
from protspace_prep.pipeline import (
    _classify_failure,
    _normalize_fasta_headers,
    run_protspace_prepare,
)


@pytest.fixture
def ctx(tmp_path: Path):
    job_dir = tmp_path / "jobs" / "abc"
    job_dir.mkdir(parents=True)
    fasta = job_dir / "input.fasta"
    fasta.write_text(">id\nMKT\n")
    return JobContext(
        job_id="abc",
        fasta_path=fasta,
        output_dir=job_dir,
        original_name="t.fasta",
    )


def _mock_subprocess(returncode: int, stderr_lines: list[bytes] | None = None):
    """Build an asyncio-style subprocess mock with a one-shot stderr stream."""
    proc = MagicMock()
    proc.returncode = returncode

    async def _wait():
        return returncode

    proc.wait = _wait
    proc.stderr = MagicMock()

    lines = list(stderr_lines or [])

    async def _readline():
        if lines:
            return lines.pop(0)
        return b""

    proc.stderr.readline = _readline
    proc.kill = MagicMock()
    return proc


def _make_step_router(
    ctx: JobContext,
    *,
    fail_step: str | None = None,
    fail_returncode: int = 2,
    fail_stderr: list[bytes] | None = None,
    calls: list[list[str]] | None = None,
):
    """Return a fake create_subprocess_exec that simulates each protspace step.

    Each successful step writes its expected output artifact so the next step
    sees a populated filesystem (mirrors what the real CLI does). When *calls*
    is given, every protspace argv is appended to it.
    """
    embed_dir = ctx.output_dir / "embed"
    project_dir = ctx.output_dir / "project"
    annotations_path = ctx.output_dir / "annotations.parquet"
    bundle_path = ctx.output_dir / "data.parquetbundle"

    async def fake_create(*args, **kwargs):
        cmd = args
        if not cmd or cmd[0] != "protspace":
            return _mock_subprocess(returncode=0)
        step = cmd[1] if len(cmd) > 1 else ""
        if calls is not None:
            calls.append(list(cmd))
        if step == fail_step:
            return _mock_subprocess(
                returncode=fail_returncode,
                stderr_lines=fail_stderr or [b"ERROR mock failure\n"],
            )
        if step == "embed":
            embed_dir.mkdir(parents=True, exist_ok=True)
            (embed_dir / "prot_t5.h5").write_bytes(b"H5")
        elif step == "annotate":
            annotations_path.write_bytes(b"PARQUET")
        elif step == "project":
            project_dir.mkdir(parents=True, exist_ok=True)
            (project_dir / "projections_metadata.parquet").write_bytes(b"M")
            (project_dir / "projections_data.parquet").write_bytes(b"D")
        elif step == "bundle":
            bundle_path.write_bytes(b"BUNDLE")
        return _mock_subprocess(returncode=0)

    return fake_create


async def test_success_path_writes_bundle_and_emits_stages(ctx):
    bundle_path = ctx.output_dir / "data.parquetbundle"
    emitted = []

    async def emit(stage, payload):
        emitted.append((stage, payload))

    settings = load_settings()
    with patch("asyncio.create_subprocess_exec", new=_make_step_router(ctx)):
        result = await run_protspace_prepare(ctx, emit, settings=settings)
    assert result == bundle_path
    assert bundle_path.read_bytes() == b"BUNDLE"
    stages = [stage for stage, _ in emitted]
    # Embed and annotate run in parallel, but both stages must be announced
    # before projection so the UI can communicate what's happening.
    assert stages.index("embedding") < stages.index("projecting")
    assert stages.index("annotating") < stages.index("projecting")
    assert stages.index("projecting") < stages.index("bundling")


async def test_pipeline_argv_parses_against_the_real_protspace_cli(ctx):
    """Every subprocess argv must be accepted by the in-repo protspace CLI.

    prep-source-coupling: renaming or removing a flag of a subcommand prep
    invokes has to fail the prep suite in the same change, not in production.
    This parses without executing, so it catches renamed, removed or retyped
    options; value grammar (e.g. the ``-m`` method list) is interpreted inside
    the command bodies and is not checked here. Parsing runs after the
    pipeline, while the step router's files satisfy the ``exists=True`` checks.
    """
    settings = load_settings()
    calls: list[list[str]] = []
    with patch(
        "asyncio.create_subprocess_exec", new=_make_step_router(ctx, calls=calls)
    ):
        await run_protspace_prepare(ctx, AsyncMock(), settings=settings)

    assert sorted(cmd[1] for cmd in calls) == ["annotate", "bundle", "embed", "project"]
    group = typer.main.get_command(protspace_cli)
    parsed: dict[str, dict] = {}
    for cmd in calls:
        assert cmd[0] == "protspace"
        group_ctx = group.make_context("protspace", cmd[1:2])
        command = group.get_command(group_ctx, cmd[1])
        assert command is not None, f"protspace has no {cmd[1]!r} subcommand"
        parsed[cmd[1]] = command.make_context(cmd[1], cmd[2:], parent=group_ctx).params

    # The values land on the parameters prep means them for (raw, pre-conversion).
    # The step router writes to fixed paths whatever the argv says, so these
    # are the only checks that catch a wrong or swapped input/output path.
    out = ctx.output_dir
    fasta = str(out / "input.normalized.fasta")
    expected = {
        "embed": {
            "input": fasta,
            "embedder": (settings.embedder,),
            "output": str(out / "embed"),
        },
        "annotate": {
            "input": fasta,
            "annotations": (settings.annotations,),
            "output": str(out / "annotations.parquet"),
        },
        "project": {
            "input": (str(out / "embed" / "prot_t5.h5"),),
            "methods": (settings.methods,),
            "output": str(out / "project"),
        },
        "bundle": {
            "projections": str(out / "project"),
            "annotations": str(out / "annotations.parquet"),
            "output": str(out / "data.parquetbundle"),
        },
    }
    for step, params in expected.items():
        assert {name: parsed[step][name] for name in params} == params, step


async def test_embed_and_annotate_run_concurrently(ctx):
    """Both subprocess invocations must be in flight before either completes."""
    in_flight: set[str] = set()
    max_in_flight: list[int] = [0]
    embed_dir = ctx.output_dir / "embed"
    project_dir = ctx.output_dir / "project"
    annotations_path = ctx.output_dir / "annotations.parquet"
    bundle_path = ctx.output_dir / "data.parquetbundle"

    async def fake_create(*args, **kwargs):
        step = args[1]
        if step in {"embed", "annotate"}:
            in_flight.add(step)
            max_in_flight[0] = max(max_in_flight[0], len(in_flight))
            await asyncio.sleep(0.01)  # yield so the sibling can start
            if step == "embed":
                embed_dir.mkdir(parents=True, exist_ok=True)
                (embed_dir / "prot_t5.h5").write_bytes(b"H5")
            else:
                annotations_path.write_bytes(b"P")
            in_flight.discard(step)
        elif step == "project":
            project_dir.mkdir(parents=True, exist_ok=True)
            (project_dir / "projections_metadata.parquet").write_bytes(b"M")
            (project_dir / "projections_data.parquet").write_bytes(b"D")
        elif step == "bundle":
            bundle_path.write_bytes(b"BUNDLE")
        return _mock_subprocess(returncode=0)

    settings = load_settings()
    with patch("asyncio.create_subprocess_exec", new=fake_create):
        await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    assert max_in_flight[0] == 2, "embed and annotate did not run concurrently"


async def test_embed_failure_raises_pipeline_failure(ctx):
    settings = load_settings()
    fake = _make_step_router(
        ctx,
        fail_step="embed",
        fail_stderr=[b"ERROR Biocentral returned 503: unavailable\n"],
    )
    with patch("asyncio.create_subprocess_exec", new=fake):
        with pytest.raises(PipelineFailure) as exc:
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    # Raw subprocess stderr is kept in `detail` (for logs), never in the
    # curated user-facing message.
    assert "Biocentral returned 503" in (exc.value.detail or "")
    assert "Biocentral returned 503" not in str(exc.value)
    assert "embedding step failed" in str(exc.value)


async def test_annotate_failure_raises_pipeline_failure(ctx):
    settings = load_settings()
    fake = _make_step_router(
        ctx,
        fail_step="annotate",
        fail_stderr=[b"ERROR UniProt query failed\n"],
    )
    with patch("asyncio.create_subprocess_exec", new=fake):
        with pytest.raises(PipelineFailure) as exc:
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    assert "UniProt" in (exc.value.detail or "")
    assert "UniProt" not in str(exc.value)
    assert "annotation step failed" in str(exc.value)


async def test_pipeline_timeout_kills_subprocess_and_raises(ctx):
    proc = MagicMock()
    proc.returncode = None
    proc.kill = MagicMock()
    proc.stderr = MagicMock()

    async def _readline():
        await asyncio.sleep(60)
        return b""

    proc.stderr.readline = _readline

    async def _wait():
        await asyncio.sleep(60)
        return 0

    proc.wait = _wait

    async def fake_create(*args, **kwargs):
        return proc

    base = load_settings()
    fields = {k: getattr(base, k) for k in base.__slots__}
    fields["pipeline_timeout_seconds"] = 0
    settings = type(base)(**fields)
    with patch("asyncio.create_subprocess_exec", new=fake_create):
        with pytest.raises(PipelineFailure) as exc:
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    assert "timed out" in str(exc.value).lower()
    assert proc.kill.called


async def test_missing_bundle_after_success_raises_pipeline_failure(ctx):
    """Every step exits 0 but the bundle file never appears on disk."""
    embed_dir = ctx.output_dir / "embed"
    annotations_path = ctx.output_dir / "annotations.parquet"

    async def fake_create(*args, **kwargs):
        step = args[1] if len(args) > 1 else ""
        if step == "embed":
            embed_dir.mkdir(parents=True, exist_ok=True)
            (embed_dir / "prot_t5.h5").write_bytes(b"H5")
        elif step == "annotate":
            annotations_path.write_bytes(b"P")
        # project and bundle "succeed" but write nothing.
        return _mock_subprocess(returncode=0)

    settings = load_settings()
    with patch("asyncio.create_subprocess_exec", new=fake_create):
        with pytest.raises(PipelineFailure):
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)


async def test_missing_h5_after_embed_raises_pipeline_failure(ctx):
    """Embed exits 0 but no H5 file appears — surface a clear failure."""

    async def fake_create(*args, **kwargs):
        return _mock_subprocess(returncode=0)

    settings = load_settings()
    with patch("asyncio.create_subprocess_exec", new=fake_create):
        with pytest.raises(PipelineFailure) as exc:
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    assert "no HDF5" in str(exc.value)


def test_normalize_fasta_headers_strips_uniprot_prefix(tmp_path: Path):
    """UniProt sp|/tr| headers must collapse to the bare accession.

    Embed/project key by the FASTA header's first token, while annotate
    parses it. If the two diverge (raw vs parsed), the bundle's annotation
    join silently drops every row.
    """
    src = tmp_path / "in.fasta"
    src.write_text(
        ">sp|P12345|TEST_HUMAN Test protein\nMAAA\n"
        ">tr|Q67890|FOO_HUMAN Another\nMBBB\n"
        ">my_custom_id description here\nMCCC\n"
    )
    dst = tmp_path / "out.fasta"
    _normalize_fasta_headers(src, dst)

    headers = [
        line[1:].strip()
        for line in dst.read_text().splitlines()
        if line.startswith(">")
    ]
    assert headers == ["P12345", "Q67890", "my_custom_id"]


async def test_pipeline_uses_normalized_fasta_for_embed_and_annotate(ctx):
    """Both subprocess calls must point at the normalized FASTA.

    Otherwise embed keys H5 by ``sp|P12345|NAME`` while annotate keys parquet
    by ``P12345``, and the frontend bundle join produces no annotations.
    """
    ctx.fasta_path.write_text(">sp|P12345|TEST_HUMAN\nMAAAAAA\n")
    seen_inputs: dict[str, str] = {}

    embed_dir = ctx.output_dir / "embed"
    project_dir = ctx.output_dir / "project"
    annotations_path = ctx.output_dir / "annotations.parquet"
    bundle_path = ctx.output_dir / "data.parquetbundle"

    async def fake_create(*args, **kwargs):
        cmd = list(args)
        step = cmd[1]
        if step in {"embed", "annotate"}:
            seen_inputs[step] = cmd[cmd.index("-i") + 1]
        if step == "embed":
            embed_dir.mkdir(parents=True, exist_ok=True)
            (embed_dir / "prot_t5.h5").write_bytes(b"H5")
        elif step == "annotate":
            annotations_path.write_bytes(b"P")
        elif step == "project":
            project_dir.mkdir(parents=True, exist_ok=True)
            (project_dir / "projections_metadata.parquet").write_bytes(b"M")
            (project_dir / "projections_data.parquet").write_bytes(b"D")
        elif step == "bundle":
            bundle_path.write_bytes(b"BUNDLE")
        return _mock_subprocess(returncode=0)

    settings = load_settings()
    with patch("asyncio.create_subprocess_exec", new=fake_create):
        await run_protspace_prepare(ctx, AsyncMock(), settings=settings)

    normalized = ctx.output_dir / "input.normalized.fasta"
    assert seen_inputs["embed"] == str(normalized)
    assert seen_inputs["annotate"] == str(normalized)
    assert ">P12345" in normalized.read_text()


async def test_embed_failure_with_connection_refused_is_classified_as_biocentral_unavailable(
    ctx,
):
    settings = load_settings()
    fake = _make_step_router(
        ctx,
        fail_step="embed",
        fail_stderr=[
            b"aiohttp.ClientConnectorError: Cannot connect to host biocentral.example.com:443\n"
        ],
    )
    with patch("asyncio.create_subprocess_exec", new=fake):
        with pytest.raises(PipelineFailure) as exc_info:
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    assert exc_info.value.code == "BIOCENTRAL_UNAVAILABLE"
    assert "Biocentral embedding service is unavailable" in str(exc_info.value)


async def test_embed_failure_with_no_healthy_service_timeout_is_classified_as_biocentral_unavailable(
    ctx,
):
    settings = load_settings()
    fake = _make_step_router(
        ctx,
        fail_step="embed",
        fail_stderr=[
            b"TimeoutError: No healthy biocentral service became available in time\n"
        ],
    )
    with patch("asyncio.create_subprocess_exec", new=fake):
        with pytest.raises(PipelineFailure) as exc_info:
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    assert exc_info.value.code == "BIOCENTRAL_UNAVAILABLE"
    assert "Biocentral embedding service is unavailable" in str(exc_info.value)


async def test_embed_failure_with_unrelated_error_passes_through(ctx):
    settings = load_settings()
    fake = _make_step_router(
        ctx,
        fail_step="embed",
        fail_stderr=[b"some random parse error\n"],
    )
    with patch("asyncio.create_subprocess_exec", new=fake):
        with pytest.raises(PipelineFailure) as exc_info:
            await run_protspace_prepare(ctx, AsyncMock(), settings=settings)
    assert exc_info.value.code is None
    assert "some random parse error" in (exc_info.value.detail or "")
    assert "some random parse error" not in str(exc_info.value)


def test_classify_failure_matches_503_service_unavailable():
    exc = PipelineFailure("protspace embed exited with code 1: 503 Service Unavailable")
    result = _classify_failure(exc)
    assert result.code == "BIOCENTRAL_UNAVAILABLE"
    assert "Biocentral embedding service is unavailable" in str(result)
