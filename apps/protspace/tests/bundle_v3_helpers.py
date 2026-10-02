"""Builders and part readers shared by the parquetbundle v3 tests.

The part readers are the production ones: the decoder's own tests (and the
fixture test's independent label oracle) pin them, so the encoder and container
tests can read parts back through them.
"""

from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa

from protspace.data.io import bundle_v3
from protspace.data.io.bundle import PARQUET_BUNDLE_DELIMITER
from protspace.data.processors.base_processor import BaseProcessor

read = bundle_v3.read_part
payloads_of = bundle_v3._read_payloads
labels_of = bundle_v3._read_labels


def annotations_table(**columns: list[str]) -> pa.Table:
    """An annotations table exactly as the pipeline builds it (all-string, v2)."""
    n = len(next(iter(columns.values())))
    frame = pd.DataFrame({"identifier": [f"p{i}" for i in range(n)], **columns})
    return BaseProcessor({}, {})._create_protein_annotations_table(frame)


def projection_tables(num_rows: int, dimensions=(2, 3)):
    """``projections_metadata`` + long ``projections_data`` for ``num_rows`` proteins."""
    processor = BaseProcessor({}, {})
    reductions = [
        {
            "name": f"PCA {dimension}",
            "dimensions": dimension,
            "info": {"components": dimension},
            "data": np.arange(num_rows * dimension, dtype=np.float32).reshape(
                num_rows, dimension
            ),
        }
        for dimension in dimensions
    ]
    headers = [f"p{i}" for i in range(num_rows)]
    return (
        processor._create_projections_metadata_table(reductions),
        processor._create_projections_data_table(reductions, headers),
    )


def manifest_of(part1: bytes) -> dict:
    return bundle_v3._read_manifest(part1)[0]


def parts_of(path: Path) -> list[bytes]:
    return path.read_bytes().split(PARQUET_BUNDLE_DELIMITER)
