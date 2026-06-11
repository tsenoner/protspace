"""protlabel — Embedding Annotation Transfer (EAT) engine.

Nearest-neighbour label transfer in protein-language-model embedding space,
with the goPredSim reliability index. Pure numpy/scipy/h5py; no protspace imports.
"""

from protlabel.lookup import Lookup
from protlabel.transfer import Prediction, eat

__version__ = "0.1.0"

__all__ = ["Lookup", "Prediction", "eat", "__version__"]
