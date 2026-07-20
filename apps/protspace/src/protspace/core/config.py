from functools import cache


# https://plotly.com/python/marker-style/
def extract_marker_strings(input_list):
    # Filter out integers and string representations of numbers
    return [item for item in input_list if isinstance(item, str) and not item.isdigit()]


# App settings
DEFAULT_PORT = 8050
HELP_PANEL_WIDTH_PERCENT = 50
SETTINGS_PANEL_WIDTH_PERCENT = 20

# Plotting settings
DEFAULT_LINE_WIDTH = 0.5
HIGHLIGHT_LINE_WIDTH = 1.5
HIGHLIGHT_MARKER_SIZE = 15

# Color settings
NAN_COLOR = "lightgrey"
HIGHLIGHT_COLOR = "rgba(0,0,0,0)"
HIGHLIGHT_BORDER_COLOR = "black"

# Marker shapes
MARKER_SHAPES_3D = [
    "circle",
    "circle-open",
    "cross",
    "diamond",
    "diamond-open",
    "square",
    "square-open",
    "x",
]


# plotly ships only in the `frontend` extra, so it must stay out of the import
# path — the CLI (embed/project/transfer) imports this module too.
@cache
def _marker_shapes_2d():
    try:
        from plotly.validator_cache import ValidatorCache
    except ImportError as exc:
        # AttributeError keeps hasattr()/getattr(default) probes working on
        # core-only installs instead of exploding with ModuleNotFoundError.
        raise AttributeError(
            "MARKER_SHAPES_2D requires plotly: pip install 'protspace[frontend]'"
        ) from exc

    validator = ValidatorCache.get_validator("scatter.marker", "symbol")
    return sorted(extract_marker_strings(validator.values))


def __getattr__(name):
    if name == "MARKER_SHAPES_2D":
        return _marker_shapes_2d()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
