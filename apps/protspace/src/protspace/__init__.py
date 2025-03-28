__version__ = "1.1.7"

from .utils import add_feature_style, prepare_json

__all__ = ["prepare_json", "add_feature_style"]

try:
    from . import app, main
    __all__.extend(["main", "app"])
except ImportError:
    # If the web frontend is needed, please install it, e.g. via `uv sync --all-extras`
    pass