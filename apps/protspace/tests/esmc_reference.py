"""Reference ESM-C vectors both embedding backends are held to.

Ubiquitin embedded by the local backend from biohub/ESMC-300M / -600M (transformers
5.21.0, torch 2.14.1, CPU, float32), mean-pooled as the package pools. One per size:
the Biocentral server maps each id to a model separately. The live canary checks the
server against them; the slow local test checks a newer transformers against them.
"""

from pathlib import Path

import numpy as np

UBIQUITIN = (
    "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
)

_DATA = Path(__file__).parent / "data"

# Short key -> (reference vector file, embedding dimension).
ESMC_UBIQUITIN = {
    "esmc_300m": (_DATA / "esmc_300m_ubiquitin.npy", 960),
    "esmc_600m": (_DATA / "esmc_600m_ubiquitin.npy", 1152),
}


def cosine_to_reference(key: str, vector: np.ndarray) -> float:
    """Cosine between *vector* and the committed reference for *key*.

    Asserts the shapes match first, since a wrong model can have another width.
    """
    path, dim = ESMC_UBIQUITIN[key]
    served = np.asarray(vector, dtype=np.float64)
    reference = np.load(path).astype(np.float64)
    assert served.shape == reference.shape == (dim,), (served.shape, dim)
    return float(
        served @ reference / np.linalg.norm(served) / np.linalg.norm(reference)
    )
