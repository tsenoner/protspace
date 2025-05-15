__version__ = "1.2.0"

from .data import prepare_json
from .utils import add_feature_style

__all__ = ["prepare_json", "add_feature_style"]

try:
    from .server import app
    from .main import main
    __all__.extend(["main", "app"])
except ImportError:
    # If the web frontend is needed, please install it, e.g. via `uv sync --all-extras`
    pass
