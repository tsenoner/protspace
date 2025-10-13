from plotly.validator_cache import ValidatorCache


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
SymbolValidator = ValidatorCache.get_validator("scatter.marker", "symbol")
MARKER_SHAPES_2D = sorted(extract_marker_strings(SymbolValidator.values))
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
