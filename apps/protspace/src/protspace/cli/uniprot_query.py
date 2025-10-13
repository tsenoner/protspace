import argparse
import logging
from pathlib import Path

from protspace.data.uniprot_query_processor import UniProtQueryProcessor
from protspace.cli.common_args import (
    CustomHelpFormatter,
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
    """Create and configure the argument parser for UniProt queries."""
    parser = argparse.ArgumentParser(
        description=(
            "Query and process proteins directly from UniProt.\n"
            "\n"
            "This tool searches UniProt, downloads protein sequences, computes embeddings\n"
            "using ESM2, performs dimensionality reduction, and optionally extracts\n"
            "protein features from UniProt, InterPro, and taxonomy databases."
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

    # Add shared features argument (does NOT allow CSV files for query mode)
    add_features_argument(parser, allow_csv=False)

    # Add shared output format arguments
    add_output_format_arguments(parser)

    # Add shared methods argument with uniprot_query defaults
    add_methods_argument(parser, default="pca2,pca3,tsne2,tsne3,umap2,umap3")

    # Add shared verbosity argument
    add_verbosity_argument(parser)

    # Add all shared reducer parameter groups
    add_all_reducer_parameters(parser)

    return parser


def main():
    """Main CLI function."""
    parser = create_argument_parser()
    args = parser.parse_args()

    # Set up logging
    setup_logging(args.verbose)

    # Validate metadata argument - CSV files are not supported
    if args.features:
        if (
            args.features.endswith(".csv")
            or args.features.endswith(".CSV")
            or Path(args.features).exists()
        ):
            raise ValueError(
                "CSV files are not supported when using protspace-query. "
                "Please provide a comma-separated list of feature names instead."
            )

    # Custom names not supported in query mode
    args_dict = vars(args)
    args_dict["custom_names"] = {}

    try:
        # Initialize processor
        processor = UniProtQueryProcessor(args_dict)

        # Process the query
        metadata, data, headers, saved_files = processor.process_query(
            query=args.query,
            features=args.features,
            delimiter=",",
            output_path=args.output,
            keep_tmp=args.keep_tmp,
            non_binary=args.non_binary,
        )

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

        # Create and save output
        if args.non_binary:
            output = processor.create_output_legacy(metadata, reductions, headers)
            processor.save_output_legacy(output, args.output)
        else:
            output = processor.create_output(metadata, reductions, headers)
            processor.save_output(output, args.output, bundled=args.bundled == "true")

        # Log results
        logger.info(
            f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods"
        )
        logger.info(f"Results saved to: {args.output}")

        if saved_files:
            logger.info("Additional files saved:")
            for file_type, file_path in saved_files.items():
                logger.info(f"  {file_type.upper()}: {file_path}")

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise


if __name__ == "__main__":
    main()
