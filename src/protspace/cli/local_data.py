import argparse
import logging
import shutil
from pathlib import Path

import pandas as pd

from protspace.cli.common_args import (
    CustomHelpFormatter,
    add_all_reducer_parameters,
    add_features_argument,
    add_methods_argument,
    add_output_argument,
    add_output_format_arguments,
    add_verbosity_argument,
    determine_output_paths,
    parse_custom_names,
    setup_logging,
)
from protspace.data.processors.local_processor import LocalProcessor

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

    # Add shared output argument (optional, derives from input filename)
    add_output_argument(
        parser, required=False, default_name="protspace_<input_filename>.parquetbundle"
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

    # Add force-refetch flag
    parser.add_argument(
        "--force-refetch",
        action="store_true",
        help=(
            "Force re-fetching all features even if cached data exists.\n"
            "Use this when you want to update features with fresh data from APIs."
        ),
    )

    # Add all shared reducer parameter groups
    add_all_reducer_parameters(parser)

    return parser


def main():
    """Main CLI function."""
    parser = create_argument_parser()
    args = parser.parse_args()

    # Set up logging first
    setup_logging(args.verbose)

    # Validate bundled flag with output
    if args.bundled == "false" and not args.non_binary:
        if args.output and args.output.suffix:
            raise ValueError(
                "When --bundled is set to false, --output must be a directory path, not a file path. "
                f"Remove the extension from '{args.output}' or use --bundled true."
            )

    # Warn if both --non-binary and --bundled false are used together
    if args.non_binary and args.bundled == "false":
        logger.warning(
            "The --bundled false flag only applies to binary (parquet) output. "
            "Since --non-binary is set, --bundled will be ignored and output will be saved as JSON."
        )

    custom_names = parse_custom_names(args.custom_names)
    args_dict = vars(args)
    args_dict["custom_names"] = custom_names

    # Initialize variables for cleanup
    intermediate_dir = None

    try:
        processor = LocalProcessor(args_dict)

        # Load input file first to get headers (needed for path computation)
        data, headers = processor.load_input_file(args.input)

        # Determine output paths with headers for hash computation
        output_path, intermediate_dir = determine_output_paths(
            output_arg=args.output,
            input_path=args.input,
            non_binary=args.non_binary,
            bundled=args.bundled == "true",
            keep_tmp=args.keep_tmp,
            identifiers=headers if args.keep_tmp else None,
        )

        logger.info(f"Output will be saved to: {output_path}")
        if intermediate_dir:
            logger.info(f"Intermediate files will be saved to: {intermediate_dir}")

        # Load/generate metadata
        metadata = processor.load_or_generate_metadata(
            headers=headers,
            features=args.features,
            intermediate_dir=intermediate_dir,
            delimiter=args.delimiter,
            non_binary=args.non_binary,
            keep_tmp=args.keep_tmp,
            force_refetch=args.force_refetch,
        )

        # Create full metadata
        full_metadata = pd.DataFrame({"identifier": headers})
        if len(metadata.columns) > 1:
            metadata = metadata.astype(str)
            # Use first column as identifier regardless of its name
            id_col = metadata.columns[0]
            if id_col != "identifier":
                metadata = metadata.rename(columns={id_col: "identifier"})
            full_metadata = full_metadata.merge(
                metadata.drop_duplicates("identifier"),
                on="identifier",
                how="left",
            )

        metadata = full_metadata

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

        # Create and save output (bundled is ignored when non_binary is set)
        if args.non_binary:
            output = processor.create_output_legacy(metadata, reductions, headers)
            processor.save_output_legacy(output, output_path)
        else:
            output = processor.create_output(metadata, reductions, headers)
            processor.save_output(output, output_path, bundled=args.bundled == "true")

        logger.info(
            f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods"
        )
        logger.info(f"Output saved to: {output_path}")

        # Clean up temporary directory if --keep-tmp is not active
        if not args.keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
            logger.info(f"Cleaned up temporary directory: {intermediate_dir}")

    except Exception as e:
        # Clean up temporary directory if --keep-tmp is not active (even on error)
        if not args.keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
            logger.info(f"Cleaned up temporary directory: {intermediate_dir}")
        logger.error(f"Error: {str(e)}")
        raise


if __name__ == "__main__":
    main()
