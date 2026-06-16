"""protlabel.__version__ reports the version it actually ships under."""

from importlib.metadata import version

import protlabel


def test_version_matches_shipped_distribution():
    # protlabel currently ships inside the protspace wheel, so its reported
    # version must track the installed distribution rather than a stale literal.
    assert protlabel.__version__ == version("protspace")
