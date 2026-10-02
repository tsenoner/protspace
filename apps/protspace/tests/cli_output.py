"""Matching CLI output in tests the same way locally and in CI."""

import re

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def plain(output: str) -> str:
    """Rich's output, flattened to one line of matchable text.

    Three things stand between a message and a substring check: colour codes,
    which Rich emits whenever `FORCE_COLOR`/a TTY says to and which land *inside*
    a message (option names such as `--in-place` are styled), so it is no longer
    contiguous; the error box's border glyphs; and the wrapping that splits a
    message across lines. GitHub Actions sets FORCE_COLOR, so a test that skips
    this passes locally and fails only in CI.
    """
    return " ".join(_ANSI.sub("", output).replace("│", " ").split())
