from typing import Any


class JsonReader:
    """A class to read and manipulate JSON data for ProtSpace."""

    def __init__(self, json_data: dict[str, Any]):
        self.data = json_data

    def get_projection_names(self) -> list[str]:
        return [proj["name"] for proj in self.data.get("projections", [])]

    def get_all_annotations(self) -> list[str]:
        annotations = set()
        for protein_data in self.data.get("protein_data", {}).values():
            annotations.update(protein_data.get("annotations", {}).keys())
        return list(annotations)

    def get_protein_ids(self) -> list[str]:
        return list(self.data.get("protein_data", {}).keys())

    def get_projection_data(self, projection_name: str) -> list[dict[str, Any]]:
        for proj in self.data.get("projections", []):
            if proj["name"] == projection_name:
                return proj.get("data", [])
        raise ValueError(f"Projection {projection_name} not found")

    def get_projection_info(self, projection_name: str) -> dict[str, Any]:
        for proj in self.data.get("projections", []):
            if proj["name"] == projection_name:
                result = {"dimensions": proj.get("dimensions")}
                if "info" in proj:
                    result["info"] = proj["info"]
                return result
        raise ValueError(f"Projection {projection_name} not found")

    def get_protein_annotations(self, protein_id: str) -> dict[str, Any]:
        return (
            self.data.get("protein_data", {}).get(protein_id, {}).get("annotations", {})
        )

    def get_annotation_colors(self, annotation: str) -> dict[str, str]:
        return (
            self.data.get("visualization_state", {})
            .get("annotation_colors", {})
            .get(annotation, {})
        )

    def get_marker_shape(self, annotation: str) -> dict[str, str]:
        return (
            self.data.get("visualization_state", {})
            .get("marker_shapes", {})
            .get(annotation, {})
        )

    def get_unique_annotation_values(self, annotation: str) -> list[Any]:
        """Get a list of unique values for a given annotation."""
        unique_values = set()
        for protein_data in self.data.get("protein_data", {}).values():
            value = protein_data.get("annotations", {}).get(annotation)
            if value is not None:
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
        if "visualization_state" not in self.data:
            self.data["visualization_state"] = {}
        if "annotation_colors" not in self.data["visualization_state"]:
            self.data["visualization_state"]["annotation_colors"] = {}
        if annotation not in self.data["visualization_state"]["annotation_colors"]:
            self.data["visualization_state"]["annotation_colors"][annotation] = {}

        self.data["visualization_state"]["annotation_colors"][annotation][value] = color

    def update_marker_shape(self, annotation: str, value: str, shape: str):
        if "visualization_state" not in self.data:
            self.data["visualization_state"] = {}
        if "marker_shapes" not in self.data["visualization_state"]:
            self.data["visualization_state"]["marker_shapes"] = {}
        if annotation not in self.data["visualization_state"]["marker_shapes"]:
            self.data["visualization_state"]["marker_shapes"][annotation] = {}

        self.data["visualization_state"]["marker_shapes"][annotation][value] = shape

    def get_data(self) -> dict[str, Any]:
        """Return the current JSON data."""
        return self.data
