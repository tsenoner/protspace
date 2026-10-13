"""Fixtures shared across the protspace test modules."""

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def sample_data():
    """Three proteins with 10-d embeddings and a small metadata frame.

    Built fresh for every test (seeded RNG, new DataFrame), so no test can
    leak a mutation into another.
    """
    headers = ["P12345", "P67890", "P11111"]
    return {
        "headers": headers,
        "embeddings": np.random.default_rng(0).random((3, 10)),
        "metadata": pd.DataFrame(
            {
                "identifier": headers,
                "length": [100, 150, 200],
                "organism": ["Homo sapiens", "Homo sapiens", "Homo sapiens"],
            }
        ),
    }
