"""Core configuration and constants for ProtSpace."""

from . import config
from .config import (
    DEFAULT_LINE_WIDTH,
    DEFAULT_PORT,
    HELP_PANEL_WIDTH_PERCENT,
    HIGHLIGHT_BORDER_COLOR,
    HIGHLIGHT_COLOR,
    HIGHLIGHT_LINE_WIDTH,
    HIGHLIGHT_MARKER_SIZE,
    MARKER_SHAPES_3D,
    NAN_COLOR,
    SETTINGS_PANEL_WIDTH_PERCENT,
)
from .constants import is_projection_3d, standardize_missing

__all__ = [
    "DEFAULT_PORT",
    "HELP_PANEL_WIDTH_PERCENT",
    "SETTINGS_PANEL_WIDTH_PERCENT",
    "DEFAULT_LINE_WIDTH",
    "HIGHLIGHT_LINE_WIDTH",
    "HIGHLIGHT_MARKER_SIZE",
    "NAN_COLOR",
    "HIGHLIGHT_COLOR",
    "HIGHLIGHT_BORDER_COLOR",
    "MARKER_SHAPES_3D",
    "MARKER_SHAPES_2D",
    "standardize_missing",
    "is_projection_3d",
]


def __getattr__(name):
    # MARKER_SHAPES_2D stays lazy (it needs plotly); forward so the historical
    # `from protspace.core import MARKER_SHAPES_2D` keeps working.
    if name == "MARKER_SHAPES_2D":
        return getattr(config, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
