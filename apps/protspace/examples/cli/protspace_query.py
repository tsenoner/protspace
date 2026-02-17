#!/usr/bin/env python3
"""
ProtSpace Query Example

This example demonstrates how to use protspace-query to search UniProt
and process protein data with dimensionality reduction.

Example query: Find human transmembrane proteins that are reviewed
"""

import subprocess


def run_protspace_query():
    """Run protspace-query with example parameters."""
    # Define the command with all parameters
    command = [
        "protspace-query",
        "-q",
        "(organism_id:9606) AND (reviewed:true) AND (ft_transmem_exp:helical)",
        "--annotations",
        "phylum,protein_existence,length_fixed,length_quantile,pfam,cath,superfamily,signal_peptide",
        "--methods",
        "pca2,pca3",
        "-o",
        "examples/cli/query_output",
        # Uncomment any of these options as needed:
        # "--non-binary",  # Use JSON output instead of Parquet
        # "--keep-tmp",    # Cache intermediate files for reuse
        # "--n_neighbors", "25",  # UMAP parameter
        # "--min_dist", "0.5",     # UMAP parameter
        # "--learning_rate", "1000",  # t-SNE parameter
        # "-v"  # Verbose output
    ]

    print("Running protspace-query...")
    print(f"Command: {' '.join(command)}")
    print()

    # Execute the command
    result = subprocess.run(command)

    # Check the result
    if result.returncode == 0:
        print("✅ Query completed successfully!")
        print("📁 Output saved to: examples/cli/query_output.parquetbundle")
    else:
        print("❌ Query failed!")
        return False

    return True


if __name__ == "__main__":
    success = run_protspace_query()
    exit(0 if success else 1)
