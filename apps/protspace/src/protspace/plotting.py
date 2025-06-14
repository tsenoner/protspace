import io
import re
from typing import Any, Dict, List, Optional

import pandas as pd
import plotly.express as px
import plotly.graph_objs as go

from .config import (
    DEFAULT_LINE_WIDTH,
    HIGHLIGHT_BORDER_COLOR,
    HIGHLIGHT_COLOR,
    HIGHLIGHT_LINE_WIDTH,
    HIGHLIGHT_MARKER_SIZE,
    MARKER_SHAPES_3D,
    NAN_COLOR,
)
from .data_loader import JsonReader
from .data_processing import prepare_dataframe


def natural_sort_key(text):
    """
    Create a key function for sorting strings containing numbers in a natural way.
    For example: ['a1', 'a10', 'a2'] will sort as ['a1', 'a2', 'a10']
    """

    def convert(text):
        return int(text) if text.isdigit() else text.lower()

    return [convert(c) for c in re.split("([0-9]+)", text)]


def create_plot(
    reader: "JsonReader",
    selected_projection: str,
    selected_feature: str,
    selected_proteins: Optional[List[str]] = None,
    marker_size: int = 10,
    legend_marker_size: int = 12,
):
    df = prepare_dataframe(reader, selected_projection, selected_feature)

    projection_info = reader.get_projection_info(selected_projection)
    is_3d = projection_info["dimensions"] == 3
    scatter_class = go.Scatter3d if is_3d else go.Scatter

    feature_colors = reader.get_feature_colors(selected_feature).copy()
    feature_colors["<NaN>"] = NAN_COLOR
    marker_shapes = reader.get_marker_shape(selected_feature).copy()
    if "<NaN>" not in marker_shapes:
        marker_shapes["<NaN>"] = "circle"

    # Always define shapes to avoid plotly's automatic shape cycling
    all_values = df[selected_feature].unique()
    final_marker_shapes = {val: marker_shapes.get(val, "circle") for val in all_values}

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

    # Add invisible traces for legend with larger markers
    sorted_unique_values = sorted(df[selected_feature].unique(), key=natural_sort_key)
    for value in sorted_unique_values:
        shape = final_marker_shapes.get(value, "circle")
        if is_3d and shape not in MARKER_SHAPES_3D:
            shape = "circle"

        marker_style = {
            "size": legend_marker_size,
            "line": dict(width=DEFAULT_LINE_WIDTH, color="black"),
        }
        if value in feature_colors:
            marker_style["color"] = feature_colors[value]

        marker_style["symbol"] = shape

        trace_params = dict(
            x=[None],
            y=[None],
            mode="markers",
            name=str(value),
            marker=marker_style,
            legendgroup=str(value),
            showlegend=True,
        )
        if is_3d:
            trace_params["z"] = [None]
        fig.add_trace(scatter_class(**trace_params))

    # Highlight selected proteins
    if selected_proteins:
        selected_df = df[df["identifier"].isin(selected_proteins)]
        highlight_params = dict(
            x=selected_df["x"],
            y=selected_df["y"],
            mode="markers",
            marker=dict(
                size=HIGHLIGHT_MARKER_SIZE,
                color=HIGHLIGHT_COLOR,
                line=dict(width=HIGHLIGHT_LINE_WIDTH, color=HIGHLIGHT_BORDER_COLOR),
            ),
            hoverinfo="skip",
            showlegend=False,
        )
        if is_3d:
            highlight_params["z"] = selected_df["z"]
        fig.add_trace(scatter_class(**highlight_params))

    # -- Add layout --
    layout_args = {
        "plot_bgcolor": "white",
        "margin": dict(l=0, r=0, t=0, b=0),
        "uirevision": "constant",
        "legend": dict(
            itemwidth=30 + legend_marker_size * 0.9,
            title=selected_feature if selected_feature else None,
            font=dict(size=5 + legend_marker_size * 0.9),
        ),
    }

    if is_3d:
        fig.add_traces(create_bounding_box(df))
        layout_args.update(
            {
                "scene": get_3d_scene_layout(df),
                "scene_camera": dict(eye=dict(x=1.25, y=1.25, z=1.25)),
            }
        )
    else:
        layout_args.update(
            {
                "xaxis": dict(
                    showticklabels=False,
                    showline=False,
                    zeroline=False,
                    showgrid=False,
                    title=None,
                ),
                "yaxis": dict(
                    showticklabels=False,
                    showline=False,
                    zeroline=False,
                    showgrid=False,
                    title=None,
                ),
            }
        )

    fig.update_layout(**layout_args)

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
