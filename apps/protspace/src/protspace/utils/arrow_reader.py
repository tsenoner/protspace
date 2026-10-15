import json
import logging
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

logger = logging.getLogger(__name__)


def _read_format_version(schema_metadata: dict | None) -> int:
    """Extract the bundle format version from parquet schema metadata.

    Returns 1 (legacy, un-encoded) when the stamp is absent or unparseable, so
    display consumers only run the v2 percent-decode on genuinely v2 data.
    """
    from protspace.data.annotations.encoding import FORMAT_VERSION_KEY

    raw = (schema_metadata or {}).get(FORMAT_VERSION_KEY)
    try:
        return int(raw)  # int(None) raises TypeError → caught below → 1
    except (TypeError, ValueError):
        return 1


class ArrowReader:
    """Read and manipulate ProtSpace data from Parquet files or a dict.

    Accepts a ``Path`` to a ``.parquetbundle`` file or to a directory of
    Parquet files, or a pre-built ``dict`` (the same structure previously
    handled by the legacy ``JsonReader``).
    """

    def __init__(self, source: Path | dict):
        """
        Args:
            source: Path to a .parquetbundle file or to a directory
                containing .parquet files, or a pre-built data dict
                (protein_data, projections, …).
        """
        self.settings = None
        self.statistics = None
        self._protein_annotations_df = None
        self._projections_metadata_df = None
        self._projections_data_df = None
        if isinstance(source, dict):
            # Direct dict input
            self.data = source
            self.data_path = None
        else:
            # Parquet file loading
            self.data_path = Path(source)
            self.data = {
                "protein_data": {},
                "projections": [],
                "visualization_state": {"annotation_colors": {}, "marker_shapes": {}},
            }
            self._load_data()
            self._build_data_structure()

    def _load_data(self):
        """Load the core tables from a .parquetbundle file or a directory."""
        path = self.data_path
        if path.is_file():
            tables = self._read_bundle(path)
        elif path.is_dir():
            tables = self._read_directory(path)
        else:
            raise FileNotFoundError(f"No such file or directory: '{path}'")

        annotations, metadata, projections = tables
        if annotations is not None:
            self._protein_annotations_df = annotations.to_pandas()
            self.data["format_version"] = _read_format_version(
                annotations.schema.metadata
            )
        else:
            self._protein_annotations_df = pd.DataFrame(columns=["protein_id"])
        self._projections_metadata_df = (
            metadata.to_pandas()
            if metadata is not None
            else pd.DataFrame(columns=["projection_name", "dimensions", "info_json"])
        )
        self._projections_data_df = (
            projections.to_pandas()
            if projections is not None
            else pd.DataFrame(columns=["projection_name", "identifier", "x", "y", "z"])
        )

    def _read_bundle(self, path: Path) -> tuple[pa.Table, pa.Table, pa.Table]:
        """Read a bundle in memory, whatever its container version."""
        from protspace.data.io.bundle import read_bundle_contents

        contents = read_bundle_contents(path)
        self.settings = contents.settings
        self.statistics = contents.statistics
        return contents.annotations, contents.metadata, contents.projections

    def _read_directory(self, path: Path) -> tuple[pa.Table | None, ...]:
        """Read the core tables a directory holds; a missing one reads as None.

        An annotations-only directory is valid, but one holding none of the core
        tables is not ProtSpace data and must not read as an empty dataset.
        """
        from protspace.data.io.bundle import CORE_FILENAMES, STATISTICS_FILENAME

        core_paths = [path / name for name in CORE_FILENAMES]
        if not any(p.exists() for p in core_paths):
            raise ValueError(
                f"Directory '{path}' contains none of {', '.join(CORE_FILENAMES)}."
            )
        statistics_path = path / STATISTICS_FILENAME
        try:
            if statistics_path.exists():
                self.statistics = pq.read_table(str(statistics_path))
            return tuple(
                pq.read_table(str(p)) if p.exists() else None for p in core_paths
            )
        except Exception as e:
            raise ValueError(f"Error loading Arrow data from {path}: {e}") from e

    def _build_data_structure(self):
        """Build the data structure matching the ProtSpace data schema."""
        # Use the first column as identifier (tsenoner/protspace-legacy#10)
        id_col = self._protein_annotations_df.columns[0]

        # Build protein_data
        for _, row in self._protein_annotations_df.iterrows():
            protein_id = row[id_col]
            annotations = {}
            for col in self._protein_annotations_df.columns:
                if col != id_col:
                    annotations[col] = row[col]
            self.data["protein_data"][protein_id] = {"annotations": annotations}

        # Build projections
        self.data["projections"] = []
        for projection_name in self._projections_metadata_df[
            "projection_name"
        ].unique():
            proj_meta = self._projections_metadata_df[
                self._projections_metadata_df["projection_name"] == projection_name
            ].iloc[0]

            proj_data = self._projections_data_df[
                self._projections_data_df["projection_name"] == projection_name
            ]

            projection = {
                "name": projection_name,
                "dimensions": proj_meta["dimensions"],
                "info": {},
                "data": [],
            }

            # Add info if available
            if pd.notna(proj_meta["info_json"]):
                try:
                    projection["info"] = json.loads(proj_meta["info_json"])
                except json.JSONDecodeError:
                    pass

            # Add projection data
            for _, row in proj_data.iterrows():
                coordinates = {"x": row["x"], "y": row["y"]}
                if pd.notna(row["z"]):
                    coordinates["z"] = row["z"]

                projection["data"].append(
                    {"identifier": row["identifier"], "coordinates": coordinates}
                )

            self.data["projections"].append(projection)

        # Load visualization state from separate JSON file if it exists
        self._load_visualization_state()

    def _load_visualization_state(self):
        """Load settings and visualization state.

        A bundle carries them in its settings part, a directory in
        settings.parquet. A directory's visualization_state.json (written by an
        older ``protspace style``) wins for the visualization state; the
        settings are loaded either way, so a rewrite keeps them.
        """
        try:
            from protspace.data.io.bundle import (
                SETTINGS_FILENAME,
                read_settings_from_file,
            )
            from protspace.data.io.settings_converter import (
                settings_to_visualization_state,
            )

            settings_path = self.data_path / SETTINGS_FILENAME
            if self.data_path.is_dir() and settings_path.exists():
                self.settings = read_settings_from_file(settings_path)
            if self.settings:
                self.data["visualization_state"] = settings_to_visualization_state(
                    self.settings
                )
        except Exception:
            logger.debug(
                "Failed to load visualization state from settings", exc_info=True
            )

        from protspace.data.io.bundle import VISUALIZATION_STATE_FILENAME

        if self.data_path.is_dir():
            viz_state_path = self.data_path / VISUALIZATION_STATE_FILENAME
            if viz_state_path.exists():
                try:
                    with open(viz_state_path) as f:
                        self.data["visualization_state"] = json.load(f)
                except (json.JSONDecodeError, FileNotFoundError):
                    pass

    def save_data(self, output_path: Path | None = None):
        """Save the data as a ProtSpace directory, via ``write_directory``.

        Colours and shapes set on this reader are stored in its settings, as a
        bundle stores them.

        Defaults to the directory the data was read from. A reader built from
        a .parquetbundle needs an explicit ``output_path``: the bundle is a
        file, not a directory the tables could be written into.
        """
        if self.data_path is None:
            raise ValueError(
                "save_data writes the parquet tables a reader loaded; this "
                "reader was built from a dict and holds none."
            )
        if output_path is None:
            if self.data_path.is_file():
                raise ValueError(
                    f"'{self.data_path}' is a bundle file, not a directory; "
                    "pass save_data an output directory."
                )
            output_path = self.data_path
        else:
            output_path = Path(output_path)

        from protspace.data.io.bundle import write_directory

        annotations, metadata, projections = (
            pa.Table.from_pandas(df)
            for df in (
                self._protein_annotations_df,
                self._projections_metadata_df,
                self._projections_data_df,
            )
        )
        if self.should_decode():
            # The cells are written back as they were read, so they keep the
            # grammar stamp that says so; unstamped they would read as v1.
            from protspace.data.annotations.encoding import stamp_format_version

            annotations = stamp_format_version(annotations)
        write_directory(
            [annotations, metadata, projections],
            output_path,
            settings=self._current_settings(),
            statistics=self.statistics,
        )

    def _current_settings(self) -> dict | None:
        """The settings read, updated with the colours and shapes set since.

        Unchanged settings are returned as read, never re-converted.
        """
        from protspace.data.io.settings_converter import (
            settings_to_visualization_state,
            visualization_state_to_settings,
        )

        state = self.data.get("visualization_state") or {}
        if not (state.get("annotation_colors") or state.get("marker_shapes")):
            return self.settings
        if self.settings and state == settings_to_visualization_state(self.settings):
            return self.settings
        return visualization_state_to_settings(state, self.settings)

    def get_format_version(self) -> int:
        """Return the bundle format version (1 = legacy/un-encoded, 2 = v2).

        Threaded through ``self.data`` so it survives the dict round-trip the
        Dash ``serve`` store makes (``get_data()`` → ``json-data-store`` →
        ``ArrowReader(dict)``). Display code gates the v2 percent-decode on
        ``get_format_version() >= 2``.
        """
        try:
            return int(self.data.get("format_version", 1))
        except (TypeError, ValueError):
            return 1

    def should_decode(self) -> bool:
        """Whether display code should percent-decode annotation cells.

        True only for v2+ bundles; the single home for the version→policy gate
        so display sites can't drift or hardcode the threshold.
        """
        from protspace.data.annotations.encoding import BUNDLE_FORMAT_VERSION

        return self.get_format_version() >= BUNDLE_FORMAT_VERSION

    def get_projection_names(self) -> list[str]:
        """Get list of projection names."""
        return [proj["name"] for proj in self.data.get("projections", [])]

    def get_all_annotations(self) -> list[str]:
        """Get list of all annotation names."""
        annotations = set()
        for protein_data in self.data.get("protein_data", {}).values():
            annotations.update(protein_data.get("annotations", {}).keys())
        return list(annotations)

    def get_protein_ids(self) -> list[str]:
        """Get list of all protein IDs."""
        return list(self.data.get("protein_data", {}).keys())

    def get_projection_data(self, projection_name: str) -> list[dict[str, Any]]:
        """Get projection data as a list of dicts."""
        for proj in self.data.get("projections", []):
            if proj["name"] == projection_name:
                return proj.get("data", [])
        raise ValueError(f"Projection {projection_name} not found")

    def get_projection_info(self, projection_name: str) -> dict[str, Any]:
        """Get projection info as a list of dicts."""
        for proj in self.data.get("projections", []):
            if proj["name"] == projection_name:
                result = {"dimensions": proj.get("dimensions")}
                if "info" in proj:
                    result["info"] = proj["info"]
                return result
        raise ValueError(f"Projection {projection_name} not found")

    def get_protein_annotations(self, protein_id: str) -> dict[str, Any]:
        """Get protein annotations as a list of dicts."""
        return (
            self.data.get("protein_data", {}).get(protein_id, {}).get("annotations", {})
        )

    def get_annotation_colors(self, annotation: str) -> dict[str, str]:
        """Get annotation colors from visualization state."""
        return (
            self.data.get("visualization_state", {})
            .get("annotation_colors", {})
            .get(annotation, {})
        )

    def get_marker_shape(self, annotation: str) -> dict[str, str]:
        """Get marker shapes from visualization state."""
        return (
            self.data.get("visualization_state", {})
            .get("marker_shapes", {})
            .get(annotation, {})
        )

    def get_unique_annotation_values(self, annotation: str) -> list[Any]:
        """Get a list of unique values for a given annotation.

        Absent values are skipped, and ``""`` counts as absent: a v3 container
        spells a missing categorical cell as the empty string (a documented
        ``decode_v3`` non-identity), so keeping it would add an empty bucket to
        every column that has any missing value -- 427 of them on
        ``venom_eat_stats``'s ``ec__pred_value`` alone, which nothing filters out
        of the annotation list.
        """
        unique_values = set()
        for protein_data in self.data.get("protein_data", {}).values():
            value = protein_data.get("annotations", {}).get(annotation)
            if value is not None and value != "":
                unique_values.add(value)
        return list(unique_values)

    def get_all_annotation_values(self, annotation: str) -> list[Any]:
        """Get a list of all values for a given annotation."""
        all_values = []
        protein_ids = self.get_protein_ids()
        for protein_id in protein_ids:
            all_values.append(
                self.get_protein_annotations(protein_id).get(annotation, None)
            )
        return all_values

    def update_annotation_color(self, annotation: str, value: str, color: str):
        """Update annotation color in visualization state."""
        if "visualization_state" not in self.data:
            self.data["visualization_state"] = {}
        if "annotation_colors" not in self.data["visualization_state"]:
            self.data["visualization_state"]["annotation_colors"] = {}
        if annotation not in self.data["visualization_state"]["annotation_colors"]:
            self.data["visualization_state"]["annotation_colors"][annotation] = {}

        self.data["visualization_state"]["annotation_colors"][annotation][value] = color

    def update_marker_shape(self, annotation: str, value: str, shape: str):
        """Update marker shape in visualization state."""
        if "visualization_state" not in self.data:
            self.data["visualization_state"] = {}
        if "marker_shapes" not in self.data["visualization_state"]:
            self.data["visualization_state"]["marker_shapes"] = {}
        if annotation not in self.data["visualization_state"]["marker_shapes"]:
            self.data["visualization_state"]["marker_shapes"][annotation] = {}

        self.data["visualization_state"]["marker_shapes"][annotation][value] = shape

    def get_data(self) -> dict[str, Any]:
        """Return the current data."""
        return self.data
