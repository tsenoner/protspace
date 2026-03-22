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
    parse_custom_names,
    setup_logging,
)
from protspace.data.annotations.scores import strip_scores_from_df
from protspace.data.processors.local_processor import LocalProcessor

logger = logging.getLogger(__name__)


def create_argument_parser() -> argparse.ArgumentParser:
    """Create and configure the argument parser for local data processing."""
    parser = argparse.ArgumentParser(
        description=(
            "Process local protein data with dimensionality reduction.\n"
            "\n"
            "This tool performs dimensionality reduction on protein embeddings or\n"
            "similarity matrices, and optionally extracts protein annotations from\n"
            "UniProt, InterPro, and taxonomy databases."
        ),
        formatter_class=CustomHelpFormatter,
    )

    # Required arguments
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        nargs="+",
        required=True,
        help=(
            "Path(s) to input data file(s) or directory.\n"
            "Supported formats:\n"
            "  - FASTA file (.fasta, .fa, .faa) — embeddings generated via Biocentral\n"
            "  - Single HDF5 file (.h5, .hdf5, .hdf) containing protein embeddings\n"
            "  - Multiple HDF5 files (automatically merged)\n"
            "  - Directory containing multiple HDF5 files (automatically merged)\n"
            "  - CSV file containing precomputed similarity matrix\n"
            "\n"
            "Examples:\n"
            "  --input sequences.fasta --embedder esm2_8m\n"
            "  --input data/embeddings.h5\n"
            "  --input data/batch1.h5 data/batch2.h5 data/batch3.h5\n"
            "  --input data/embs/\n"
            "\n"
            "When multiple files or a directory are provided, all .h5 files will be\n"
            "loaded and merged. Duplicate protein IDs will be handled (first occurrence kept).\n"
            "\n"
            "Files must contain protein IDs (e.g., UniProt accessions)."
        ),
    )

    # Add shared annotations argument (allows CSV metadata files)
    add_annotations_argument(parser, allow_csv=True)

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
            "Force re-fetching all annotations even if cached data exists.\n"
            "Use this when you want to update annotations with fresh data from APIs."
        ),
    )

    # Add all shared reducer parameter groups
    add_all_reducer_parameters(parser)

    # Biocentral Embedding arguments
    emb_group = parser.add_argument_group("Biocentral Embedding")
    shortcuts = ", ".join(
        f"{k}" for k in [
            "prot_t5", "prost_t5", "esm2_8m", "esm2_650m",
            "esm2_3b", "one_hot", "blosum62",
        ]
    )
    emb_group.add_argument(
        "--embedder",
        type=str,
        default=None,
        help=(
            f"Embedder model name or shortcut (default: prot_t5 for FASTA input).\n"
            f"Shortcuts: {shortcuts}"
        ),
    )
    emb_group.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Sequences per API call (default: 1000)",
    )
    emb_group.add_argument(
        "--half-precision",
        action="store_true",
        help="Request float16 embeddings from server",
    )
    emb_group.add_argument(
        "--embedding-cache",
        type=Path,
        default=None,
        help="Override HDF5 cache path for embeddings",
    )
    emb_group.add_argument(
        "--probe",
        action="store_true",
        help="Submit 2 sequences, print result summary, exit",
    )
    emb_group.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse FASTA, print stats, exit (no API calls)",
    )

    return parser


def main():
    """Main CLI function."""
    parser = create_argument_parser()
    args = parser.parse_args()

    # Set up logging first
    setup_logging(args.verbose)

    # Detect FASTA input and handle embedding-related early exits
    from protspace.data.io.fasta import is_fasta_file

    input_paths = args.input if isinstance(args.input, list) else [args.input]
    has_fasta = any(is_fasta_file(p) for p in input_paths if not p.is_dir())

    # Validation: embedding args require FASTA input
    if (args.embedder or args.probe or args.dry_run) and not has_fasta:
        parser.error("--embedder, --probe, and --dry-run require a FASTA input file")

    # Auto-default embedder when FASTA detected
    if has_fasta and args.embedder is None:
        from protspace.data.embedding.biocentral import DEFAULT_EMBEDDER

        args.embedder = DEFAULT_EMBEDDER
        logger.info(f"FASTA input detected, defaulting embedder to '{args.embedder}'")

    # Early exit: --dry-run
    if args.dry_run:
        from protspace.data.io.fasta import parse_fasta

        fasta_path = next(p for p in input_paths if is_fasta_file(p))
        sequences = parse_fasta(fasta_path)
        if not sequences:
            print(f"No sequences found in {fasta_path}")
            return
        lengths = [len(s) for s in sequences.values()]
        from protspace.data.embedding.biocentral import resolve_embedder

        embedder = resolve_embedder(args.embedder)
        print(f"FASTA:      {fasta_path}")
        print(f"Sequences:  {len(sequences):,}")
        print(
            f"Lengths:    min={min(lengths)}, "
            f"median={sorted(lengths)[len(lengths) // 2]}, "
            f"max={max(lengths)}"
        )
        print(f"Embedder:   {embedder}")
        print(
            f"Batches:    "
            f"{(len(sequences) + args.batch_size - 1) // args.batch_size}"
        )
        return

    # Early exit: --probe
    if args.probe:
        from protspace.data.embedding.biocentral import probe_embedder, resolve_embedder
        from protspace.data.io.fasta import parse_fasta

        fasta_path = next(p for p in input_paths if is_fasta_file(p))
        sequences = parse_fasta(fasta_path)
        if not sequences:
            print(f"No sequences found in {fasta_path}")
            return
        embedder = resolve_embedder(args.embedder)
        probe_embedder(sequences, embedder, half_precision=args.half_precision)
        return

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

        # Load input file(s) first to get headers (needed for path computation)
        # Handle both single and multiple inputs
        input_paths = args.input if isinstance(args.input, list) else [args.input]
        data, headers = processor.load_input_files(input_paths)

        # Use first input path for output path determination
        primary_input = input_paths[0]

        # Determine output paths with headers for hash computation
        output_path, intermediate_dir = determine_output_paths(
            output_arg=args.output,
            input_path=primary_input,
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

        # Load/generate metadata
        metadata = processor.load_or_generate_metadata(
            headers=headers,
            annotations=args.annotations,
            intermediate_dir=intermediate_dir,
            delimiter=args.delimiter,
            non_binary=args.non_binary,
            keep_tmp=args.keep_tmp,
            force_refetch=args.force_refetch,
        )

        # Apply score stripping at presentation layer
        if args.no_scores:
            metadata = strip_scores_from_df(metadata)

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

        logger.info(
            f"Successfully processed {len(headers)} items using {len(methods_list)} reduction methods"
        )
        logger.info(f"Output saved to: {output_path}")

        # Clean up temporary directory if --keep-tmp is not active
        if not args.keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
            logger.info(f"Cleaned up temporary directory: {intermediate_dir}")

    except FileNotFoundError as e:
        # Clean up temporary directory if --keep-tmp is not active (even on error)
        if not args.keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
        logger.error(str(e))
        print(f"ERROR: {e}", flush=True)
        sys.exit(1)
    except ValueError as e:
        if not args.keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
        logger.error(str(e))
        print(f"ERROR: {e}", flush=True)
        sys.exit(1)
    except Exception as e:
        if not args.keep_tmp and intermediate_dir and intermediate_dir.exists():
            shutil.rmtree(intermediate_dir)
        logger.error(str(e))
        print(f"ERROR: {e}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
