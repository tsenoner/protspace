"""Reaching the Biocentral server: one address, one wait, and a failure that says why.

The ``biocentral-api`` client only talks to servers whose major version lies inside a
window it hard-codes (1.x: v1; 2.x: v2), and it reports a server outside that window
exactly as it reports a dead one: ``wait_until_healthy`` polls, then raises
``TimeoutError("No healthy biocentral service became available in time")``. When
Biocentral moved to v2 under a pinned 1.x client, every embedding and prediction failed
with those words and the hosted app told users the service was down.

:func:`wait_for_server` keeps the client's wait and, when it fails, looks at the server
once to say which of the two it was. It lives outside ``data/embedding`` so annotation
can use it without importing the embedder shortcut tables, which resolve the client's
``CommonEmbedder`` members at import.
"""

import importlib.metadata

import requests
from biocentral_api import BiocentralAPI

BIOCENTRAL_URL = "https://biocentral.rostlab.org"

_WAIT_SECONDS = 30
_HEALTH_TIMEOUT_SECONDS = 5

# Every message starts with these words: the prep service matches them
# (`_BIOCENTRAL_DOWN_PATTERNS` in apps/prep) to route a failure to BIOCENTRAL_UNAVAILABLE
# and the Colab hint, and a server this client cannot use is unavailable to it.
_LEAD = "No healthy Biocentral service became available in time"

# Read once, at import, so tests that swap `BiocentralAPI` for a fake leave the
# messages alone.
_CLIENT_WINDOW = (BiocentralAPI.MIN_API_VERSION, BiocentralAPI.MAX_API_VERSION)
try:
    _CLIENT_VERSION = importlib.metadata.version("biocentral-api")
except importlib.metadata.PackageNotFoundError:
    _CLIENT_VERSION = "unknown"


class BiocentralUnavailableError(ValueError):
    """No Biocentral server this client can use is available.

    A ``ValueError`` because that is what ``protspace embed`` and ``protspace prepare``
    already catch to print ``ERROR: <message>`` and exit 1; anything else escapes as a
    traceback.
    """


def wait_for_server(api):
    """Return *api* once its server is healthy; otherwise say why it never was.

    Takes the client already built, so each caller keeps constructing it where its own
    tests replace it. A successful wait costs nothing extra: ``/health`` is looked at
    only after the client's wait has failed.
    """
    try:
        return api.wait_until_healthy(max_wait_seconds=_WAIT_SECONDS)
    except TimeoutError as exc:
        raise BiocentralUnavailableError(_explain_unavailable()) from exc


def _explain_unavailable() -> str:
    """Why no server was usable, from one look at the server's ``/health``."""
    try:
        response = requests.get(
            f"{BIOCENTRAL_URL}/health", timeout=_HEALTH_TIMEOUT_SECONDS
        )
    except requests.RequestException as exc:
        return f"{_LEAD}: {BIOCENTRAL_URL} did not answer its health check ({exc})."

    if response.status_code != 200:
        return (
            f"{_LEAD}: {BIOCENTRAL_URL} answered its health check with "
            f"HTTP {response.status_code} {response.reason}."
        )

    try:
        version = str(response.json()["version"])
        major = int(version.split(".")[0])
    except (ValueError, KeyError, TypeError):
        return (
            f"{_LEAD}: {BIOCENTRAL_URL} answered its health check without a "
            "readable version."
        )

    # As numbers: the client compares the same majors as strings, which puts "10"
    # between "2" and "3".
    lowest, highest = (int(v.split(".")[0]) for v in _CLIENT_WINDOW)
    supported = f"v{_CLIENT_WINDOW[0]} up to (not including) v{_CLIENT_WINDOW[1]}"
    client = f"biocentral-api {_CLIENT_VERSION}"

    if lowest <= major < highest:
        return (
            f"{_LEAD}: {BIOCENTRAL_URL} reports v{version}, which {client} supports, "
            "but it did not pass the client's health check in time."
        )
    if major >= highest:
        # The Python floor is spelled out because on an older Python pip does not
        # fail: it keeps the old release. test_biocentral_connection pins it to
        # `requires-python`.
        return (
            f"{_LEAD}: {BIOCENTRAL_URL} runs Biocentral v{version}, but the "
            f"installed {client} only supports servers {supported}. Upgrade with "
            "`pip install -U protspace` (needs Python 3.12 or newer)."
        )
    return (
        f"{_LEAD}: {BIOCENTRAL_URL} runs Biocentral v{version}, which is older than "
        f"the servers {supported} that the installed {client} supports."
    )
