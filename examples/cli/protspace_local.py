import subprocess


def run_prepare_json_script():
    command = [
        "protspace-local",
        "-i",
        "data/toxins/processed_data/toxins.h5",
        "-m",
        "phylum,protein_existence,length_fixed,length_quantile",  # uncomment to get all the available protein features
        "--methods",
        "pca2,pca3",
        "-o",
        "data/toxins/processed_data/toxins_output",  # output dir for arrow files
        # "--non-binary", # uncomment to get .json output
        # "--keep-tmp",
        # "--n_neighbors", "25",
        # "--min_dist", "0.5",
        # "--learning_rate", "1000",
        # "-v"
    ]

    result = subprocess.run(command)

    if result.returncode == 0:
        print("Script executed successfully!")
    else:
        print("Script execution failed!")


if __name__ == "__main__":
    run_prepare_json_script()
