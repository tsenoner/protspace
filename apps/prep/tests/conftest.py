import asyncio
import atexit
import os
import shutil
import tempfile

# Set the job root before importing the app, so the module-level create_app()
# call uses a writable directory on developer machines.
# Fix 7: register an atexit handler so the temp dir is cleaned up after the
# test session ends (previously it leaked on every test run).
_TEST_JOB_ROOT = tempfile.mkdtemp(prefix="protspace-prep-test-")
os.environ.setdefault("PREP_JOB_ROOT", _TEST_JOB_ROOT)
atexit.register(shutil.rmtree, _TEST_JOB_ROOT, ignore_errors=True)

import pytest
from httpx import ASGITransport, AsyncClient

from protspace_prep.app import create_app


class GatedPipeline:
    """A fake pipeline that holds each job until ``release`` is set.

    ``started`` is set as soon as a job is inside the pipeline, i.e. it holds a
    concurrency slot and counts as running. Released jobs write a bundle.
    """

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def __call__(self, ctx, emit):
        self.started.set()
        await self.release.wait()
        bundle = ctx.output_dir / "data.parquetbundle"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_bytes(b"x")
        return bundle


@pytest.fixture
def gated_pipeline() -> GatedPipeline:
    return GatedPipeline()


@pytest.fixture
async def client():
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
