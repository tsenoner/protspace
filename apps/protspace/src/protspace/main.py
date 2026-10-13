import argparse
import warnings
from pathlib import Path

from protspace.app import ProtSpace

DEFAULT_PORT = 8050

warnings.filterwarnings("ignore", category=SyntaxWarning)


def detect_data_type(data_path: str) -> str:
    """Resolve *data_path* to something ``ArrowReader`` reads.

    Accepts a ``.parquetbundle`` file or a directory containing ``.parquet``
    files (or a ``data.parquetbundle``).

    Returns:
        Path to the bundle file or the Parquet directory.
    """
    path = Path(data_path)

    if path.is_file() and path.suffix.lower() == ".parquetbundle":
        return str(path)
    elif path.is_dir():
        parquet_files = list(path.glob("*.parquet"))
        if parquet_files:
            return str(path)

        bundle_file = path / "data.parquetbundle"
        if bundle_file.exists():
            return str(bundle_file)

        raise ValueError(
            f"Directory '{data_path}' does not contain .parquet files or data.parquetbundle"
        )
    else:
        raise ValueError(
            f"Input '{data_path}' must be a .parquetbundle file or a directory containing .parquet files"
        )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ProtSpace")
    parser.add_argument(
        "data",
        help="Path to .parquetbundle file or directory containing Parquet files",
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
    pdb_zip: str | None = None,
) -> None:
    arrow_dir = detect_data_type(data)
    protspace = ProtSpace(pdb_zip=pdb_zip, arrow_dir=arrow_dir)
    protspace.run_server(debug=True, port=port)


def run():
    args = parse_arguments()
    main(**vars(args))


if __name__ == "__main__":
    run()
