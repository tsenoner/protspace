import io
import re
from typing import Any, Dict, List, Optional
import colorsys

import pandas as pd
import plotly.express as px
import plotly.graph_objs as go

from protspace.config import (
    DEFAULT_LINE_WIDTH,
    HIGHLIGHT_BORDER_COLOR,
    HIGHLIGHT_COLOR,
    HIGHLIGHT_LINE_WIDTH,
    HIGHLIGHT_MARKER_SIZE,
    MARKER_SHAPES_3D,
    NAN_COLOR,
)
from protspace.utils import JsonReader
from protspace.helpers import standardize_missing


def generate_default_color(index: int, total: int) -> str:
    """Generate a default color for a categorical value."""
    hue = index / total
    rgb = colorsys.hsv_to_rgb(hue, 0.8, 0.8)
    return f"rgba({int(rgb[0] * 255)}, {int(rgb[1] * 255)}, {int(rgb[2] * 255)}, 0.8)"


def prepare_dataframe(
    reader: JsonReader, selected_projection: str, selected_feature: str
) -> pd.DataFrame:
    """Prepare the dataframe for plotting."""
    projection_data = reader.get_projection_data(selected_projection)
    df = pd.DataFrame(projection_data)
    df["x"] = [coord["x"] for coord in df["coordinates"]]
    df["y"] = [coord["y"] for coord in df["coordinates"]]
    if reader.get_projection_info(selected_projection)["dimensions"] == 3:
        df["z"] = [coord["z"] for coord in df["coordinates"]]

    df[selected_feature] = df["identifier"].apply(
        lambda x: reader.get_protein_features(x).get(selected_feature)
    )
    df[selected_feature] = standardize_missing(df[selected_feature])

    if df[selected_feature].dtype in ["float64", "int64"]:
        df[selected_feature] = df[selected_feature].astype(str)

    return df


def natural_sort_key(text):
    """
    Create a key function for sorting strings containing numbers in a natural way.
    For example: ['a1', 'a10', 'a2'] will sort as ['a1', 'a2', 'a10']
    """

    def convert(text):
        return int(text) if text.isdigit() else text.lower()

    return [convert(c) for c in re.split("([0-9]+)", text)]


def _create_base_figure(
    df: pd.DataFrame,
    is_3d: bool,
    selected_feature: str,
    feature_colors: Dict[str, str],
    final_marker_shapes: Dict[str, str],
    marker_size: int,
) -> go.Figure:
    """Creates the base scatter plot figure."""
    plot_args = {
        "data_frame": df,
        "color": selected_feature,
        "color_discrete_map": feature_colors,
        "hover_data": {
            "identifier": True,
            selected_feature: True,
            "x": False,
            "y": False,
        },
        "symbol": selected_feature,
        "symbol_map": final_marker_shapes,
        "category_orders": {
            selected_feature: sorted(
                df[selected_feature].unique(), key=natural_sort_key
            )
        },
    }

    if is_3d:
        plot_args.update(
            {
                "x": "x",
                "y": "y",
                "z": "z",
                "hover_data": {**plot_args["hover_data"], "z": False},
            }
        )
        # Map to valid 3D shapes
        plot_args["symbol_map"] = {
            key: (shape if shape in MARKER_SHAPES_3D else "circle")
            for key, shape in final_marker_shapes.items()
        }
        fig = px.scatter_3d(**plot_args)
        fig.update_traces(marker=dict(size=marker_size / 2))
    else:
        plot_args.update({"x": "x", "y": "y"})
        fig = px.scatter(**plot_args)
        fig.update_traces(marker=dict(size=marker_size))

    # Hide the original legend entries
    fig.update_traces(
        marker_line=dict(width=DEFAULT_LINE_WIDTH, color="black"), showlegend=False
    )
    return fig


def _add_legend_traces(
    fig: go.Figure,
    df: pd.DataFrame,
    is_3d: bool,
    selected_feature: str,
    feature_colors: Dict[str, str],
    final_marker_shapes: Dict[str, str],
    legend_marker_size: int,
):
    """Adds invisible traces to the figure for a custom legend."""
    scatter_class = go.Scatter3d if is_3d else go.Scatter
    sorted_unique_values = sorted(df[selected_feature].unique(), key=natural_sort_key)

    for value in sorted_unique_values:
        shape = final_marker_shapes.get(value, "circle")
        if is_3d and shape not in MARKER_SHAPES_3D:
            shape = "circle"

        marker_style = {
            "size": legend_marker_size,
            "line": dict(width=DEFAULT_LINE_WIDTH, color="black"),
            "symbol": shape,
        }
        if value in feature_colors:
            marker_style["color"] = feature_colors[value]

        trace_params = {
            "x": [None],
            "y": [None],
            "mode": "markers",
            "name": str(value),
            "marker": marker_style,
            "legendgroup": str(value),
            "showlegend": True,
        }
        if is_3d:
            trace_params["z"] = [None]
        fig.add_trace(scatter_class(**trace_params))


def _add_highlight_traces(
    fig: go.Figure, df: pd.DataFrame, is_3d: bool, selected_proteins: List[str]
):
    """Adds highlight traces for selected proteins."""
    if not selected_proteins:
        return

    scatter_class = go.Scatter3d if is_3d else go.Scatter
    selected_df = df[df["identifier"].isin(selected_proteins)]
    highlight_params = {
        "x": selected_df["x"],
        "y": selected_df["y"],
        "mode": "markers",
        "marker": {
            "size": HIGHLIGHT_MARKER_SIZE,
            "color": HIGHLIGHT_COLOR,
            "line": {"width": HIGHLIGHT_LINE_WIDTH, "color": HIGHLIGHT_BORDER_COLOR},
        },
        "hoverinfo": "skip",
        "showlegend": False,
    }
    if is_3d:
        highlight_params["z"] = selected_df["z"]
    fig.add_trace(scatter_class(**highlight_params))


def _configure_layout(
    fig: go.Figure,
    df: pd.DataFrame,
    is_3d: bool,
    selected_feature: str,
    legend_marker_size: int,
):
    """Configures the final layout of the figure."""
    layout_args = {
        "plot_bgcolor": "white",
        "margin": {"l": 0, "r": 0, "t": 0, "b": 0},
        "uirevision": "constant",
        "legend": {
            "itemwidth": 30 + legend_marker_size * 0.9,
            "title": selected_feature or None,
            "font": {"size": 5 + legend_marker_size * 0.9},
        },
    }

    if is_3d:
        fig.add_traces(create_bounding_box(df))
        layout_args.update(
            {
                "scene": get_3d_scene_layout(df),
                "scene_camera": {"eye": {"x": 1.25, "y": 1.25, "z": 1.25}},
            }
        )
    else:
        layout_args.update(
            {
                "xaxis": {
                    "showticklabels": False,
                    "showline": False,
                    "zeroline": False,
                    "showgrid": False,
                    "title": None,
                },
                "yaxis": {
                    "showticklabels": False,
                    "showline": False,
                    "zeroline": False,
                    "showgrid": False,
                    "title": None,
                },
            }
        )
    fig.update_layout(**layout_args)


def create_plot(
    reader: "JsonReader",
    selected_projection: str,
    selected_feature: str,
    selected_proteins: Optional[List[str]] = None,
    marker_size: int = 10,
    legend_marker_size: int = 12,
):
    """Creates a 2D or 3D scatter plot of protein data."""
    df = prepare_dataframe(reader, selected_projection, selected_feature)

    projection_info = reader.get_projection_info(selected_projection)
    is_3d = projection_info["dimensions"] == 3

    # Get existing colors or generate defaults
    feature_colors = reader.get_feature_colors(selected_feature).copy()
    unique_values = sorted(df[selected_feature].unique())

    # Generate default colors for values that don't have one
    for i, value in enumerate(unique_values):
        if str(value) not in feature_colors:
            if value == "<NaN>":
                feature_colors[str(value)] = NAN_COLOR
            else:
                feature_colors[str(value)] = generate_default_color(
                    i, len(unique_values)
                )

    # Get existing marker shapes or use defaults
    marker_shapes = reader.get_marker_shape(selected_feature).copy()
    final_marker_shapes = {
        str(val): marker_shapes.get(str(val), "circle") for val in unique_values
    }

    fig = _create_base_figure(
        df, is_3d, selected_feature, feature_colors, final_marker_shapes, marker_size
    )
    _add_legend_traces(
        fig,
        df,
        is_3d,
        selected_feature,
        feature_colors,
        final_marker_shapes,
        legend_marker_size,
    )
    if selected_proteins:
        _add_highlight_traces(fig, df, is_3d, selected_proteins)

    _configure_layout(fig, df, is_3d, selected_feature, legend_marker_size)

    return fig, is_3d


def create_bounding_box(df: pd.DataFrame) -> List[go.Mesh3d]:
    """Create a bounding box for the 3D scatter plot using 3D shapes."""
    bounds = {
        dim: [df[dim].min() * 1.05, df[dim].max() * 1.05] for dim in ["x", "y", "z"]
    }
    x_min, x_max = bounds["x"]
    y_min, y_max = bounds["y"]
    z_min, z_max = bounds["z"]

    # Define the 8 vertices of the box
    vertices = [
        (x_min, y_min, z_min),
        (x_max, y_min, z_min),
        (x_max, y_max, z_min),
        (x_min, y_max, z_min),
        (x_min, y_min, z_max),
        (x_max, y_min, z_max),
        (x_max, y_max, z_max),
        (x_min, y_max, z_max),
    ]

    # Define the 12 edges of the box
    edges = [
        (0, 1),
        (1, 2),
        (2, 3),
        (3, 0),
        (4, 5),
        (5, 6),
        (6, 7),
        (7, 4),
        (0, 4),
        (1, 5),
        (2, 6),
        (3, 7),
    ]

    traces = []
    for start_idx, end_idx in edges:
        x_coords = [vertices[start_idx][0], vertices[end_idx][0]]
        y_coords = [vertices[start_idx][1], vertices[end_idx][1]]
        z_coords = [vertices[start_idx][2], vertices[end_idx][2]]

        traces.append(
            go.Scatter3d(
                x=x_coords,
                y=y_coords,
                z=z_coords,
                mode="lines",
                line=dict(color="black", width=3),
                hoverinfo="none",
                showlegend=False,
            )
        )
    return traces


def get_3d_scene_layout(df: pd.DataFrame) -> Dict[str, Any]:
    """Define the layout for the 3D scene."""
    axis_layout = dict(
        showbackground=False,
        showticklabels=False,
        showline=False,
        zeroline=False,
        showgrid=False,
        showspikes=False,
        title="",
    )
    return {
        "xaxis": {
            **axis_layout,
            "range": [df["x"].min() * 1.05, df["x"].max() * 1.05],
        },
        "yaxis": {
            **axis_layout,
            "range": [df["y"].min() * 1.05, df["y"].max() * 1.05],
        },
        "zaxis": {
            **axis_layout,
            "range": [df["z"].min() * 1.05, df["z"].max() * 1.05],
        },
        "aspectratio": {"x": 1, "y": 1, "z": 1},
        "bgcolor": "rgba(240, 240, 240, 0.95)",
    }


def save_plot(
    fig: go.Figure,
    is_3d: bool,
    width: Optional[int] = None,
    height: Optional[int] = None,
    file_format: str = "svg",
) -> bytes:
    """Generate image bytes for the plot."""
    if not is_3d and (width is None or height is None):
        raise ValueError("Width and height must be provided for 2D plots")

    # For both 2D and 3D, write to an in-memory buffer
    buffer = io.BytesIO()
    fig.write_image(buffer, format=file_format, width=width, height=height)
    return buffer.getvalue()


def get_reader(json_data):
    return JsonReader(json_data)
