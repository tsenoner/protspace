import io
import re
from typing import Any, Dict, List, Optional

import pandas as pd
import plotly.express as px
import plotly.graph_objs as go
from dash import dcc

from .config import (
    DEFAULT_LINE_WIDTH,
    HIGHLIGHT_BORDER_COLOR,
    HIGHLIGHT_COLOR,
    HIGHLIGHT_LINE_WIDTH,
    HIGHLIGHT_MARKER_SIZE,
    MARKER_SHAPES,
)


def natural_sort_key(text):
    """
    Create a key function for sorting strings containing numbers in a natural way.
    For example: ['a1', 'a10', 'a2'] will sort as ['a1', 'a2', 'a10']
    """

    def convert(text):
        return int(text) if text.isdigit() else text.lower()

    return [convert(c) for c in re.split("([0-9]+)", text)]


def create_styled_plot(
    df,
    reader,
    selected_projection,
    selected_feature,
    selected_proteins=None,
    marker_size=10,
):
    """Create a styled plot with visualization state applied."""
    projection_info = reader.get_projection_info(selected_projection)
    is_3d = projection_info["dimensions"] == 3

    # Create base plot
    fig = (
        create_3d_plot(df, selected_feature, selected_proteins or [], marker_size)
        if is_3d
        else create_2d_plot(df, selected_feature, selected_proteins or [], marker_size)
    )

    # Apply visualization state
    feature_colors = reader.get_feature_colors(selected_feature)
    marker_shapes = reader.get_marker_shape(selected_feature)

    for value in df[selected_feature].unique():
        if str(value) != "<NaN>":
            marker_style = {}
            if value in feature_colors:
                marker_style["color"] = feature_colors[value]
            if value in marker_shapes:
                if (not is_3d) or (is_3d and marker_shapes[value] in MARKER_SHAPES):
                    marker_style["symbol"] = marker_shapes[value]

            if marker_style:
                fig.update_traces(marker=marker_style, selector=dict(name=str(value)))

    return fig, is_3d


def create_2d_plot(
    df: pd.DataFrame,
    selected_feature: str,
    selected_proteins: List[str],
    marker_size: int,
) -> go.Figure:
    """Create a 2D scatter plot."""
    fig = px.scatter(
        df,
        x="x",
        y="y",
        color=selected_feature,
        hover_data={
            "identifier": True,
            selected_feature: True,
            "x": False,
            "y": False,
        },
        category_orders={
            selected_feature: sorted(
                df[selected_feature].unique(), key=natural_sort_key
            )
        },
    )

    fig.update_traces(
        marker=dict(
            size=marker_size,
            line=dict(width=DEFAULT_LINE_WIDTH, color="black"),
        )
    )

    if selected_proteins:
        selected_df = df[df["identifier"].isin(selected_proteins)]
        fig.add_trace(
            go.Scatter(
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
        )

    fig.update_layout(
        xaxis=dict(
            showticklabels=False,
            showline=False,
            zeroline=False,
            showgrid=False,
            title=None,
        ),
        yaxis=dict(
            showticklabels=False,
            showline=False,
            zeroline=False,
            showgrid=False,
            title=None,
        ),
        plot_bgcolor="white",
        margin=dict(l=0, r=0, t=0, b=0),
        uirevision="constant",
    )
    return fig


def create_3d_plot(
    df: pd.DataFrame,
    selected_feature: str,
    selected_proteins: List[str],
    marker_size: int,
) -> go.Figure:
    """Create a 3D scatter plot."""
    fig = px.scatter_3d(
        df,
        x="x",
        y="y",
        z="z",
        color=selected_feature,
        hover_data={
            "identifier": True,
            selected_feature: True,
            "x": False,
            "y": False,
            "z": False,
        },
        category_orders={
            selected_feature: sorted(
                df[selected_feature].unique(), key=natural_sort_key
            )
        },
    )

    fig.update_traces(
        marker=dict(
            size=marker_size / 2,
            line=dict(
                width=DEFAULT_LINE_WIDTH, color="black"
            ),  # "rgba(0, 0, 0, 0.1)"),
        )
    )

    if selected_proteins:
        selected_df = df[df["identifier"].isin(selected_proteins)]
        fig.add_trace(
            go.Scatter3d(
                x=selected_df["x"],
                y=selected_df["y"],
                z=selected_df["z"],
                mode="markers",
                marker=dict(
                    size=HIGHLIGHT_MARKER_SIZE,
                    color=HIGHLIGHT_COLOR,
                    line=dict(width=HIGHLIGHT_LINE_WIDTH, color=HIGHLIGHT_BORDER_COLOR),
                ),
                hoverinfo="skip",
                showlegend=False,
            )
        )

    for trace in create_bounding_box(df):
        fig.add_trace(trace)

    fig.update_layout(
        scene=get_3d_scene_layout(df),
        margin=dict(l=0, r=0, t=0, b=0),
        uirevision="constant",
        scene_camera=dict(eye=dict(x=1.25, y=1.25, z=1.25)),
    )
    return fig


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
    filename: Optional[str] = None,
    force_svg: bool = False,
) -> Optional[Dict]:
    """Save the plot to a file or return it for download."""
    # Convert WebGL traces to their SVG equivalents
    if force_svg and not is_3d:
        # Create a new figure with converted traces
        new_traces = []
        for trace in fig.data:
            trace_dict = trace.to_plotly_json()

            # Convert WebGL traces to their SVG equivalents
            if trace.type == "scattergl":
                trace_dict["type"] = "scatter"

            new_traces.append(trace_dict)

        # Create new figure with converted traces
        fig = go.Figure(data=new_traces, layout=fig.layout)

    if is_3d:
        if filename:
            fig.write_html(filename, include_plotlyjs="cdn")
        else:
            buffer = io.StringIO()
            fig.write_html(buffer, include_plotlyjs="cdn")
            buffer.seek(0)
            return dcc.send_bytes(buffer.getvalue().encode(), "protspace_3d_plot.html")
    else:
        if width is None or height is None:
            raise ValueError("Width and height must be provided for 2D plots")

        # Adjust font size proportionally
        scaling_factor = height / 600
        font_size = max(10, min(12 * scaling_factor, 30))

        # Adjust marker size proportionally
        marker_size = max(5, min(7 * scaling_factor, 20))

        fig.update_layout(
            legend=dict(font=dict(size=font_size)),
        )
        fig.update_traces(marker=dict(size=marker_size))

        if filename:
            fig.write_image(filename, format="svg", width=width, height=height)
        else:
            buffer = io.BytesIO()
            fig.write_image(buffer, format="svg", width=width, height=height)
            buffer.seek(0)
            return dcc.send_bytes(buffer.getvalue(), "protspace_2d_plot.svg")
