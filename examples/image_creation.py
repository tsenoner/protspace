from pathlib import Path

from protspace import ProtSpace


def main():
    # Path to the JSON file
    # json_file = "data/toxins/processed_data/toxins_generated.json"
    arrow_dir = "data/toxins/processed_data/toxins_query_new_zstd"

    # Initialize the ProtSpaceApp
    # protspace = ProtSpace(default_json_file=json_file)
    protspace = ProtSpace(arrow_dir=arrow_dir)

    # --- Print available projection names --- Uncomment if needed

    # if protspace.default_json_data:
    #     from protspace.data_loader import JsonReader
    #     reader = JsonReader(protspace.default_json_data)
    #     print("Available projection names:", reader.get_projection_names())

    # Generate images for specific projections and annotations
    # projections = ["PCA_2", "PCA_3"]
    projections = ["PCA_3"]
    annotations = ["protein_existence", "annotation_score"]

    # Create the output directory if it doesn't exist
    output_dir = Path("examples/out/automatic_projections")
    output_dir.mkdir(parents=True, exist_ok=True)

    for projection in projections:
        for annotation in annotations:
            protspace.generate_plot(
                projection=projection,
                annotation=annotation,
                filename=output_dir / f"{projection}_{annotation}",
                width=1600,
                height=1000,
                file_format="html",
            )
            print(f"Generated image for {projection} - {annotation}")


if __name__ == "__main__":
    main()
