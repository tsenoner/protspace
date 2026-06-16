"""protlabel — Embedding Annotation Transfer (EAT) engine.

Nearest-neighbour label transfer in protein-language-model embedding space,
with the goPredSim reliability index. Pure numpy (plus the standard library);
no protspace imports.
"""

from importlib.metadata import PackageNotFoundError, version

from protlabel.lookup import Lookup
from protlabel.transfer import Prediction, eat

try:
    # protlabel currently ships inside the protspace wheel; report that version
    # rather than a hard-coded literal that would silently drift across releases.
    # (Reads distribution metadata by name — it does not import protspace.)
    __version__ = version("protspace")
except PackageNotFoundError:  # pragma: no cover - source/uninstalled fallback
    __version__ = "0.0.0"

__all__ = ["Lookup", "Prediction", "eat", "__version__"]
