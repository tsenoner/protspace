import argparse
import json
from pathlib import Path

from protspace.utils.arrow_reader import ArrowReader
from protspace.utils.json_reader import JsonReader

ALLOWED_SHAPES = [
    "circle",
    "circle-open",
    "cross",
    "diamond",
    "diamond-open",
    "square",
    "square-open",
    "x",
]


def load_annotation_styles(
    annotation_styles_input: str,
) -> dict[str, dict[str, dict[str, str]]]:
    try:
        # Try to parse as JSON string
        return json.loads(annotation_styles_input)
    except json.JSONDecodeError:
        # If not a valid JSON string, try to load as a file
        try:
            with open(annotation_styles_input) as f:
                return json.load(f)
        except FileNotFoundError as e:
            raise ValueError(
                f"Invalid input: '{annotation_styles_input}' is neither a valid JSON string nor a path to an existing JSON file."
            ) from e


def detect_data_format(input_path: str) -> str:
    """Detect if input is JSON file or parquet directory."""
    path = Path(input_path)

    if path.is_file() and path.suffix.lower() == ".json":
        return "json"
    elif path.is_dir():
        # Check if directory contains parquet files
        parquet_files = list(path.glob("*.parquet"))
        if parquet_files:
            return "parquet"
        else:
            raise ValueError(
                f"Directory '{input_path}' does not contain any parquet files."
            )
    else:
        raise ValueError(
            f"Input '{input_path}' must be either a JSON file or a directory containing parquet files."
        )


def add_annotation_styles_json(
    json_file: str,
    annotation_styles: dict[str, dict[str, dict[str, str]]],
    output_file: str,
) -> None:
    """Add annotation styles to JSON format data."""
    with open(json_file) as f:
        data = json.load(f)

    reader = JsonReader(data)

    if "visualization_state" not in data:
        data["visualization_state"] = {}
    if "annotation_colors" not in data["visualization_state"]:
        data["visualization_state"]["annotation_colors"] = {}
    if "marker_shapes" not in data["visualization_state"]:
        data["visualization_state"]["marker_shapes"] = {}

    for annotation, styles in annotation_styles.items():
        # Check if the annotation exists
        all_annotations = reader.get_all_annotations()
        if annotation not in all_annotations:
            raise ValueError(
                f"Annotation '{annotation}' does not exist in the protein data. Available annotations: {all_annotations}"
            )

        # Check if all values exist for the annotation
        all_values = {str(val) for val in reader.get_all_annotation_values(annotation)}

        # Add colors
        if "colors" in styles:
            for value, color in styles["colors"].items():
                if str(value) not in all_values:
                    raise ValueError(
                        f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                    )
                reader.update_annotation_color(annotation, str(value), color)

        # Add shapes
        if "shapes" in styles:
            for value, shape in styles["shapes"].items():
                if str(value) not in all_values:
                    raise ValueError(
                        f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                    )
                reader.update_marker_shape(annotation, str(value), shape)

    with open(output_file, "w") as f:
        json.dump(reader.get_data(), f, indent=2)


def add_annotation_styles_parquet(
    parquet_dir: str,
    annotation_styles: dict[str, dict[str, dict[str, str]]],
    output_dir: str,
) -> None:
    """Add annotation styles to parquet format data."""
    reader = ArrowReader(Path(parquet_dir))

    for annotation, styles in annotation_styles.items():
        # Check if the annotation exists
        all_annotations = reader.get_all_annotations()
        if annotation not in all_annotations:
            raise ValueError(
                f"Annotation '{annotation}' does not exist in the protein data. Available annotations: {all_annotations}"
            )

        # Check if all values exist for the annotation
        all_values = {str(val) for val in reader.get_all_annotation_values(annotation)}

        # Add colors
        if "colors" in styles:
            for value, color in styles["colors"].items():
                if str(value) not in all_values:
                    raise ValueError(
                        f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                    )
                reader.update_annotation_color(annotation, str(value), color)

        # Add shapes
        if "shapes" in styles:
            for value, shape in styles["shapes"].items():
                if str(value) not in all_values:
                    raise ValueError(
                        f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                    )
                reader.update_marker_shape(annotation, str(value), shape)

    # Save the updated data
    reader.save_data(Path(output_dir))


def add_annotation_styles(
    input_file: str,
    annotation_styles: dict[str, dict[str, dict[str, str]]],
    output_file: str,
) -> None:
    """Add annotation styles to either JSON or parquet format data."""
    data_format = detect_data_format(input_file)

    if data_format == "json":
        add_annotation_styles_json(input_file, annotation_styles, output_file)
    elif data_format == "parquet":
        add_annotation_styles_parquet(input_file, annotation_styles, output_file)


def main():
    parser = argparse.ArgumentParser(
        description="Add or update annotation colors and shapes in ProtSpace JSON or Parquet files"
    )
    parser.add_argument(
        "input_file",
        help="Path to the input JSON file or directory containing parquet files",
    )
    parser.add_argument(
        "output_file",
        help="Path to save the updated JSON file or output directory for parquet files",
    )
    parser.add_argument(
        "--annotation_styles",
        required=True,
        help='JSON string of annotation styles or path to a JSON file, e.g., \'{"annotation1": {"colors": {"value1": "rgba(255, 0, 0, 0.8)"}, "shapes": {"value1": "circle"}}}\' or \'path/to/styles.json\'',
    )

    args = parser.parse_args()
    annotation_styles = load_annotation_styles(args.annotation_styles)
    add_annotation_styles(args.input_file, annotation_styles, args.output_file)


if __name__ == "__main__":
    main()
