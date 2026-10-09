"""Fixtures shared across the protspace test modules."""

import logging

import numpy as np
import pandas as pd
import pytest


@pytest.fixture(autouse=True)
def _restore_root_logging():
    """``setup_logging`` in the CLI swaps the root handlers for one bound to the
    runner's stderr, which is closed once ``invoke`` returns. Undo it after every
    test, or a later command that logs without calling ``setup_logging``
    (``style``) writes a ``--- Logging error ---`` traceback into its output."""
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers[:] = handlers
    root.setLevel(level)


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
