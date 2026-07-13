import json
import logging
from pathlib import Path

from protspace.data.annotations.encoding import to_display_value
from protspace.utils.arrow_reader import ArrowReader

logger = logging.getLogger(__name__)

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

# Built-in palette IDs, mirrored from the web frontend — the source of truth:
# protspace_web/packages/utils/src/visualization/color-scheme.ts (COLOR_SCHEMES) and
# numeric-binning.ts (GRADIENT_COLOR_SCHEME_IDS). `selectedPaletteId` may only be a
# categorical id; numeric gradients are chosen in the UI (see docs/styling.md).
# Keep this list in sync with those files.
_CATEGORICAL_PALETTE_IDS = frozenset(
    {"kellys", "okabeIto", "tolBright", "set2", "dark2", "tableau10"}
)
_GRADIENT_PALETTE_IDS = frozenset({"batlow", "viridis", "cividis", "inferno", "plasma"})


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
    """Detect if input is a parquet directory or parquetbundle."""
    path = Path(input_path)

    if path.is_file() and path.suffix.lower() == ".parquetbundle":
        return "parquetbundle"
    elif path.is_dir():
        parquet_files = list(path.glob("*.parquet"))
        if parquet_files:
            return "parquet"
        else:
            raise ValueError(
                f"Directory '{input_path}' does not contain any parquet files."
            )
    else:
        raise ValueError(
            f"Input '{input_path}' must be a .parquetbundle file "
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


def _to_display_value(raw: str, *, decode: bool = True) -> list[str]:
    """Convert a raw annotation value to its display name(s).

    Applies the same transformations the ProtSpace web frontend uses:

    1. **Semicolon split** – ``"familyA;familyB"`` becomes two entries
       ``["familyA", "familyB"]`` (multi-label).
    2. **Pipe trim + percent-decode** – each part is reduced to its display
       value via :func:`protspace.data.annotations.encoding.to_display_value`
       (drop the ``|source`` suffix; v2-decode the free-text name). ``decode``
       gates the v2 percent-decode on the bundle format version, so legacy
       (pre-v2) values pass through unchanged.

    Empty / whitespace-only parts are preserved as ``""`` (N/A sentinel).
    """
    return [to_display_value(part, decode=decode) for part in raw.split(";")]


def compute_value_frequencies(reader) -> dict[str, dict[str, int]]:
    """Compute value frequencies for each annotation from a reader.

    Raw values are preprocessed to match the ProtSpace web frontend:
    pipe suffixes are trimmed and semicolons split into multi-label entries.

    Returns:
        ``{annotation_name: {display_value: count}}``
    """
    decode = reader.should_decode()
    frequencies: dict[str, dict[str, int]] = {}
    for annotation in reader.get_all_annotations():
        raw_values = [str(v) for v in reader.get_all_annotation_values(annotation)]
        freq: dict[str, int] = {}
        for raw in raw_values:
            for display in _to_display_value(raw, decode=decode):
                freq[display] = freq.get(display, 0) + 1
        frequencies[annotation] = freq
    return frequencies


def _annotation_display_values(reader, annotation: str) -> set[str]:
    """Display values for one annotation — the keys a styles file is keyed by.

    Mirrors :func:`_to_display_value` (v2-decode, ``|`` suffix trim, ``;``
    split), the exact transform :func:`generate_template` uses, so a styles
    file built from the template validates and stores against the same keys the
    plot/legend groups by — not the raw percent-encoded wire cells. NA-like
    labels carry no reserved char, so they pass through unchanged.
    """
    decode = reader.should_decode()
    values: set[str] = set()
    for raw in reader.get_all_annotation_values(annotation):
        values.update(_to_display_value(str(raw), decode=decode))
    return values


def _warn_if_numeric(annotation: str, display_values) -> bool:
    """Warn when *annotation*'s values look numeric; return whether they do.

    The CLI styling model is categorical-only, but the web frontend bins numeric
    columns into gradient ranges — so per-value colors/shapes/pins set via the
    CLI silently do not apply. Naming the column + its distinct-value count makes
    that visible instead of a surprise. See ``docs/styling.md`` (Numeric
    annotations).
    """
    from protspace.stats.annotation_select import _is_missing, _is_numeric

    cleaned = [v for v in display_values if not _is_missing(v)]
    if not _is_numeric(cleaned):
        return False
    logger.warning(
        "Annotation '%s' looks numeric (%d distinct values). `protspace style` is "
        "categorical-only: per-value colors/shapes/pinnedValues will not apply and "
        "--generate-template lists every number as its own category. Pre-bin it into "
        "categorical range labels (e.g. '100-200') or color it as a continuous "
        "gradient in the web app (https://protspace.app/explore). "
        "See docs/styling.md#numeric-annotations.",
        annotation,
        len(cleaned),
    )
    return True


def _warn_if_bad_palette(annotation: str, styles: dict) -> None:
    """Warn when a categorical column's ``selectedPaletteId`` is not a categorical id.

    For a categorical column ``selectedPaletteId`` picks the palette, and the frontend
    silently resets a gradient or unknown id to ``kellys`` (see ``docs/styling.md`` —
    Color palettes). Naming the offending id makes that reset visible instead of a
    surprise. A numeric column instead reads ``selectedPaletteId`` as its gradient, so
    callers skip this check for numeric columns.
    """
    palette = styles.get("selectedPaletteId")
    if not isinstance(palette, str) or not palette:
        return
    if palette in _CATEGORICAL_PALETTE_IDS:
        return
    if palette in _GRADIENT_PALETTE_IDS:
        reason = f"'{palette}' is a numeric gradient, not a categorical palette"
    else:
        reason = f"'{palette}' is not a known palette"
    logger.warning(
        "Annotation '%s': selectedPaletteId %s; the frontend will fall back to "
        "'kellys'. Categorical palettes: %s. See docs/styling.md#color-palettes.",
        annotation,
        reason,
        ", ".join(sorted(_CATEGORICAL_PALETTE_IDS)),
    )


def generate_template(input_file: str) -> dict:
    """Generate a pre-filled styles template from an input file.

    Reads annotations, computes value frequencies, and outputs a template
    with values in frequency-descending order. ``<NA>`` gets a default
    light-gray color.
    """
    data_format = detect_data_format(input_file)

    if data_format == "parquetbundle":
        from protspace.data.io.bundle import extract_bundle_to_dir

        temp_dir = extract_bundle_to_dir(Path(input_file))
        reader = ArrowReader(Path(temp_dir))
    elif data_format == "parquet":
        reader = ArrowReader(Path(input_file))

    frequencies = compute_value_frequencies(reader)
    template: dict = {}

    for annotation in sorted(reader.get_all_annotations()):
        freqs = frequencies.get(annotation, {})
        _warn_if_numeric(annotation, freqs.keys())
        # Sort values by frequency descending
        sorted_values = sorted(
            freqs.keys(), key=lambda v: freqs.get(v, 0), reverse=True
        )

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

        # Validate/store against display values (what the template exposes),
        # not the raw percent-encoded wire cells, so a template round-trips.
        all_values = _annotation_display_values(reader, annotation)
        _warn_if_numeric(annotation, all_values)

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

    # Compute value frequencies once (used for validation below and for
    # frequency-based zOrder). Its keys are the display values a style file is
    # keyed by — the same set _annotation_display_values would build — so it
    # doubles as the validation set without a second full-protein scan. Style
    # updates only mutate visualization_state, not annotation values, so the
    # frequencies stay valid for the zOrder pass afterwards.
    value_frequencies = compute_value_frequencies(reader)

    for annotation, styles in annotation_styles.items():
        all_annotations = reader.get_all_annotations()
        if annotation not in all_annotations:
            raise ValueError(
                f"Annotation '{annotation}' does not exist in the protein data. "
                f"Available annotations: {all_annotations}"
            )

        all_values = set(value_frequencies.get(annotation, {}))
        # selectedPaletteId is the categorical palette; a numeric column reads it as
        # its gradient instead (a gradient id applies — see docs/styling.md), so the
        # categorical-palette check only runs when the column is not numeric.
        if not _warn_if_numeric(annotation, all_values):
            _warn_if_bad_palette(annotation, styles)

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

    # Convert updated visualization_state back to settings_json
    viz_state = reader.data.get("visualization_state", {})
    new_settings = visualization_state_to_settings(
        viz_state,
        existing_settings,
        value_frequencies=value_frequencies,
        style_overrides=style_overrides or None,
    )

    # Write output bundle with updated settings
    replace_settings_in_bundle(Path(bundle_file), Path(output_file), new_settings)


def add_annotation_styles(
    input_file: str,
    annotation_styles: dict[str, dict[str, dict[str, str]]],
    output_file: str,
) -> None:
    """Add annotation styles to parquet or parquetbundle format data."""
    data_format = detect_data_format(input_file)

    if data_format == "parquet":
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
