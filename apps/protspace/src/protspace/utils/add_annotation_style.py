import argparse
import json
from collections import Counter
from pathlib import Path

from protspace.utils.arrow_reader import ArrowReader
from protspace.utils.json_reader import JsonReader

ALLOWED_SHAPES = [
    "circle",
    "square",
    "diamond",
    "triangle-up",
    "triangle-down",
    "plus",
]

# Settings-level keys that are passed through to the bundle settings
# (everything except "colors" and "shapes" which are applied via the reader).
# "zOrderSort" and "pinnedValues" are processing-only keys consumed by the
# settings converter (not stored in the final output).
_SETTINGS_KEYS = {
    "sortMode",
    "maxVisibleValues",
    "shapeSize",
    "hiddenValues",
    "selectedPaletteId",
    "zOrderSort",
    "pinnedValues",
}


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
    """Detect if input is JSON file, parquet directory, or parquetbundle."""
    path = Path(input_path)

    if path.is_file() and path.suffix.lower() == ".json":
        return "json"
    elif path.is_file() and path.suffix.lower() == ".parquetbundle":
        return "parquetbundle"
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
            f"Input '{input_path}' must be a JSON file, a .parquetbundle file, "
            "or a directory containing parquet files."
        )


_NA_LABELS = {"", "<NA>", "NaN"}


def _resolve_na(value: str, all_values: set[str]) -> str | None:
    """If *value* is an NA-like label, return the matching label in *all_values*.

    Different data sources represent missing values as ``""``, ``"<NA>"``, or
    ``"NaN"``.  This helper maps between them so styles using one form still
    work when the data uses another.  Returns *None* when no match is found.
    """
    if value not in _NA_LABELS:
        return None
    for candidate in _NA_LABELS:
        if candidate in all_values:
            return candidate
    return None


def _to_display_value(raw: str) -> list[str]:
    """Convert a raw annotation value to its display name(s).

    Applies the same transformations the ProtSpace web frontend uses:

    1. **Semicolon split** – ``"familyA;familyB"`` becomes two entries
       ``["familyA", "familyB"]`` (multi-label).
    2. **Pipe trim** – ``"value|source"`` becomes ``"value"``
       (the part after ``|`` is a source tag, e.g. ``IC``, ``SAM``).

    Empty / whitespace-only parts are preserved as ``""`` (N/A sentinel).
    """
    parts = raw.split(";")
    display: list[str] = []
    for part in parts:
        trimmed = part.split("|", 1)[0]
        display.append(trimmed)
    return display


def compute_value_frequencies(reader) -> dict[str, dict[str, int]]:
    """Compute value frequencies for each annotation from a reader.

    Raw values are preprocessed to match the ProtSpace web frontend:
    pipe suffixes are trimmed and semicolons split into multi-label entries.

    Returns:
        ``{annotation_name: {display_value: count}}``
    """
    frequencies: dict[str, dict[str, int]] = {}
    for annotation in reader.get_all_annotations():
        raw_values = [str(v) for v in reader.get_all_annotation_values(annotation)]
        freq: dict[str, int] = {}
        for raw in raw_values:
            for display in _to_display_value(raw):
                freq[display] = freq.get(display, 0) + 1
        frequencies[annotation] = freq
    return frequencies


def generate_template(input_file: str) -> dict:
    """Generate a pre-filled styles template from an input file.

    Reads annotations, computes value frequencies, and outputs a template
    with values in frequency-descending order. ``<NA>`` gets a default
    light-gray color.
    """
    data_format = detect_data_format(input_file)

    if data_format == "json":
        with open(input_file) as f:
            data = json.load(f)
        reader = JsonReader(data)
    elif data_format == "parquetbundle":
        from protspace.data.io.bundle import extract_bundle_to_dir

        temp_dir = extract_bundle_to_dir(Path(input_file))
        reader = ArrowReader(Path(temp_dir))
    elif data_format == "parquet":
        reader = ArrowReader(Path(input_file))

    frequencies = compute_value_frequencies(reader)
    template: dict = {}

    for annotation in sorted(reader.get_all_annotations()):
        freqs = frequencies.get(annotation, {})
        # Sort values by frequency descending
        sorted_values = sorted(freqs.keys(), key=lambda v: freqs.get(v, 0), reverse=True)

        colors: dict[str, str] = {}
        for value in sorted_values:
            if value in ("<NA>", "NaN", ""):
                colors[value] = "#C0C0C0"
            else:
                colors[value] = ""

        template[annotation] = {
            "sortMode": "size-desc",
            "maxVisibleValues": 10,
            "shapeSize": 30,
            "selectedPaletteId": "kellys",
            "hiddenValues": [],
            "colors": colors,
            "shapes": {},
        }

    return template


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
                resolved = str(value)
                if resolved not in all_values:
                    na_match = _resolve_na(resolved, all_values)
                    if na_match is not None:
                        resolved = na_match
                    else:
                        raise ValueError(
                            f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                        )
                reader.update_annotation_color(annotation, resolved, color)

        # Add shapes
        if "shapes" in styles:
            for value, shape in styles["shapes"].items():
                resolved = str(value)
                if resolved not in all_values:
                    na_match = _resolve_na(resolved, all_values)
                    if na_match is not None:
                        resolved = na_match
                    else:
                        raise ValueError(
                            f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                        )
                reader.update_marker_shape(annotation, resolved, shape)

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
                resolved = str(value)
                if resolved not in all_values:
                    na_match = _resolve_na(resolved, all_values)
                    if na_match is not None:
                        resolved = na_match
                    else:
                        raise ValueError(
                            f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                        )
                reader.update_annotation_color(annotation, resolved, color)

        # Add shapes
        if "shapes" in styles:
            for value, shape in styles["shapes"].items():
                resolved = str(value)
                if resolved not in all_values:
                    na_match = _resolve_na(resolved, all_values)
                    if na_match is not None:
                        resolved = na_match
                    else:
                        raise ValueError(
                            f"Value '{value}' does not exist for annotation '{annotation}'. Available values: {sorted(all_values)}"
                        )
                reader.update_marker_shape(annotation, resolved, shape)

    # Save the updated data
    reader.save_data(Path(output_dir))


def add_annotation_styles_bundle(
    bundle_file: str,
    annotation_styles: dict[str, dict[str, dict[str, str]]],
    output_file: str,
) -> None:
    """Add annotation styles to a .parquetbundle file.

    Extracts the bundle to a temp dir, applies styles via ArrowReader, converts
    the visualization_state back to settings_json, then writes the output
    bundle with updated settings.

    The *annotation_styles* dict may contain per-annotation settings-level
    keys (``sortMode``, ``maxVisibleValues``, ``shapeSize``, ``hiddenValues``,
    ``selectedPaletteId``) alongside ``colors`` and ``shapes``.  These are
    forwarded to the settings converter.
    """
    from protspace.data.io.bundle import (
        extract_bundle_to_dir,
        read_bundle,
        replace_settings_in_bundle,
    )
    from protspace.data.io.settings_converter import visualization_state_to_settings

    # Extract bundle so ArrowReader can load the data
    temp_dir = extract_bundle_to_dir(Path(bundle_file))
    reader = ArrowReader(Path(temp_dir))

    # Read existing settings from the bundle (if any) to preserve extra fields
    _, existing_settings = read_bundle(Path(bundle_file))

    # Collect settings-level overrides from the styles input
    style_overrides: dict[str, dict] = {}

    for annotation, styles in annotation_styles.items():
        all_annotations = reader.get_all_annotations()
        if annotation not in all_annotations:
            raise ValueError(
                f"Annotation '{annotation}' does not exist in the protein data. "
                f"Available annotations: {all_annotations}"
            )

        all_values = {str(val) for val in reader.get_all_annotation_values(annotation)}

        # Extract settings-level keys for this annotation
        overrides = {k: v for k, v in styles.items() if k in _SETTINGS_KEYS}
        if overrides:
            style_overrides[annotation] = overrides

        if "colors" in styles:
            for value, color in styles["colors"].items():
                resolved = str(value)
                if resolved not in all_values:
                    na_match = _resolve_na(resolved, all_values)
                    if na_match is not None:
                        resolved = na_match
                    else:
                        raise ValueError(
                            f"Value '{value}' does not exist for annotation "
                            f"'{annotation}'. Available values: {sorted(all_values)}"
                        )
                reader.update_annotation_color(annotation, resolved, color)

        if "shapes" in styles:
            for value, shape in styles["shapes"].items():
                resolved = str(value)
                if resolved not in all_values:
                    na_match = _resolve_na(resolved, all_values)
                    if na_match is not None:
                        resolved = na_match
                    else:
                        raise ValueError(
                            f"Value '{value}' does not exist for annotation "
                            f"'{annotation}'. Available values: {sorted(all_values)}"
                        )
                reader.update_marker_shape(annotation, resolved, shape)

    # Compute value frequencies for frequency-based zOrder
    value_frequencies = compute_value_frequencies(reader)

    # Convert updated visualization_state back to settings_json
    viz_state = reader.data.get("visualization_state", {})
    new_settings = visualization_state_to_settings(
        viz_state,
        existing_settings,
        value_frequencies=value_frequencies,
        style_overrides=style_overrides or None,
    )

    # Write output bundle with updated settings
    replace_settings_in_bundle(
        Path(bundle_file), Path(output_file), new_settings
    )


def add_annotation_styles(
    input_file: str,
    annotation_styles: dict[str, dict[str, dict[str, str]]],
    output_file: str,
) -> None:
    """Add annotation styles to JSON, parquet, or parquetbundle format data."""
    data_format = detect_data_format(input_file)

    if data_format == "json":
        add_annotation_styles_json(input_file, annotation_styles, output_file)
    elif data_format == "parquet":
        add_annotation_styles_parquet(input_file, annotation_styles, output_file)
    elif data_format == "parquetbundle":
        add_annotation_styles_bundle(input_file, annotation_styles, output_file)


def dump_settings(input_file: str) -> None:
    """Print the settings/visualization_state stored in a ProtSpace file."""
    data_format = detect_data_format(input_file)

    if data_format == "parquetbundle":
        from protspace.data.io.bundle import read_bundle

        _, settings = read_bundle(Path(input_file))
        if settings is None:
            print("No settings found in bundle (3-part bundle).")
        else:
            print(json.dumps(settings, indent=2))
    elif data_format == "parquet":
        viz_state_path = Path(input_file) / "visualization_state.json"
        settings_path = Path(input_file) / "settings.parquet"
        if viz_state_path.exists():
            with open(viz_state_path) as f:
                print(f.read())
        elif settings_path.exists():
            from protspace.data.io.bundle import read_settings_from_file

            settings = read_settings_from_file(settings_path)
            print(json.dumps(settings, indent=2))
        else:
            print("No settings found in parquet directory.")
    elif data_format == "json":
        with open(input_file) as f:
            data = json.load(f)
        viz_state = data.get("visualization_state", {})
        print(json.dumps(viz_state, indent=2))


def main():
    parser = argparse.ArgumentParser(
        description="Add or update annotation styles (colors, shapes, legend ordering) "
        "in ProtSpace .parquetbundle, Parquet, or JSON files.",
        epilog="""\
styles JSON format:
  Each top-level key is an annotation name. Per annotation:

  Stored keys (persisted in the output bundle):
    colors             Map of {value: color} (hex or rgba)
    shapes             Map of {value: shape} (circle, square, diamond, ...)
    sortMode           Legend sort: size-desc, size-asc, alpha-asc, alpha-desc, manual
    maxVisibleValues   Max legend entries before "Other" (default: 10)
    shapeSize          Marker size (default: 30)
    hiddenValues       List of values hidden from the plot
    selectedPaletteId  Color palette (default: kellys)

  Processing-only keys (consumed during generation, NOT stored):
    zOrderSort         Sort mode for zOrder assignment only, overriding sortMode
    pinnedValues       Ordered list of values for legend positions 0..N-1
                       Use "" for N/A, "__REST__" to auto-fill from top values

  Example — pin 2 families + N/A:
    {"protein_families": {"maxVisibleValues": 3, "sortMode": "manual",
     "zOrderSort": "size-desc", "pinnedValues": ["familyA", "familyB", ""]}}

  Example — top values by frequency, N/A at end:
    {"ec": {"sortMode": "manual", "zOrderSort": "size-desc",
     "pinnedValues": ["__REST__", ""]}}

  Values use display names (pipe suffixes trimmed, semicolons split).
  See docs/styling.md for full documentation.
""",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "input_file",
        help="Path to input .parquetbundle, .json file, or parquet directory",
    )
    parser.add_argument(
        "output_file",
        nargs="?",
        default=None,
        help="Output path. Not required for --dump-settings or --generate-template.",
    )
    parser.add_argument(
        "--annotation_styles",
        help="Styles as an inline JSON string or path to a JSON file. "
        "See epilog below or docs/styling.md for the full format.",
    )
    parser.add_argument(
        "--dump-settings",
        action="store_true",
        help="Print stored settings and exit (no output_file needed).",
    )
    parser.add_argument(
        "--generate-template",
        action="store_true",
        help="Print a pre-filled styles template (values in frequency order, "
        "empty color placeholders) and exit.",
    )

    args = parser.parse_args()

    if args.dump_settings:
        dump_settings(args.input_file)
        return

    if args.generate_template:
        template = generate_template(args.input_file)
        print(json.dumps(template, indent=2))
        return

    if not args.annotation_styles:
        parser.error("--annotation_styles is required when not using --dump-settings or --generate-template")
    if not args.output_file:
        parser.error("output_file is required when not using --dump-settings or --generate-template")

    annotation_styles = load_annotation_styles(args.annotation_styles)
    add_annotation_styles(args.input_file, annotation_styles, args.output_file)


if __name__ == "__main__":
    main()
