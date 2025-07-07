import argparse
import warnings
from typing import Optional
from pathlib import Path

from protspace import ProtSpace
from protspace.config import DEFAULT_PORT

warnings.filterwarnings("ignore", category=SyntaxWarning)


def detect_data_type(data_path: str) -> tuple[Optional[str], Optional[str]]:
    """
    Detect if the input is a JSON file or Arrow directory.

    Returns:
        tuple: (json_file_path, arrow_dir_path) - one will be None
    """
    path = Path(data_path)

    if path.is_file() and path.suffix.lower() == ".json":
        return str(path), None
    elif path.is_dir():
        # Check if directory contains parquet files (Arrow format)
        parquet_files = list(path.glob("*.parquet"))
        if parquet_files:
            return None, str(path)
        else:
            raise ValueError(
                f"Directory '{data_path}' does not contain any .parquet files"
            )
    else:
        raise ValueError(
            f"Input '{data_path}' must be either a .json file or a directory containing .parquet files"
        )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ProtSpace")
    parser.add_argument(
        "data",
        help="Path to JSON file or directory containing Arrow/Parquet files",
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
