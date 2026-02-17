import argparse
import logging
import shutil
import sys
from pathlib import Path

import pandas as pd

from protspace.cli.common_args import (
    CustomHelpFormatter,
    add_all_reducer_parameters,
    add_annotations_argument,
    add_methods_argument,
    add_output_argument,
    add_output_format_arguments,
    add_verbosity_argument,
    determine_output_paths,
    setup_logging,
)
from protspace.data.annotations.scores import strip_scores_from_df
from protspace.data.processors.uniprot_query_processor import UniProtQueryProcessor

logger = logging.getLogger(__name__)


def create_argument_parser() -> argparse.ArgumentParser:
    """Create and configure the argument parser for UniProt queries."""
    parser = argparse.ArgumentParser(
        description=(
            "Query and process proteins directly from UniProt.\n"
            "\n"
            "This tool searches UniProt, downloads protein sequences, computes embeddings\n"
            "using ESM2, performs dimensionality reduction, and optionally extracts\n"
            "protein annotations from UniProt, InterPro, and taxonomy databases."
        ),
        formatter_class=CustomHelpFormatter,
    )

    # Required arguments
    parser.add_argument(
        "-q",
        "--query",
        type=str,
        required=True,
        help=(
            "UniProt search query string.\n"
            "\n"
            "Examples:\n"
            "  --query 'organism_name:\"Homo sapiens\" AND reviewed:true'\n"
            "  --query 'protein_name:kinase AND length:[100 TO 500]'\n"
            "  --query 'gene:BRCA1'\n"
            "  --query 'ec:3.4.21.*'\n"
            "\n"
            "For query syntax, see: https://www.uniprot.org/help/query-fields"
        ),
    )

    # Add shared output argument (optional, defaults to protspace.parquetbundle)
    add_output_argument(parser, required=False, default_name="protspace.parquetbundle")

    # Add shared annotations argument (does NOT allow CSV files for query mode)
    add_annotations_argument(parser, allow_csv=False)

    # Add shared output format arguments
    add_output_format_arguments(parser)

    # Add shared methods argument with uniprot_query defaults
    add_methods_argument(parser, default="pca2")

    # Add shared verbosity argument
    add_verbosity_argument(parser)

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

    # Validate metadata argument - CSV files are not supported
    if args.annotations:
        for ann in args.annotations:
            if ann.strip().lower().endswith(".csv") or Path(ann.strip()).exists():
                raise ValueError(
                    "CSV files are not supported when using protspace-query. "
                    "Please provide annotation names instead, e.g. -a pfam,kingdom"
                )

    # Warn if both --non-binary and --bundled false are used together
    if args.non_binary and args.bundled == "false":
        logger.warning(
            "The --bundled false flag only applies to binary (parquet) output. "
            "Since --non-binary is set, --bundled will be ignored and output will be saved as JSON."
        )

    # Custom names not supported in query mode
    args_dict = vars(args)
    args_dict["custom_names"] = {}

    # Initialize variables for cleanup
    intermediate_dir = None

    try:
        # Initialize processor
        processor = UniProtQueryProcessor(args_dict)

        # Download FASTA first to get headers
        logger.info(f"Processing UniProt query: '{args.query}'")
        headers, fasta_path = processor._search_and_download_fasta(
            query=args.query,
            save_to=None,  # Temporary file for now
        )
        if not headers:
            raise ValueError(f"No sequences found for query: '{args.query}'")

        # Now determine output paths with headers for hash computation
        output_path, intermediate_dir = determine_output_paths(
            output_arg=args.output,
            input_path=None,  # No input file for query mode
            non_binary=args.non_binary,
            bundled=args.bundled == "true",
            keep_tmp=args.keep_tmp,
            identifiers=headers if args.keep_tmp else None,
        )

        logger.info(f"Output will be saved to: {output_path}")
        if intermediate_dir:
            logger.info(f"Intermediate files will be saved to: {intermediate_dir}")

        # Handle --dump-cache: print cached data and exit
        if args.dump_cache:
            if not intermediate_dir:
                logger.error("No cache directory. Run with --keep-tmp first.")
                sys.exit(1)
            cache_path = intermediate_dir / "all_annotations.parquet"
            if cache_path.exists():
                df = pd.read_parquet(cache_path)
                print(df.to_csv(index=False))
            else:
                logger.error(
                    f"No cache found at {cache_path}. Run with --keep-tmp first."
                )
            return

        # Process the query with the determined paths
        # Join list back to comma-separated string for uniprot_query_processor
        annotations_str = ",".join(args.annotations) if args.annotations else None
        metadata, data, headers, saved_files = processor.process_query(
            query=args.query,
            annotations=annotations_str,
            delimiter=",",
            output_path=output_path,
            intermediate_dir=intermediate_dir,
            keep_tmp=args.keep_tmp,
            non_binary=args.non_binary,
            fasta_path=fasta_path,  # Pass the already downloaded FASTA
            headers=headers,  # Pass the already extracted headers
        )

        # Apply score stripping at presentation layer
        if args.no_scores:
            metadata = strip_scores_from_df(metadata)

        # Process reduction methods
        methods_list = args.methods.split(",")
        reductions = []

        for method_spec in methods_list:
            method = "".join(filter(str.isalpha, method_spec))
            dims = int("".join(filter(str.isdigit, method_spec)))

            if method not in processor.reducers:
                logger.warning(
                    f"Unknown reduction method specified: {method}. Skipping."
                )
                continue

            logger.info(f"Applying {method.upper()}{dims} reduction")
            reductions.append(processor.process_reduction(data, method, dims))

        # Create and save output (bundled is ignored when non_binary is set)
        if args.non_binary:
            output = processor.create_output_legacy(metadata, reductions, headers)
            processor.save_output_legacy(output, output_path)
        else:
            output = processor.create_output(metadata, reductions, headers)
            processor.save_output(output, output_path, bundled=args.bundled == "true")

        # Log results
        logger.info(
            f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods"
        )
        logger.info(f"Output saved to: {output_path}")

        if saved_files:
            logger.info("Additional files saved:")
            for file_type, file_path in saved_files.items():
                logger.info(f"  {file_type.upper()}: {file_path}")

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
