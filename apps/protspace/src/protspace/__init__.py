__version__ = "2.1.2"

from .utils import add_feature_style  # noqa: F401

__all__ = ["add_feature_style"]

try:
    from .server import ProtSpace  # noqa: F401

    __all__.extend(["ProtSpace"])
except ImportError:
    # If the web frontend is needed, please install it, e.g. via `uv sync --all-extras`
    pass
