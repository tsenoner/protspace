"""
Shared test configuration for all test modules.

This module provides common test data, fixtures, and configuration
that can be used across all test files to ensure consistency.
"""

import gzip
import tempfile
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

# Test constants
SAMPLE_QUERY = "organism_id:9606 AND keyword:insulin"
SAMPLE_HEADERS = ["P01308", "P01315", "P01316"]
SAMPLE_FASTA_CONTENT = """>sp|P01308|INS_HUMAN Insulin OS=Homo sapiens OX=9606 GN=INS PE=1 SV=1
MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN
>sp|P01315|INSL3_HUMAN Insulin-like 3 OS=Homo sapiens OX=9606 GN=INSL3 PE=1 SV=1
MDSLLSASLVLLALSLALTCSGQPAAPEMVKLCGRELVRAQIAICGMSTWKRQAAGNKLRRLMYAKRCCESFIRALEDGCFWK
>sp|P01316|INSL4_HUMAN Insulin-like 4 OS=Homo sapiens OX=9606 GN=INSL4 PE=1 SV=1
MDSLLSASLVLLALSLALTCSGQPAAPEMVKLCGRELVRAQIAICGMSTWKRQAAGNKLRRLMYAKRCCESFIRALEDGCFWK
"""

SAMPLE_SIMILARITY_MATRIX = np.array([[1.0, 0.8, 0.7], [0.8, 1.0, 0.9], [0.7, 0.9, 1.0]])

SAMPLE_METADATA_DF = pd.DataFrame(
    {
        "identifier": SAMPLE_HEADERS,
        "length": [110, 142, 142],
        "organism": ["Homo sapiens", "Homo sapiens", "Homo sapiens"],
    }
)

# Test identifiers for various scenarios
TEST_IDENTIFIERS = {
    "basic": ["P12345", "P67890", "P11111"],
    "empty": [],
    "single": ["P12345"],
    "long": [f"P{i:05d}" for i in range(1000)],
}

# Sample data for output generation tests
SAMPLE_OUTPUT_DATA = {
    "headers": TEST_IDENTIFIERS["basic"],
    "embeddings": np.random.rand(3, 10),
    "metadata": pd.DataFrame(
        {
            "identifier": TEST_IDENTIFIERS["basic"],
            "length": [100, 150, 200],
            "organism": ["Homo sapiens", "Homo sapiens", "Homo sapiens"],
        }
    ),
}

# Common test configuration
COMMON_CONFIG = {
    "n_components": 2,
    "random_state": 42,
    "n_neighbors": 15,
    "min_dist": 0.1,
    "perplexity": 30,
    "learning_rate": 200,
    "max_iter": 1000,
    "eps": 0.1,
}

# CLI-specific configuration (will be cleaned in processors)
CLI_CONFIG = {
    **COMMON_CONFIG,
    "query": "test_query",
    "sp": True,
    "output": "output.json",
    "methods": ["pca"],
    "verbose": True,
    "custom_names": {"pca2": "Custom_PCA"},
    "delimiter": ",",
    "annotations": "annotations.csv",
    "save_files": True,
    "no_save_files": False,
    "keep_tmp": True,
}


# Pytest fixtures
@pytest.fixture
def mock_config():
    """Provide a basic configuration for processors."""
    return COMMON_CONFIG.copy()


@pytest.fixture
def cli_config():
    """Provide CLI configuration that will be cleaned."""
    return CLI_CONFIG.copy()


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield Path(tmp_dir)


@pytest.fixture
def mock_response():
    """Create a mock HTTP response for UniProt API calls."""
    response = Mock()
    compressed_content = gzip.compress(SAMPLE_FASTA_CONTENT.encode())
    response.headers = {"content-length": str(len(compressed_content))}
    response.iter_content.return_value = [compressed_content]
    response.raise_for_status.return_value = None
    return response


@pytest.fixture
def mock_pymmseqs_df():
    """Create a mock DataFrame for pymmseqs results."""
    return pd.DataFrame(
        {
            "query": ["P01308", "P01308", "P01315", "P01315", "P01316", "P01316"],
            "target": ["P01308", "P01315", "P01315", "P01316", "P01316", "P01308"],
            "fident": [1.0, 0.8, 1.0, 0.9, 1.0, 0.7],
        }
    )


@pytest.fixture
def sample_data():
    """Create sample data for output generation tests."""
    return SAMPLE_OUTPUT_DATA.copy()


@pytest.fixture
def sample_query_data():
    """Create sample data for query processor tests."""
    return SAMPLE_OUTPUT_DATA.copy()


# Test scenarios for different flag combinations
OUTPUT_SCENARIOS = {
    "local_data": [
        # (output_arg, bundled, non_binary, expected_output, expected_intermediate)
        (None, True, False, "data/phosphatase.parquetbundle", None),
        (None, False, False, "data/protspace", None),
        (None, True, True, "data/phosphatase.json", None),
        (
            Path("custom/output.parquetbundle"),
            True,
            False,
            "custom/output.parquetbundle",
            None,
        ),
        (Path("custom/dir"), False, False, "custom/dir", None),
        (Path("custom/output.json"), True, True, "custom/output.json", None),
    ],
    "query": [
        # (output_arg, bundled, non_binary, expected_output, expected_intermediate)
        (None, True, False, "protspace.parquetbundle", None),
        (None, False, False, "protspace", None),
        (None, True, True, "protspace.json", None),
        (
            Path("results/output.parquetbundle"),
            True,
            False,
            "results/output.parquetbundle",
            None,
        ),
        (Path("results/dir"), False, False, "results/dir", None),
        (Path("results/output.json"), True, True, "results/output.json", None),
    ],
}

# FASTA content for different test scenarios
FASTA_CONTENT = {
    "basic": """>sp|P12345|PROTEIN1_HUMAN Protein 1 OS=Homo sapiens
MKLLILTCLVAVALARPKHPIKHQGLPQEVLNENLLRFFVAPFPEVFGKEKVNEL
>sp|P67890|PROTEIN2_HUMAN Protein 2 OS=Homo sapiens
MKLLILTCLVAVALARPKHPIKHQGLPQEVLNENLLRFFVAPFPEVFGKEKVNEL
""",
    "swissprot": """>sp|P01308|INS_HUMAN Insulin
SEQUENCE1
>sp|P01315|INSL3_HUMAN Insulin-like 3
SEQUENCE2
""",
    "trembl": """>tr|A0A0A0MRZ7|A0A0A0MRZ7_HUMAN Description
SEQUENCE1
>tr|Q8N2C7|Q8N2C7_HUMAN Description
SEQUENCE2
""",
    "simple": """>P01308 Insulin
SEQUENCE1
>P01315 Insulin-like
SEQUENCE2
""",
    "malformed": """>malformed_header_without_pipes
SEQUENCE1
>another|incomplete
SEQUENCE2
""",
}

# Expected identifiers for different FASTA formats
EXPECTED_IDENTIFIERS = {
    "swissprot": ["P01308", "P01315"],
    "trembl": ["A0A0A0MRZ7", "Q8N2C7"],
    "simple": ["P01308", "P01315"],
    "malformed": ["malformed_header_without_pipes", "incomplete"],
}

# Legacy output data for JSON tests
LEGACY_OUTPUT_DATA = {
    "protein_data": {
        "P12345": {"annotations": {"length": "100"}},
        "P67890": {"annotations": {"length": "150"}},
    },
    "projections": [{"name": "PCA_2", "data": []}],
}
