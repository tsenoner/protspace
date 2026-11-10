"""The live Biocentral server, as the package reads it.

Skipped unless PROTSPACE_LIVE_BIOCENTRAL=1, which the daily biocentral-canary workflow
sets: these make real requests to a shared research server, so they never run with the
rest of the suite. They catch what no mocked test can: a server major the locked client
refuses (v2 broke every released client at once), and a server that still answers but
no longer in the words the package reads (a renamed prediction model leaves every
predicted_* column empty without an error).

They also catch a server that answers with the wrong model: Biocentral once returned
ESM-2 vectors for ESM-C, with the right shape and no error, so the ESM-C check compares the
vector itself with one computed locally from the official weights.

An unreachable server is a skip, not a failure: the canary is about version drift, and an
outage has its own status page.
"""

import functools
import os

import h5py
import numpy as np
import pytest
from biocentral_api import BiocentralAPI

from protspace.data.annotations.retrievers.biocentral_retriever import (
    BIOCENTRAL_ANNOTATIONS,
    BiocentralPredictionRetriever,
)
from protspace.data.biocentral_connection import (
    BIOCENTRAL_URL,
    BiocentralUnavailableError,
    wait_for_server,
)
from protspace.data.embedding.biocentral import embed_sequences, resolve_embedder
from tests.esmc_reference import ESMC_UBIQUITIN, UBIQUITIN, cosine_to_reference

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("PROTSPACE_LIVE_BIOCENTRAL") != "1",
        reason="live Biocentral checks: set PROTSPACE_LIVE_BIOCENTRAL=1 (the canary does)",
    ),
]

# Ubiquitin: a small soluble protein. Bacteriorhodopsin: a textbook seven-helix membrane
# protein. Both are well inside the server's 7-5000 residue limits.
BACTERIORHODOPSIN = (
    "MLELLPTAVEGVSQAQITGRPEWIWLALGTALMGLGTLYFLVKGMGVSDPDAKKFYAITTLVPAIAFTMYLSMLLGYGLTM"
    "VPFGGEQNPIYWARYADWLFTTPLLLLDLALLVDADQGTILALVGADGIMIGTGLVGALTKVYSYRFVWWAISTAAMLYIL"
    "YVLFFGFTSKAESMRPEVASTFKVLRNVTVVLWSAYPVVWLIGSEGAGIVPLNIETLLFMVLDVSAKVGFGLILLRSRAIF"
    "GEAEAPEPSAGDGAAATSD"
)


@functools.cache
def _usable_server():
    """The client, once the live server is one it can use (checked once per run).

    Skips when the server cannot be reached; raises when it answers but is not a server
    the locked client supports, with the message that names both versions.
    """
    try:
        return wait_for_server(BiocentralAPI(fixed_server_url=BIOCENTRAL_URL))
    except BiocentralUnavailableError as exc:
        if "did not answer its health check" in str(exc):
            pytest.skip(f"Biocentral is not reachable from here: {exc}")
        raise


def test_the_live_server_is_one_the_locked_client_can_use():
    assert _usable_server() is not None


def test_embedding_through_the_package(tmp_path):
    _usable_server()

    h5_path = embed_sequences(
        {"ubiquitin": UBIQUITIN, "bacteriorhodopsin": BACTERIORHODOPSIN},
        resolve_embedder("prot_t5"),
        tmp_path / "prot_t5.h5",
    )

    with h5py.File(h5_path) as h5:
        assert set(h5) == {"ubiquitin", "bacteriorhodopsin"}
        for name in h5:
            assert h5[name].shape == (1024,), name
            assert np.isfinite(h5[name][:]).all(), name


@pytest.mark.parametrize("key", sorted(ESMC_UBIQUITIN))
def test_esmc_is_the_official_model(tmp_path, key):
    """Shape and finiteness would have passed the old bug; only the vector tells.

    Measured agreement with the local backend is about 1e-7 in cosine; the old
    wrong-model answer scored about 0.02, so 0.999 leaves room for a precision
    change on the server without letting another model through.
    """
    _usable_server()

    h5_path = embed_sequences(
        {"ubiquitin": UBIQUITIN}, resolve_embedder(key), tmp_path / f"{key}.h5"
    )

    with h5py.File(h5_path) as h5:
        cosine = cosine_to_reference(key, h5["ubiquitin"][:])
    assert cosine > 0.999, f"Biocentral's {key} vector has cosine {cosine:.4f}"


def test_annotation_predictions_through_the_package():
    _usable_server()
    sequences = {"ubiquitin": UBIQUITIN, "bacteriorhodopsin": BACTERIORHODOPSIN}
    retriever = BiocentralPredictionRetriever(
        headers=list(sequences),
        annotations=BIOCENTRAL_ANNOTATIONS,
        sequences=sequences,
    )

    rows = {row.identifier: row.annotations for row in retriever.fetch_annotations()}

    assert not retriever.prediction_failed
    # An empty cell is how a renamed model or a changed answer shows up: nothing fails.
    for name, annotations in rows.items():
        assert all(annotations[a] for a in BIOCENTRAL_ANNOTATIONS), (name, annotations)
    assert rows["ubiquitin"]["predicted_membrane"] == "Soluble"
    assert rows["bacteriorhodopsin"]["predicted_membrane"] == "Membrane"
    assert rows["bacteriorhodopsin"]["predicted_transmembrane"].startswith(
        "alpha-helical"
    )
