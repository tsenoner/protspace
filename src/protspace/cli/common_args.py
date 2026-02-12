"""Common argument parsing utilities for ProtSpace CLI tools."""

import argparse
import hashlib
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class CustomHelpFormatter(
    argparse.ArgumentDefaultsHelpFormatter, argparse.RawTextHelpFormatter
):
    """Custom formatter that shows default values and preserves newlines in help text."""

    pass


def parse_custom_names(custom_names_arg: str) -> dict:
    """Parse custom names argument into dictionary.

    Args:
        custom_names_arg: String in format "METHOD1=NAME1,METHOD2=NAME2"

    Returns:
        Dictionary mapping method names to custom display names

    Example:
        >>> parse_custom_names("pca2=PCA_2D,tsne2=t-SNE_2D")
        {'pca2': 'PCA_2D', 'tsne2': 't-SNE_2D'}
    """
    custom_names = {}
    if custom_names_arg:
        custom_names_list = custom_names_arg.split(",")
        for name_spec in custom_names_list:
            try:
                method, name = name_spec.split("=")
                custom_names[method] = name
            except ValueError:
                logger.warning(f"Invalid custom name specification: {name_spec}")
    return custom_names


def setup_logging(verbosity: int):
    """Set up logging based on verbosity level.

    Args:
        verbosity: 0=WARNING, 1=INFO, 2+=DEBUG
    """
    level = [logging.WARNING, logging.INFO, logging.DEBUG][min(verbosity, 2)]

    # Configure root logger
    logging.basicConfig(
        level=level,
        format="%(levelname)s: %(message)s",
        force=True,  # Override any existing configuration
    )


def compute_cache_hash(identifiers: list[str]) -> str:
    """Compute MD5 hash of sorted identifiers for cache naming.

    Args:
        identifiers: List of protein identifiers

    Returns:
        MD5 hash string (first 16 characters)
    """
    sorted_ids = sorted(identifiers)
    hash_input = "".join(sorted_ids).encode("utf-8")
    return hashlib.md5(hash_input).hexdigest()[:16]


def determine_output_paths(
    output_arg: Path | None,
    input_path: Path | None,
    non_binary: bool,
    bundled: bool,
    keep_tmp: bool,
    identifiers: list[str] | None = None,
) -> tuple[Path, Path | None]:
    """Determine output file path and intermediate directory.

    Args:
        output_arg: User-provided output argument (or None)
        input_path: Input file path (None for query mode)
        non_binary: Whether using JSON output
        bundled: Whether to bundle parquet files
        keep_tmp: Whether to keep temporary files
        identifiers: List of protein IDs (for hash computation, needed if keep_tmp=True)

    Returns:
        Tuple of (output_path, intermediate_dir)
        - output_path: Where to save the final output file
        - intermediate_dir: Where to save cached files (None if keep_tmp=False)
    """
    # Determine base directory (parent of input file, or current dir for query mode)
    if input_path:
        base_dir = input_path.parent
        input_stem = input_path.stem
    else:
        base_dir = Path(".")
        input_stem = "protspace"

    # Determine file extension based on mode
    if non_binary:
        ext = ".json"
    else:
        ext = ".parquetbundle" if bundled else ""

    # Determine output path
    if output_arg is None:
        # No output specified - use defaults
        if bundled or non_binary:
            # Single file output
            output_path = base_dir / f"{input_stem}{ext}"
        else:
            # Directory output (bundled=false)
            output_path = base_dir / "protspace"
    else:
        # Output specified by user
        if output_arg.suffix:
            # User provided a file path - force correct extension
            if non_binary:
                output_path = output_arg.with_suffix(".json")
            elif bundled:
                output_path = output_arg.with_suffix(".parquetbundle")
            else:
                # bundled=false, but user gave file path - treat as directory name
                output_path = output_arg.with_suffix("")
        else:
            # User provided directory/stem without extension
            if bundled or non_binary:
                output_path = output_arg.with_suffix(ext)
            else:
                # bundled=false - it's a directory
                output_path = output_arg

    # Determine intermediate directory for cached files
    if keep_tmp and identifiers:
        cache_hash = compute_cache_hash(identifiers)
        intermediate_dir = base_dir / "tmp" / cache_hash
    else:
        intermediate_dir = None

    return output_path, intermediate_dir


def add_annotations_argument(parser: argparse.ArgumentParser, allow_csv: bool = True):
    """Add the --annotations argument with improved help text.

    Args:
        parser: ArgumentParser instance to add the argument to
        allow_csv: Whether to allow CSV file paths (True for local_data, False for uniprot_query)
    """
    csv_note = (
        " or path to metadata CSV file (first column = protein identifiers)"
        if allow_csv
        else ""
    )
    csv_example = "\n  --annotations /path/to/metadata.csv" if allow_csv else ""

    parser.add_argument(
        "-a",
        "--annotations",
        type=str,
        required=False,
        default=None,
        help=(
            f"Protein annotations to extract as comma-separated values{csv_note}.\n"
            "If not specified, all available annotations are retrieved.\n"
            "\n"
            "Available annotations:\n"
            "  UniProt:    annotation_score, cc_subcellular_location, fragment,\n"
            "              gene_name, length_fixed, length_quantile,\n"
            "              protein_existence, protein_families, reviewed, xref_pdb\n"
            "  InterPro:   cath, cdd, panther, pfam, prints,\n"
            "              prosite, signal_peptide, smart, superfamily\n"
            "  Taxonomy:   root, domain, kingdom, phylum, class, order, family, genus, species\n"
            "\n"
            "Examples:\n"
            f"  --annotations reviewed,length_quantile,kingdom{csv_example}\n"
            f"  --annotations pfam,cath,cc_subcellular_location"
        ),
    )


def add_output_argument(
    parser: argparse.ArgumentParser, required: bool = False, default_name: str = None
):
    """Add the --output argument.

    Args:
        parser: ArgumentParser instance to add the argument to
        required: Whether the output argument is required
        default_name: Default output name if not provided (None means derive from input)
    """
    help_text = (
        "Path to output file or directory.\n"
        "\n"
        "Behavior:\n"
        "  - With --bundled true (default): Accepts file or directory path.\n"
        "    If directory, creates protspace_<name>.parquetbundle inside.\n"
        "    If file, uses that exact path.\n"
        "  - With --bundled false: Must be a directory path.\n"
        "  - With --non-binary: Creates directory with JSON and CSV files."
    )

    if default_name:
        help_text += f"\n\nDefault: {default_name}"

    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=required,
        default=None,
        help=help_text,
    )


def add_output_format_arguments(parser: argparse.ArgumentParser):
    """Add output format-related arguments.

    Args:
        parser: ArgumentParser instance to add the arguments to
    """
    parser.add_argument(
        "--non-binary",
        action="store_true",
        help=(
            "Save output in non-binary formats (JSON + CSV) instead of Parquet.\n"
            "Use this for human-readable output."
        ),
    )
    parser.add_argument(
        "--bundled",
        type=str,
        default="true",
        choices=["true", "false"],
        help=(
            "Bundle multiple Parquet files into a single .parquetbundle file.\n"
            "Recommended for easier file management and distribution.\n"
            "Note: Ignored when --non-binary is set (warning will be shown)."
        ),
    )
    parser.add_argument(
        "--keep-tmp",
        action="store_true",
        help=(
            "Cache intermediate files for reuse in subsequent runs.\n"
            "When enabled, downloaded annotations are saved and reused\n"
            "if you run the command again with different reduction methods or parameters.\n"
            "This avoids re-downloading data from UniProt, InterPro, and taxonomy databases."
        ),
    )


def add_methods_argument(parser: argparse.ArgumentParser, default: str = "pca2"):
    """Add the --methods argument.

    Args:
        parser: ArgumentParser instance to add the argument to
        default: Default methods string (differs between CLI tools)
    """
    parser.add_argument(
        "-m",
        "--methods",
        type=str,
        default=default,
        help=(
            "Dimensionality reduction methods to apply (comma-separated).\n"
            "Format: method_name + number_of_dimensions\n"
            "\n"
            "Available methods:\n"
            "  pca      - Principal Component Analysis (fast, linear)\n"
            "  tsne     - t-SNE (captures local structure, slower)\n"
            "  umap     - UMAP (balances local/global structure)\n"
            "  pacmap   - PaCMAP (preserves local and global structure)\n"
            "  mds      - Multidimensional Scaling (preserves distances)\n"
            "  localmap - LocalMAP (locally-aware manifold projection)\n"
            "\n"
            "Examples:\n"
            "  --methods pca2,pca3              (2D and 3D PCA)\n"
            "  --methods umap2,tsne2            (2D UMAP and t-SNE)\n"
            "  --methods pca2,umap2,umap3       (2D PCA, 2D and 3D UMAP)"
        ),
    )


def add_verbosity_argument(parser: argparse.ArgumentParser):
    """Add the --verbose argument.

    Args:
        parser: ArgumentParser instance to add the argument to
    """
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help=(
            "Increase output verbosity level.\n"
            "  (none) - Show warnings and errors only\n"
            "  -v     - Show INFO messages (recommended for tracking progress)\n"
            "  -vv    - Show DEBUG messages (detailed diagnostic information)"
        ),
    )


def add_general_parameters(parser: argparse.ArgumentParser):
    """Add general parameters argument group.

    Args:
        parser: ArgumentParser instance to add the group to
    """
    general_group = parser.add_argument_group(
        "General Parameters", "Parameters that apply across multiple reduction methods"
    )
    general_group.add_argument(
        "--metric",
        default="euclidean",
        help=(
            "Distance metric for computing pairwise distances.\n"
            "Applies to: UMAP, t-SNE, MDS\n"
            "Common options: euclidean, cosine, manhattan, correlation"
        ),
    )
    general_group.add_argument(
        "--random_state",
        type=int,
        default=42,
        help=(
            "Random seed for reproducibility.\n"
            "Set this to get consistent results across runs."
        ),
    )


def add_umap_parameters(parser: argparse.ArgumentParser):
    """Add UMAP-specific parameters argument group.

    Args:
        parser: ArgumentParser instance to add the group to
    """
    umap_group = parser.add_argument_group(
        "UMAP Parameters", "Parameters specific to UMAP, PaCMAP, and LocalMAP methods"
    )
    umap_group.add_argument(
        "--n_neighbors",
        type=int,
        default=15,
        help=(
            "Number of neighboring points used in manifold approximation.\n"
            "Larger values: more global structure, smoother manifolds\n"
            "Smaller values: more local structure, finer details\n"
            "Typical range: 5-50"
        ),
    )
    umap_group.add_argument(
        "--min_dist",
        type=float,
        default=0.1,
        help=(
            "Minimum distance between points in the low-dimensional representation.\n"
            "Larger values: points spread more evenly\n"
            "Smaller values: more tightly packed clusters\n"
            "Typical range: 0.0-0.99"
        ),
    )


def add_tsne_parameters(parser: argparse.ArgumentParser):
    """Add t-SNE-specific parameters argument group.

    Args:
        parser: ArgumentParser instance to add the group to
    """
    tsne_group = parser.add_argument_group(
        "t-SNE Parameters",
        "Parameters specific to t-SNE (t-distributed Stochastic Neighbor Embedding)",
    )
    tsne_group.add_argument(
        "--perplexity",
        type=int,
        default=30,
        help=(
            "Balance between local and global structure preservation.\n"
            "Roughly corresponds to the number of nearest neighbors.\n"
            "Larger datasets can use higher values.\n"
            "Typical range: 5-50"
        ),
    )
    tsne_group.add_argument(
        "--learning_rate",
        type=int,
        default=200,
        help=(
            "Step size for gradient descent optimization.\n"
            "Too high: unstable optimization\n"
            "Too low: slow convergence, poor local minima\n"
            "Typical range: 10-1000"
        ),
    )


def add_pacmap_parameters(parser: argparse.ArgumentParser):
    """Add PaCMAP-specific parameters argument group.

    Args:
        parser: ArgumentParser instance to add the group to
    """
    pacmap_group = parser.add_argument_group(
        "PaCMAP Parameters", "Parameters specific to PaCMAP and LocalMAP methods"
    )
    pacmap_group.add_argument(
        "--mn_ratio",
        type=float,
        default=0.5,
        help=(
            "Mid-near pairs ratio - controls mid-range structure preservation.\n"
            "Higher values: emphasize mid-range distances\n"
            "Typical range: 0.1-1.0"
        ),
    )
    pacmap_group.add_argument(
        "--fp_ratio",
        type=float,
        default=2.0,
        help=(
            "Further pairs ratio - controls separation of distant points.\n"
            "Higher values: better global structure, more spread\n"
            "Typical range: 1.0-3.0"
        ),
    )


def add_mds_parameters(parser: argparse.ArgumentParser):
    """Add MDS-specific parameters argument group.

    Args:
        parser: ArgumentParser instance to add the group to
    """
    mds_group = parser.add_argument_group(
        "MDS Parameters", "Parameters specific to MDS (Multidimensional Scaling)"
    )
    mds_group.add_argument(
        "--n_init",
        type=int,
        default=4,
        help=(
            "Number of times the algorithm is run with different initializations.\n"
            "Best result is kept. Higher values: more robust but slower.\n"
            "Typical range: 1-10"
        ),
    )
    mds_group.add_argument(
        "--max_iter",
        type=int,
        default=300,
        help=(
            "Maximum number of optimization iterations per run.\n"
            "Increase if convergence warnings appear.\n"
            "Typical range: 100-1000"
        ),
    )
    mds_group.add_argument(
        "--eps",
        type=float,
        default=1e-3,
        help=(
            "Relative tolerance for convergence.\n"
            "Smaller values: more precise but slower convergence\n"
            "Typical range: 1e-6 to 1e-2"
        ),
    )


def add_all_reducer_parameters(parser: argparse.ArgumentParser):
    """Add all reducer-specific parameter groups.

    Args:
        parser: ArgumentParser instance to add the groups to
    """
    add_general_parameters(parser)
    add_umap_parameters(parser)
    add_tsne_parameters(parser)
    add_pacmap_parameters(parser)
    add_mds_parameters(parser)
