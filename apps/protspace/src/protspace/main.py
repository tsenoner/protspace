import argparse
import warnings
import tempfile
from typing import Optional
from pathlib import Path

from protspace import ProtSpace
from protspace.config import DEFAULT_PORT

warnings.filterwarnings("ignore", category=SyntaxWarning)


def detect_data_type(data_path: str) -> tuple[Optional[str], Optional[str]]:
    """
    Detect if the input is a JSON file, Arrow directory, or bundled parquet file.

    Returns:
        tuple: (json_file_path, arrow_dir_path) - one will be None
    """
    path = Path(data_path)

    if path.is_file() and path.suffix.lower() == ".json":
        return str(path), None
    elif path.is_file() and path.suffix.lower() == ".parquetbundle":
        # Handle bundled parquet files
        temp_dir = _extract_parquet_bundle(path)
        return None, temp_dir
    elif path.is_dir():
        # Check if directory contains parquet files (Arrow format)
        parquet_files = list(path.glob("*.parquet"))
        if parquet_files:
            return None, str(path)
        
        # Check if directory contains the bundle file
        bundle_file = path / "data.parquetbundle"
        if bundle_file.exists():
            temp_dir = _extract_parquet_bundle(bundle_file)
            return None, temp_dir
        
        raise ValueError(
            f"Directory '{data_path}' does not contain any .parquet files or data.parquetbundle"
        )
    else:
        raise ValueError(
            f"Input '{data_path}' must be either a .json file, a .parquetbundle file, or a directory containing .parquet or .parquetbundle files"
        )

def _extract_parquet_bundle(bundle_path: Path) -> str:
    """
    Extract a bundled parquet file into separate parquet files in a temporary directory.
    
    Args:
        bundle_path: Path to the .parquetbundle file
        
    Returns:
        str: Path to temporary directory containing extracted parquet files
    """
    delimiter = b'---PARQUET_DELIMITER---'
    
    temp_dir = Path(tempfile.mkdtemp(prefix="protspace_bundle_"))
    
    with open(bundle_path, 'rb') as bundle_file:
        content = bundle_file.read()
    
    parts = content.split(delimiter)
    
    expected_files = [
        'selected_features.parquet',
        'projections_metadata.parquet', 
        'projections_data.parquet'
    ]
    
    if len(parts) != len(expected_files):
        raise ValueError(
            f"Expected {len(expected_files)} parquet files in bundle, but found {len(parts)} parts"
        )
    
    for part, filename in zip(parts, expected_files):
        if not part:
            continue
            
        output_path = temp_dir / filename
        with open(output_path, 'wb') as output_file:
            output_file.write(part)
    
    return str(temp_dir)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ProtSpace")
    parser.add_argument(
        "data",
        help="Path to JSON file, .parquetbundle file, or directory containing Arrow/Parquet files",
    )
    parser.add_argument(
        "--pdb_zip",
        required=False,
        help="Path to the ZIP file containing PDB files",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help="Port to run the server on",
    )
    return parser.parse_args()


def main(
    data: str,
    port: int = DEFAULT_PORT,
    pdb_zip: Optional[str] = None,
) -> None:
    json_file, arrow_dir = detect_data_type(data)
    protspace = ProtSpace(
        pdb_zip=pdb_zip, default_json_file=json_file, arrow_dir=arrow_dir
    )
    protspace.run_server(debug=True, port=port)


def run():
    args = parse_arguments()
    main(**vars(args))


if __name__ == "__main__":
    run()
