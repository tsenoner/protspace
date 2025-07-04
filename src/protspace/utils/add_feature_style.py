import argparse
import json
from pathlib import Path
from typing import Dict

from protspace.utils.arrow_reader import ArrowReader
from protspace.utils.json_reader import JsonReader

ALLOWED_SHAPES = [
    'circle', 'circle-open', 'cross', 'diamond',
    'diamond-open', 'square', 'square-open', 'x'
]

def load_feature_styles(feature_styles_input: str) -> Dict[str, Dict[str, Dict[str, str]]]:
    try:
        # Try to parse as JSON string
        return json.loads(feature_styles_input)
    except json.JSONDecodeError:
        # If not a valid JSON string, try to load as a file
        try:
            with open(feature_styles_input, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            raise ValueError(
                f"Invalid input: '{feature_styles_input}' is neither a valid JSON string nor a path to an existing JSON file."
            )

def detect_data_format(input_path: str) -> str:
    """Detect if input is JSON file or parquet directory."""
    path = Path(input_path)
    
    if path.is_file() and path.suffix.lower() == '.json':
        return 'json'
    elif path.is_dir():
        # Check if directory contains parquet files
        parquet_files = list(path.glob('*.parquet'))
        if parquet_files:
            return 'parquet'
        else:
            raise ValueError(f"Directory '{input_path}' does not contain any parquet files.")
    else:
        raise ValueError(f"Input '{input_path}' must be either a JSON file or a directory containing parquet files.")

def add_feature_styles_json(
    json_file: str, feature_styles: Dict[str, Dict[str, Dict[str, str]]], output_file: str
) -> None:
    """Add feature styles to JSON format data."""
    with open(json_file, "r") as f:
        data = json.load(f)
    
    reader = JsonReader(data)
    
    if "visualization_state" not in data:
        data["visualization_state"] = {}
    if "feature_colors" not in data["visualization_state"]:
        data["visualization_state"]["feature_colors"] = {}
    if "marker_shapes" not in data["visualization_state"]:
        data["visualization_state"]["marker_shapes"] = {}

    for feature, styles in feature_styles.items():
        # Check if the feature exists
        all_features = reader.get_all_features()
        if feature not in all_features:
            raise ValueError(f"Feature '{feature}' does not exist in the protein data. Available features: {all_features}")

        # Check if all values exist for the feature
        all_values = set(str(val) for val in reader.get_all_feature_values(feature))

        # Add colors
        if "colors" in styles:
            for value, color in styles["colors"].items():
                if str(value) not in all_values:
                    raise ValueError(f"Value '{value}' does not exist for feature '{feature}'. Available values: {sorted(all_values)}")
                reader.update_feature_color(feature, str(value), color)

        # Add shapes
        if "shapes" in styles:
            for value, shape in styles["shapes"].items():
                if str(value) not in all_values:
                    raise ValueError(f"Value '{value}' does not exist for feature '{feature}'. Available values: {sorted(all_values)}")
                reader.update_marker_shape(feature, str(value), shape)

    with open(output_file, "w") as f:
        json.dump(reader.get_data(), f, indent=2)

def add_feature_styles_parquet(
    parquet_dir: str,
    feature_styles: Dict[str, Dict[str, Dict[str, str]]],
    output_dir: str
) -> None:
    """Add feature styles to parquet format data."""
    reader = ArrowReader(Path(parquet_dir))

    for feature, styles in feature_styles.items():
        # Check if the feature exists
        all_features = reader.get_all_features()
        if feature not in all_features:
            raise ValueError(f"Feature '{feature}' does not exist in the protein data. Available features: {all_features}")

        # Check if all values exist for the feature
        all_values = set(str(val) for val in reader.get_all_feature_values(feature))

        # Add colors
        if "colors" in styles:
            for value, color in styles["colors"].items():
                if str(value) not in all_values:
                    raise ValueError(f"Value '{value}' does not exist for feature '{feature}'. Available values: {sorted(all_values)}")
                reader.update_feature_color(feature, str(value), color)

        # Add shapes
        if "shapes" in styles:
            for value, shape in styles["shapes"].items():
                if str(value) not in all_values:
                    raise ValueError(f"Value '{value}' does not exist for feature '{feature}'. Available values: {sorted(all_values)}")
                reader.update_marker_shape(feature, str(value), shape)

    # Save the updated data
    reader.save_data(Path(output_dir))

def add_feature_styles(
    input_file: str,
    feature_styles: Dict[str, Dict[str, Dict[str, str]]],
    output_file: str
) -> None:
    """Add feature styles to either JSON or parquet format data."""
    data_format = detect_data_format(input_file)
    
    if data_format == 'json':
        add_feature_styles_json(input_file, feature_styles, output_file)
    elif data_format == 'parquet':
        add_feature_styles_parquet(input_file, feature_styles, output_file)

def main():
    parser = argparse.ArgumentParser(
        description="Add or update feature colors and shapes in ProtSpace JSON or Parquet files"
    )
    parser.add_argument("input_file", help="Path to the input JSON file or directory containing parquet files")
    parser.add_argument("output_file", help="Path to save the updated JSON file or output directory for parquet files")
    parser.add_argument(
        "--feature_styles",
        required=True,
        help='JSON string of feature styles or path to a JSON file, e.g., \'{"feature1": {"colors": {"value1": "rgba(255, 0, 0, 0.8)"}, "shapes": {"value1": "circle"}}}\' or \'path/to/styles.json\'',
    )

    args = parser.parse_args()
    feature_styles = load_feature_styles(args.feature_styles)
    add_feature_styles(args.input_file, feature_styles, args.output_file)

if __name__ == "__main__":
    main()