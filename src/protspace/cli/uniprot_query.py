import argparse
import logging
from pathlib import Path

from protspace.utils import REDUCERS
from protspace.data.uniprot_query_processor import UniProtQueryProcessor


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
        description="Search and process proteins directly from UniProt",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Required arguments
    parser.add_argument(
        "-q",
        "--query",
        type=str,
        required=True,
        help="UniProt search query (e.g., 'human insulin', 'kinase', etc.)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="Path to output directory (when using --non-binary) or Parquet file (default)",
    )

    # Optional arguments
    parser.add_argument(
        "-m",
        "--metadata",
        type=str,
        required=False,
        default=None,
        help="Features to extract (format: feature1,feature2,...)",
    )
    parser.add_argument(
        "--non-binary",
        action="store_true",
        help="Save output in non binary formats (JSON, CSV, etc.)",
    )
    parser.add_argument(
        "--keep-tmp",
        action="store_true",
        help="Keep temporary files (FASTA, complete protein features, and similarity matrix)",
    )
    parser.add_argument(
        "--methods",
        type=str,
        default="pca2,pca3,tsne2,tsne3,umap2,umap3",
        help=f"Reduction methods to use (e.g., {','.join([m + '2,' + m + '3' for m in REDUCERS])}). Format: method_name + dimensions",
    )

    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Increase output verbosity (-v for INFO, -vv for DEBUG)",
    )

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

    # Set up logging
    setup_logging(args.verbose)

    # Validate metadata argument - CSV files are not supported
    if args.metadata:
        if (args.metadata.endswith('.csv') or 
            args.metadata.endswith('.CSV') or 
            Path(args.metadata).exists()):
            raise ValueError(
                "CSV files are not supported when using protspace-query. "
                "Please provide a comma-separated list of feature names instead."
            )

    # Use default empty custom names
    custom_names = {}
    args_dict = vars(args)
    args_dict["custom_names"] = custom_names

    try:
        # Initialize processor
        processor = UniProtQueryProcessor(args_dict)
        
        # Process the query
        metadata, data, headers, saved_files = processor.process_query(
            query=args.query,
            metadata=args.metadata,
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
            processor.save_output(output, args.output)
        
        # Log results
        logger.info(f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods")
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