import argparse
import logging
from pathlib import Path

from protspace.data.local_data_processor import LocalDataProcessor
from protspace.cli.common_args import (
    CustomHelpFormatter,
    parse_custom_names,
    setup_logging,
    add_features_argument,
    add_output_format_arguments,
    add_methods_argument,
    add_verbosity_argument,
    add_all_reducer_parameters,
)


logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def create_argument_parser() -> argparse.ArgumentParser:
    """Create and configure the argument parser for local data processing."""
    parser = argparse.ArgumentParser(
        description=(
            "Process local protein data with dimensionality reduction.\n"
            "\n"
            "This tool performs dimensionality reduction on protein embeddings or\n"
            "similarity matrices, and optionally extracts protein features from\n"
            "UniProt, InterPro, and taxonomy databases."
        ),
        formatter_class=CustomHelpFormatter,
    )

    # Required arguments
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        required=True,
        help=(
            "Path to input data file.\n"
            "Supported formats:\n"
            "  - HDF5 files (.h5, .hdf5, .hdf) containing protein embeddings\n"
            "  - CSV files containing precomputed similarity matrices\n"
            "\n"
            "The file must contain protein IDs (e.g., UniProt accessions)."
        ),
    )

    # Add shared features argument (allows CSV metadata files)
    add_features_argument(parser, allow_csv=True)

    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help=(
            "Path to output directory where results will be saved.\n"
            "Directory will be created if it doesn't exist."
        ),
    )

    parser.add_argument(
        "--delimiter",
        type=str,
        default=",",
        help=(
            "Delimiter for parsing metadata CSV files.\n"
            "Common options: ',' (comma), '\\t' (tab), ';' (semicolon)"
        ),
    )

    # Add shared output format arguments
    add_output_format_arguments(parser)

    # Add shared methods argument with local_data default
    add_methods_argument(parser, default="pca2")

    # Custom names for projections
    parser.add_argument(
        "--custom_names",
        type=str,
        metavar="METHOD1=NAME1,METHOD2=NAME2",
        help=(
            "Custom display names for reduction projections.\n"
            "Format: METHOD=NAME pairs separated by commas (no spaces)\n"
            "\n"
            "Example:\n"
            "  --custom_names pca2=PCA_2D,tsne2=t-SNE_2D,umap3=UMAP_3D"
        ),
    )

    # Add shared verbosity argument
    add_verbosity_argument(parser)

    # Add all shared reducer parameter groups
    add_all_reducer_parameters(parser)

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
            features=args.features,
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
            processor.save_output(output, args.output, bundled=args.bundled == "true")
        logger.info(
            f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods"
        )

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise


if __name__ == "__main__":
    main()
