"""Reaching the Biocentral server: one address, one wait, and a failure that says why.

The ``biocentral-api`` client only talks to servers whose major version lies inside a
window it hard-codes (1.x: v1; 2.x: v2), and it reports a server outside that window
exactly as it reports a dead one: ``wait_until_healthy`` polls, then raises
``TimeoutError("No healthy biocentral service became available in time")``. When
Biocentral moved to v2 under a pinned 1.x client, every embedding and prediction failed
with those words and the hosted app told users the service was down.

:func:`wait_for_server` keeps the client's wait and, when it fails, looks at the server
once to say which of the two it was. It imports nothing from the client and sits outside
``data/embedding``, so annotation can use it without the embedder shortcut tables and
nothing about the client can break its import.
"""

import importlib.metadata

import requests

BIOCENTRAL_URL = "https://biocentral.rostlab.org"

_WAIT_SECONDS = 30
_HEALTH_TIMEOUT_SECONDS = 5

# Every message starts with these words: the prep service matches them
# (`_BIOCENTRAL_DOWN_PATTERNS` in apps/prep) to route a failure to BIOCENTRAL_UNAVAILABLE
# and the Colab hint, and a server this client cannot use is unavailable to it.
_LEAD = "No healthy Biocentral service became available in time"

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
    tests replace it, and reads the versions it supports off that client. A successful
    wait costs nothing extra: ``/health`` is looked at only after the client's wait has
    failed.
    """
    try:
        return api.wait_until_healthy(max_wait_seconds=_WAIT_SECONDS)
    except TimeoutError as exc:
        why = _why_unusable(api.MIN_API_VERSION, api.MAX_API_VERSION)
        raise BiocentralUnavailableError(f"{_LEAD}: {BIOCENTRAL_URL} {why}") from exc


def _major(version: str) -> int:
    return int(version.split(".")[0])


def _why_unusable(lowest: str, highest: str) -> str:
    """Why no server was usable, from one look at ``/health``.

    Returns the clause that follows the address. The client accepts servers from
    *lowest* up to, not including, *highest*.
    """
    try:
        response = requests.get(
            f"{BIOCENTRAL_URL}/health", timeout=_HEALTH_TIMEOUT_SECONDS
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        return f"did not answer its health check ({exc})."

    try:
        version = str(response.json()["version"])
        major = _major(version)
    except (ValueError, KeyError, TypeError):
        return "answered its health check without a readable version."

    supported = f"v{lowest} up to (not including) v{highest}"
    client = f"biocentral-api {_CLIENT_VERSION}"

    # Majors as numbers: the client compares them as strings, where "10" sorts before
    # "2".
    if major >= _major(highest):
        return (
            f"runs Biocentral v{version}, but the installed {client} only supports "
            f"servers {supported}. Upgrade with `pip install -U protspace`."
        )
    if major < _major(lowest):
        return (
            f"runs Biocentral v{version}, which is older than the servers {supported} "
            f"that the installed {client} supports."
        )
    return (
        f"reports v{version}, which {client} supports, but it did not pass the "
        "client's health check in time."
    )
