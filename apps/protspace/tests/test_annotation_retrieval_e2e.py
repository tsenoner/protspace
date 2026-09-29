"""One `prepare` run through the real retrievers, with HTTP answered offline.

The retriever and pipeline fixes are tested on their own elsewhere. This test
checks that they meet end to end: the release UniProt reports in its response
header reaches `run.log`, proteins sharing a sequence both get InterPro's
matches in the bundle, and the bundle carries no internal column.
"""

import hashlib
import io
import json

import h5py
import numpy as np
import pyarrow.parquet as pq
import pytest
import requests
from requests.structures import CaseInsensitiveDict
from typer.testing import CliRunner

from protspace.cli.app import app
from protspace.data.annotations.configuration import INTERNAL_ANNOTATIONS
from protspace.data.io.bundle import read_bundle

SHARED = "MKTAYIAKQRQISFVKSHFSRQ"
UNIQUE = "MVLSPADKTNVKAAWGKVGAHA"
SEQUENCES = {"P11111": SHARED, "P22222": SHARED, "P33333": UNIQUE}
PFAM = {SHARED: ("PF00001", "7tm_1", 50.2), UNIQUE: ("PF00002", "7tm_2", 60.5)}
RELEASE = "2026_03"


def _md5(sequence: str) -> str:
    return hashlib.md5(sequence.encode("utf-8")).hexdigest().upper()


def _uniprot_record(accession: str) -> dict:
    sequence = SEQUENCES[accession]
    return {
        "primaryAccession": accession,
        "uniProtkbId": f"{accession}_HUMAN",
        "sequence": {"value": sequence, "length": len(sequence)},
        "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
        "proteinDescription": {
            "recommendedName": {"fullName": {"value": f"Protein {accession}"}}
        },
        "genes": [{"geneName": {"value": f"G{accession}"}}],
        "entryType": "UniProtKB reviewed (Swiss-Prot)",
        "annotationScore": 5.0,
        "proteinExistence": "1: Evidence at protein level",
        "comments": [],
        "uniProtKBCrossReferences": [],
        "keywords": [],
    }


def _response(url: str, body: dict, headers: dict | None = None) -> requests.Response:
    response = requests.Response()
    response.url = url
    response.status_code = 200
    response.headers = CaseInsensitiveDict(headers or {})
    response._content = json.dumps(body).encode()
    return response


@pytest.fixture
def offline_apis(monkeypatch):
    """Answer UniProt's accessions endpoint and InterPro's matches endpoint.

    Any other request fails the test, so nothing reaches the network.
    """
    requested: list[str] = []

    def fake_get(url, params=None, timeout=None, **_kwargs):
        requested.append(url)
        assert url == "https://rest.uniprot.org/uniprotkb/accessions", url
        accessions = params["accessions"].split(",")
        return _response(
            url,
            {"results": [_uniprot_record(a) for a in accessions]},
            # Real servers send the header lower-case.
            {"x-uniprot-release": RELEASE},
        )

    def fake_post(url, json=None, headers=None, timeout=None, **_kwargs):
        requested.append(url)
        assert url == "https://www.ebi.ac.uk/interpro/matches/api/matches", url
        by_md5 = {_md5(sequence): sequence for sequence in PFAM}
        results = []
        for md5 in json["md5"]:
            accession, name, score = PFAM[by_md5[md5]]
            results.append(
                {
                    "md5": md5,
                    "found": True,
                    "matches": [
                        {
                            "signature": {
                                "accession": accession,
                                "name": name,
                                "signatureLibraryRelease": {"library": "Pfam"},
                            },
                            "score": score,
                        }
                    ],
                }
            )
        return _response(url, {"results": results})

    # The retrievers send through a session; anything else still goes
    # through the module-level functions. Both lead here.
    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(
        requests.Session, "get", lambda _session, url, **kw: fake_get(url, **kw)
    )
    monkeypatch.setattr(
        requests.Session, "post", lambda _session, url, **kw: fake_post(url, **kw)
    )
    return requested


def _h5(tmp_path):
    path = tmp_path / "emb.h5"
    rng = np.random.default_rng(0)
    with h5py.File(path, "w") as f:
        for identifier in SEQUENCES:
            f.create_dataset(identifier, data=rng.normal(size=8).astype(np.float32))
    return path


def test_prepare_logs_the_release_and_fans_interpro_out(tmp_path, offline_apis):
    output_dir = tmp_path / "out"

    result = CliRunner().invoke(
        app,
        [
            "prepare",
            "-i",
            f"{_h5(tmp_path)}:E",
            "-a",
            "pfam",
            "-m",
            "pca2",
            "-o",
            str(output_dir),
        ],
    )

    assert result.exit_code == 0, result.output
    # One UniProt batch and one InterPro batch holding each sequence once.
    assert len(offline_apis) == 2

    run_log = (output_dir / "run.log").read_text().splitlines()
    assert f"uniprot_release: {RELEASE}" in run_log

    (bundle_path,) = output_dir.glob("*.parquetbundle")
    parts, _ = read_bundle(bundle_path)
    annotations = pq.read_table(io.BytesIO(parts[0]))
    assert not set(INTERNAL_ANNOTATIONS) & set(annotations.column_names)
    id_col = annotations.column_names[0]
    pfam = {row[id_col]: row["pfam"] for row in annotations.to_pylist()}
    assert pfam == {
        "P11111": "PF00001 (7tm_1)|50.2",
        "P22222": "PF00001 (7tm_1)|50.2",
        "P33333": "PF00002 (7tm_2)|60.5",
    }
