"""
python -m src.protspace.utils.prepare_json --input data/3FTx/3FTx_prott5.h5 --metadata data/3FTx/3FTx.csv --methods pca2 pca3 umap2 umap3 tsne2 tsne3 -o data/3FTx/3FTx.json --n_neighbors 25 --min_dist 0.5 --learning_rate 1000 -v
"""
import subprocess

def run_prepare_json_script():
    command = [
        "python", "-m", "src.protspace.utils.prepare_json",
        "-i", "data/toxins/processed_data/toxins.h5",
        "-m", "protein_existence, annotation_score",
        "--methods", "umap2", "tsne2", "pca2",
        "-o", "data/toxins/processed_data/toxins_generated.json",
        "--n_neighbors", "25",
        "--min_dist", "0.5",
        "--learning_rate", "1000",
        "-v"
    ]

    result = subprocess.run(command)

    if result.returncode == 0:
        print("Script executed successfully!")
    else:
        print("Script execution failed!")

if __name__ == "__main__":
    run_prepare_json_script()
