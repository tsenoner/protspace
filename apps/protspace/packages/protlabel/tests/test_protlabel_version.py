"""protlabel.__version__ reports the version it actually ships under."""

from importlib.metadata import version

import protlabel


def test_version_matches_shipped_distribution():
    # protlabel ships as its own distribution; its reported version must track
    # the installed distribution metadata rather than a stale literal.
    assert protlabel.__version__ == version("protlabel")
