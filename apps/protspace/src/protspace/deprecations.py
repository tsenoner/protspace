"""Scheduled removals: what is deprecated, when it goes, and what users are told.

Every deprecation warning protspace prints takes its text and its removal version
from :data:`DEPRECATIONS`, so the warning, the ``--help`` text and the two checks
below cannot name different versions.

Two checks keep a release from shipping a feature past its ``remove_in``:

* ``tests/test_deprecations.py`` fails once the package's own version reaches an
  entry's ``remove_in``, on every pull request after the bump;
* ``scripts/check_deprecations.py`` runs in ``.github/workflows/protspace-release.yml``
  against the version semantic-release is about to cut, and fails the release.

So a release that reaches ``remove_in`` is blocked until the feature is gone: do
what the entry's ``removal`` notes say (the full inventory is in the OpenSpec
change that scheduled it), then delete the entry. Everything due in 5.0.0 is
tracked in #544 (milestone v5.0.0).

The web app restates the v1/v2 removal version in TypeScript, which cannot import
this module; ``tests/test_deprecations.py`` pins those copies to the registry.

Standard library only: the release gate loads this file by path, without
protspace or its dependencies installed, and ``cli/common_options.py`` imports it
on every CLI start.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Deprecation:
    """One scheduled removal."""

    key: str
    #: What goes, in words, for the release gate's message.
    feature: str
    #: The first release that must not contain the feature.
    remove_in: str
    #: The warning users see: a ``str.format`` template that always receives
    #: ``remove_in`` and whatever fields the caller passes to :func:`warn`.
    message: str
    #: What the removal involves, as ``"<repo-relative path>: <what to do>"``.
    #: The tests check every path exists, so this list cannot point at moved files.
    removal: tuple[str, ...] = ()

    def text(self, **fields: object) -> str:
        """The warning, formatted with ``remove_in`` and the caller's fields."""
        return self.message.format(remove_in=self.remove_in, **fields)


THREE_D_PROJECTIONS = "3d-projections"
SERVE_COMMAND = "serve-command"
LEGACY_BUNDLE_READ = "legacy-bundle-read"

#: The web viewer users are pointed to instead of ``protspace serve``.
EXPLORE_URL = "https://protspace.app/explore"

_REGISTRY = (
    Deprecation(
        key=THREE_D_PROJECTIONS,
        feature="3-D projections: any -m method with dimension suffix 3, e.g. umap3",
        remove_in="5.0.0",
        message=(
            "3-D projections are deprecated and will be removed in protspace "
            "{remove_in}; use the 2-D variant (e.g. {example}). "
            "Requested 3-D methods: {methods}."
        ),
        removal=(
            "apps/protspace/src/protspace/utils/constants.py: "
            "DimensionReductionConfig.n_components allows 2 only",
            "apps/protspace/src/protspace/data/processors/pipeline.py: "
            "parse_methods_arg rejects a *3 method instead of warning",
            "apps/protspace/src/protspace/cli/common_options.py: "
            "drop the deprecation sentence from -m help",
            "docs/guide/python-cli.md: drop the 3D column under Projection Methods",
        ),
    ),
    Deprecation(
        key=SERVE_COMMAND,
        feature="`protspace serve`, the local Dash viewer, and the `frontend` extra",
        remove_in="5.0.0",
        message=(
            "`protspace serve` (the local Dash viewer) is deprecated and will be "
            "removed in protspace {remove_in}. Explore bundles at "
            f"{EXPLORE_URL} instead: the file is read in your browser and "
            "never uploaded."
        ),
        removal=(
            "apps/protspace/src/protspace/cli/serve.py: delete, and its import "
            "in cli/app.py",
            "apps/protspace/src/protspace/main.py: delete",
            "apps/protspace/src/protspace/app.py: delete",
            "apps/protspace/src/protspace/ui: delete",
            "apps/protspace/src/protspace/visualization: delete",
            "apps/protspace/src/protspace/assets: delete",
            "apps/protspace/src/protspace/core/config.py: delete (Dash-only "
            "constants), with its re-exports in core/__init__.py and "
            "core/constants.is_projection_3d",
            "apps/protspace/pyproject.toml: drop the frontend extra, the dash "
            "dev deps and their filterwarnings; relock",
            "apps/protspace/tests/test_cli_no_frontend.py: delete",
            "apps/protspace/tests/test_display_decode.py: drop the plotting tests",
            "docs/guide/python-cli.md: drop the frontend extra row and the "
            "serve section (README.md's extras row with it)",
        ),
    ),
    Deprecation(
        key=LEGACY_BUNDLE_READ,
        feature="reading v1/v2 .parquetbundle files",
        remove_in="5.0.0",
        message=(
            "{name} uses the v1/v2 parquetbundle format. Reading v1/v2 bundles is "
            "deprecated and will be removed in protspace {remove_in}; run "
            "`protspace convert` to rewrite it as v3 (or re-export it from "
            "protspace.app)."
        ),
        removal=(
            "apps/protspace/src/protspace/data/io/bundle.py: drop the 3-5 part "
            "read path and its warning (see the parquetbundle-v3 OpenSpec change)",
            "apps/protspace/tests/test_convert.py: drop the legacy-read tests",
            "apps/web/src/explore/notifications.ts: drop the legacy-format "
            "notice (the web side is not gated; parquetbundle-v3 task 6.3)",
            "packages/core/src/components/data-loader/utils/bundle.ts: drop the "
            "v1/v2 decode path",
        ),
    ),
)

DEPRECATIONS: dict[str, Deprecation] = {d.key: d for d in _REGISTRY}

_RELEASE = re.compile(r"v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?")


def release_core(version: str) -> tuple[int, int, int]:
    """``MAJOR.MINOR.PATCH`` of *version* as integers.

    A pre-release or build suffix is ignored, so ``5.0.0-rc.1`` counts as 5.0.0:
    a release candidate of the removal release should already be without the
    feature. Anything that is not a version raises, so a garbled input can never
    pass the release gate.
    """
    match = _RELEASE.fullmatch(version.strip())
    if match is None:
        raise ValueError(f"not a MAJOR.MINOR.PATCH version: {version!r}")
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def due(version: str) -> list[Deprecation]:
    """The entries *version* has reached, i.e. that must be gone before it ships."""
    core = release_core(version)
    return [d for d in _REGISTRY if core >= release_core(d.remove_in)]


def warn(key: str, logger: logging.Logger, **fields: object) -> str:
    """Log the deprecation warning for *key* on *logger* and return its text.

    The caller passes its own module logger, so the record keeps that logger's
    name.
    """
    text = DEPRECATIONS[key].text(**fields)
    logger.warning("%s", text)
    return text
