import argparse
import logging
from pathlib import Path

from protspace.utils import REDUCERS
from protspace.data.local_data_processor import LocalDataProcessor


logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_custom_names(custom_names_arg: str) -> dict:
    """Parse custom names argument into dictionary."""
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
    """Set up logging based on verbosity level."""
    logger.setLevel(
        [logging.WARNING, logging.INFO, logging.DEBUG][min(verbosity, 2)]
    )


def create_argument_parser() -> argparse.ArgumentParser:
    """Create and configure the argument parser."""
    parser = argparse.ArgumentParser(
        description="Dimensionality reduction for protein embeddings or similarity matrices",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Required arguments
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        required=True,
        help="Path to input data: HDF file (.hdf, .hdf5, .h5) for embeddings or CSV file for similarity matrix",
    )
    parser.add_argument(
        "-m",
        "--metadata",
        type=str,
        required=False,
        default=None,
        help="Path to CSV file containing metadata and features (first column must be named 'identifier' and match IDs in HDF5/similarity matrix). If want to generate CSV from UniProt features, use the following format: feature1,feature2,...",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="Path to output directory.",
    )
    # Specify delimiter argument with comma as default
    parser.add_argument(
        "--delimiter",
        type=str,
        default=",",
        help="Specify delimiter for metadata file (default: comma)",
    )
    parser.add_argument(
        "--non-binary",
        action="store_true",
        help="Save output in non binary formats (JSON, CSV, etc.)",
    )

    parser.add_argument(
        "--keep-tmp",
        action="store_true",
        help="Keep temporary files (All protein features)",
    )

    # Reduction methods
    parser.add_argument(
        "--methods",
        type=str,
        default="pca2",
        help=f"Reduction methods to use (e.g., {','.join([m + '2' for m in REDUCERS])}). Format: method_name + dimensions",
    )

    # Custom names
    parser.add_argument(
        "--custom_names",
        type=str,
        metavar="METHOD1=NAME1,METHOD2=NAME2",
        help="Custom names for projections in format METHOD=NAME separated by commas without spaces (e.g., pca2=PCA_2D,tsne2=t-SNE_2D)",
    )

    # Verbosity control
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Increase output verbosity (-v for INFO, -vv for DEBUG)",
    )

    # General parameters
    general_group = parser.add_argument_group("General Parameters")
    general_group.add_argument(
        "--metric",
        default="euclidean",
        help="Distance metric to use (applies to UMAP, t-SNE, MDS)",
    )

    # UMAP parameters
    umap_group = parser.add_argument_group("UMAP Parameters")
    umap_group.add_argument(
        "--n_neighbors",
        type=int,
        default=15,
        help="Number of neighbors to consider (UMAP, PaCMAP, LocalMAP)",
    )
    umap_group.add_argument(
        "--min_dist",
        type=float,
        default=0.1,
        help="Minimum distance between points in UMAP",
    )

    # t-SNE parameters
    tsne_group = parser.add_argument_group("t-SNE Parameters")
    tsne_group.add_argument(
        "--perplexity",
        type=int,
        default=30,
        help="Perplexity parameter for t-SNE",
    )
    tsne_group.add_argument(
        "--learning_rate", type=int, default=200, help="Learning rate for t-SNE"
    )

    # PaCMAP parameters
    pacmap_group = parser.add_argument_group("PaCMAP Parameters")
    pacmap_group.add_argument(
        "--mn_ratio",
        type=float,
        default=0.5,
        help="MN ratio (Mid-near pairs ratio) for PaCMAP and LocalMAP",
    )
    pacmap_group.add_argument(
        "--fp_ratio",
        type=float,
        default=2.0,
        help="FP ratio (Further pairs ratio) for PaCMAP and LocalMAP",
    )

    # MDS parameters
    mds_group = parser.add_argument_group("MDS Parameters")
    mds_group.add_argument(
        "--n_init",
        type=int,
        default=4,
        help="Number of initialization runs for MDS",
    )
    mds_group.add_argument(
        "--max_iter",
        type=int,
        default=300,
        help="Maximum number of iterations for MDS",
    )
    mds_group.add_argument(
        "--eps",
        type=float,
        default=1e-3,
        help="Relative tolerance for MDS convergence",
    )

    return parser


def main():
    """Main CLI function."""
    parser = create_argument_parser()
    args = parser.parse_args()

    custom_names = parse_custom_names(args.custom_names)

    args_dict = vars(args)
    args_dict["custom_names"] = custom_names

    setup_logging(args.verbose)

    try:
        processor = LocalDataProcessor(args_dict)
        metadata, data, headers = processor.load_data(
            input_path=args.input,
            metadata=args.metadata,
            output_path=args.output,
            delimiter=args.delimiter,
            non_binary=args.non_binary,
            keep_tmp=args.keep_tmp,
        )

        methods_list = args.methods.split(",")
        reductions = []
        for method_spec in methods_list:
            method = "".join(filter(str.isalpha, method_spec))
            dims = int("".join(filter(str.isdigit, method_spec)))

            if method not in processor.reducers:
                logger.warning(
                    f"Unknown reduction method specified: {method}. Skipping."
                )
                continue  # Use logger.warning and continue instead of raising ValueError
                # raise ValueError(f"Unknown reduction method: {method}") # Kept for reference

            logger.info(f"Applying {method.upper()}{dims} reduction")
            reductions.append(processor.process_reduction(data, method, dims))

        # Create and save output
        if args.non_binary:
            output = processor.create_output_legacy(metadata, reductions, headers)
            processor.save_output_legacy(output, args.output)
        else:
            output = processor.create_output(metadata, reductions, headers)
            processor.save_output(output, args.output)
        logger.info(
            f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods"
        )

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise


if __name__ == "__main__":
    main()
