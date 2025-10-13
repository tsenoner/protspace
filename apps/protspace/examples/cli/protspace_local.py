#!/usr/bin/env python3
"""
ProtSpace Local Data Example

This example demonstrates how to use protspace-local to process
local protein embeddings with dimensionality reduction.

Example: Process toxins dataset with feature extraction
"""

import subprocess
from pathlib import Path


def run_protspace_local():
    """Run protspace-local with example parameters."""
    # Define input and output paths
    input_file = "data/toxins/processed_data/toxins.h5"
    output_dir = "data/toxins/processed_data/toxins_output"

    # Check if input file exists
    if not Path(input_file).exists():
        print(f"❌ Input file not found: {input_file}")
        print("Please ensure the toxins dataset is available.")
        return False

    # Define the command with all parameters
    command = [
        "protspace-local",
        "-i",
        input_file,
        "-f",
        "phylum,protein_existence,length_fixed,length_quantile,pfam,superfamily,cath,signal_peptide",
        "--methods",
        "pca2,pca3",
        "-o",
        output_dir,
        # Uncomment any of these options as needed:
        # "--non-binary",  # Use JSON output instead of Parquet
        # "--keep-tmp",    # Cache intermediate files for reuse
        # "--bundled", "false",  # Don't bundle Parquet files
        # "--n_neighbors", "25",  # UMAP parameter
        # "--min_dist", "0.5",     # UMAP parameter
        # "--learning_rate", "1000",  # t-SNE parameter
        # "-v"  # Verbose output
    ]

    print("Running protspace-local...")
    print(f"Input: {input_file}")
    print(f"Output: {output_dir}")
    print(f"Command: {' '.join(command)}")
    print()

    # Execute the command
    result = subprocess.run(command)

    # Check the result
    if result.returncode == 0:
        print("✅ Local processing completed successfully!")
        print(f"📁 Output saved to: {output_dir}.parquetbundle")
    else:
        print("❌ Local processing failed!")
        return False

    return True


if __name__ == "__main__":
    success = run_protspace_local()
    exit(0 if success else 1)
