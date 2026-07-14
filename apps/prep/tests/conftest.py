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


@pytest.fixture
async def client():
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
