__version__ = "2.0.1"

from .data import local_data_processor
from .utils import add_feature_style

__all__ = ["local_data_processor", "add_feature_style"]

try:
    from .server import app
    from .main import main

    __all__.extend(["main", "app"])
except ImportError:
    # If the web frontend is needed, please install it, e.g. via `uv sync --all-extras`
    pass
