import base64
import io
import json
import zipfile
from pathlib import Path
import re

import dash
import pandas as pd
import plotly.graph_objs as go
from dash import Input, Output, State, dcc, no_update
from dash.exceptions import PreventUpdate

from protspace import styles
from protspace.config import (
    HELP_PANEL_WIDTH_PERCENT,
    MARKER_SHAPES_2D,
    MARKER_SHAPES_3D,
    SETTINGS_PANEL_WIDTH_PERCENT,
    NAN_COLOR,
)
from protspace.helpers import is_projection_3d
from protspace.molstar_helper import get_molstar_data
from protspace.utils import JsonReader
from protspace.visualization.plotting import (
    create_plot,
    generate_default_color,
    save_plot,
)


def get_reader(json_data):
    """Helper function to get JsonReader instance."""
    if json_data:
        return JsonReader(json_data)
    else:
        return None


def parse_zip_contents(contents, filename):
    content_type, content_string = contents.split(",")
    decoded = base64.b64decode(content_string)
    pdb_files = {}
    try:
        with zipfile.ZipFile(io.BytesIO(decoded)) as z:
            for file in z.namelist():
                if file.endswith((".pdb", ".cif")):
                    with z.open(file) as f:
                        pdb_files[file] = f.read()
        return (
            pdb_files,
            f"Successfully extracted {len(pdb_files)} PDB files from {filename}",
        )
    except Exception as e:
        return None, f"Error processing {filename}: {str(e)}"


def create_side_panel_callback(app, button_id, panel_id, panel_width_percent):
    """Factory to create a callback for a side panel."""

    @app.callback(
        [
            Output(panel_id, "style"),
            Output("left-panel", "style", allow_duplicate=True),
        ],
        Input(button_id, "n_clicks"),
        [
            State(panel_id, "style"),
            State("left-panel", "style"),
        ],
        prevent_initial_call=True,
    )
    def toggle_panel(n_clicks, panel_style, left_panel_style):
        if n_clicks is None:
            raise PreventUpdate

        is_hidden = panel_style.get("display") == "none"
        new_panel_style = panel_style.copy()
        new_left_panel_style = left_panel_style.copy()

        if is_hidden:
            new_panel_style["display"] = "inline-block"
            new_left_panel_style["width"] = f"{100 - panel_width_percent}%"
        else:
            new_panel_style["display"] = "none"
            new_left_panel_style["width"] = "100%"

        return new_panel_style, new_left_panel_style


def setup_callbacks(app):
    # Create side panel callbacks
    create_side_panel_callback(
        app, "help-button", "help-menu", HELP_PANEL_WIDTH_PERCENT
    )
    create_side_panel_callback(
        app, "settings-button", "marker-style-controller", SETTINGS_PANEL_WIDTH_PERCENT
    )

    # Data loading callbacks
    @app.callback(
        Output("json-data-store", "data", allow_duplicate=True),
        Input("upload-json", "contents"),
        State("upload-json", "filename"),
        prevent_initial_call=True,
    )
    def update_json_data(contents, filename):
        if contents is None:
            raise PreventUpdate
        content_type, content_string = contents.split(",")
        decoded = base64.b64decode(content_string)
        try:
            if "json" in filename:
                data = json.loads(decoded.decode("utf-8"))
                return data
            else:
                return no_update
        except Exception as e:
            print(f"Error loading JSON: {e}")
            return no_update

    @app.callback(
        Output("pdb-files-store", "data"),
        Input("upload-pdb-zip", "contents"),
        State("upload-pdb-zip", "filename"),
        State("pdb-files-store", "data"),
        prevent_initial_call=True,
    )
    def update_pdb_files(contents, filename, pdb_files_store_data):
        if contents is None:
            raise PreventUpdate
        pdb_files, message = parse_zip_contents(contents, filename)
        if pdb_files is None:
            print(message)
            return pdb_files_store_data

        # Convert PDB files content to base64 strings for storage
        pdb_files_base64 = {}
        for k, v in pdb_files.items():
            p = Path(k)
            stem = p.stem.replace(".", "_")
            ext = p.suffix.lstrip(".")
            pdb_files_base64[stem] = (base64.b64encode(v).decode("utf-8"), ext)

        # Merge with existing pdb_files_store_data
        if pdb_files_store_data:
            pdb_files_base64.update(pdb_files_store_data)
        return pdb_files_base64

    # Dropdown update callbacks
    @app.callback(
        [
            Output("feature-dropdown", "options"),
            Output("feature-dropdown", "value"),
            Output("projection-dropdown", "options"),
            Output("projection-dropdown", "value"),
            Output("protein-search-dropdown", "options"),
        ],
        Input("json-data-store", "data"),
        State("feature-dropdown", "value"),
        State("projection-dropdown", "value"),
    )
    def update_dropdowns(json_data, selected_feature, selected_projection):
        if json_data is None:
            return [], None, [], None, []
        reader = get_reader(json_data)
        all_features = sorted(reader.get_all_features())
        all_projections = sorted(reader.get_projection_names())
        feature_options = [{"label": f, "value": f} for f in all_features]
        projection_options = [{"label": p, "value": p} for p in all_projections]
        protein_options = [
            {"label": pid, "value": pid} for pid in sorted(reader.get_protein_ids())
        ]
        feature_value = (
            selected_feature
            if selected_feature in all_features
            else (all_features[0] if all_features else None)
        )
        projection_value = (
            selected_projection
            if selected_projection in all_projections
            else (all_projections[0] if all_projections else None)
        )
        return (
            feature_options,
            feature_value,
            projection_options,
            projection_value,
            protein_options,
        )

    # Main view callbacks
    @app.callback(
        Output("scatter-plot", "figure"),
        Input("json-data-store", "data"),
        Input("projection-dropdown", "value"),
        Input("feature-dropdown", "value"),
        Input("protein-search-dropdown", "value"),
        Input("marker-size-input", "value"),
        Input("legend-marker-size-input", "value"),
        prevent_initial_call=True,
    )
    def update_graph(
        json_data,
        selected_projection,
        selected_feature,
        selected_proteins,
        marker_size,
        legend_marker_size,
    ):
        if not (json_data and selected_projection and selected_feature):
            fig = go.Figure()
            fig.update_layout(
                xaxis=dict(visible=False),
                yaxis=dict(visible=False),
                plot_bgcolor="white",
                margin=dict(l=0, r=0, t=0, b=0),
            )
            return fig
        reader = JsonReader(json_data)
        fig, _ = create_plot(
            reader,
            selected_projection,
            selected_feature,
            selected_proteins,
            marker_size or 10,
            legend_marker_size or 12,
        )
        return fig

    @app.callback(
        [
            Output("protein-search-dropdown", "value"),
            Output("molstar-viewer", "data"),
            Output("molstar-viewer-div", "style"),
            Output("scatter-plot-div", "style"),
        ],
        Input("scatter-plot", "clickData"),
        Input("protein-search-dropdown", "value"),
        State("pdb-files-store", "data"),
        prevent_initial_call=True,
    )
    def update_selected_proteins_and_structure(
        click_data, current_selected_protein, pdb_files_data
    ):
        ctx = dash.callback_context
        triggered_input = ctx.triggered[0]["prop_id"].split(".")[0]

        # 1. Determine the new selection based on the trigger
        selected_protein_id = None
        if triggered_input == "scatter-plot" and click_data:
            clicked_id = click_data["points"][0].get("customdata", [None])[0]
            if clicked_id:
                # Toggle selection on click
                if current_selected_protein and clicked_id in current_selected_protein:
                    selected_protein_id = None  # Deselect
                else:
                    selected_protein_id = clicked_id  # Select
        elif triggered_input == "protein-search-dropdown":
            if current_selected_protein:
                selected_protein_id = current_selected_protein[-1]

        # 2. Set default outputs
        protein_selection = []
        molstar_data = {}
        scatter_style = styles.SCATTER_PLOT_DIV_STYLE.copy()
        molstar_style = styles.MOLSTAR_VIEWER_DIV_STYLE.copy()
        scatter_style["width"] = "100%"
        molstar_style["display"] = "none"

        # 3. If a protein is selected, update outputs accordingly
        if selected_protein_id:
            protein_selection = [selected_protein_id]
            data = get_molstar_data(selected_protein_id, pdb_files_data)
            if data:
                # If structure data exists, show the viewer
                molstar_data = data
                scatter_style["width"] = "49%"
                molstar_style["display"] = "inline-block"

        return protein_selection, molstar_data, molstar_style, scatter_style

    # Style and settings callbacks
    @app.callback(
        Output("feature-value-dropdown", "options"),
        Input("feature-dropdown", "value"),
        State("json-data-store", "data"),
    )
    def update_feature_value_options(selected_feature, json_data):
        if selected_feature is None or json_data is None:
            return []
        reader = get_reader(json_data)
        all_values = reader.get_all_feature_values(selected_feature)
        unique_values = {v for v in all_values if pd.notna(v)}
        has_nan = any(pd.isna(v) for v in all_values)
        options = [
            {"label": str(val), "value": str(val)}
            for val in sorted(list(unique_values))
        ]
        if has_nan:
            options.append({"label": "<NaN>", "value": "<NaN>"})
        return options

    @app.callback(
        Output("marker-color-picker", "value"),
        Input("feature-dropdown", "value"),
        Input("feature-value-dropdown", "value"),
        State("json-data-store", "data"),
    )
    def update_marker_color_picker(selected_feature, selected_value, json_data):
        if not (selected_feature and selected_value and json_data):
            raise PreventUpdate
        reader = get_reader(json_data)

        # Get all feature values to determine index for default color
        all_values = sorted(reader.get_unique_feature_values(selected_feature))

        # Get existing colors
        feature_colors = reader.get_feature_colors(selected_feature)

        # If the value has a color defined, use it
        if selected_value in feature_colors:
            color = feature_colors[selected_value]
            # If it's an rgba color, convert to hex
            if color.startswith("rgba"):
                # Extract RGB values
                rgba = re.match(r"rgba\((\d+),\s*(\d+),\s*(\d+)", color)
                if rgba:
                    r, g, b = map(int, rgba.groups())
                    hex_color = "#{:02x}{:02x}{:02x}".format(r, g, b)
                    return {"hex": hex_color}
            return {"hex": color}

        # If no color is defined, generate a default one
        if selected_value == "<NaN>":
            return {"hex": NAN_COLOR}
        else:
            try:
                idx = all_values.index(selected_value)
                color = generate_default_color(idx, len(all_values))
                # Convert rgba to hex
                rgba = re.match(r"rgba\((\d+),\s*(\d+),\s*(\d+)", color)
                if rgba:
                    r, g, b = map(int, rgba.groups())
                    hex_color = "#{:02x}{:02x}{:02x}".format(r, g, b)
                    return {"hex": hex_color}
            except ValueError:
                return {"hex": "#000000"}  # Default to black if something goes wrong

    @app.callback(
        Output("marker-shape-dropdown", "value"),
        Input("feature-dropdown", "value"),
        Input("feature-value-dropdown", "value"),
        State("json-data-store", "data"),
    )
    def update_marker_shape_dropdown(selected_feature, selected_value, json_data):
        if not (selected_feature and selected_value and json_data):
            return None
        reader = get_reader(json_data)
        return reader.get_marker_shape(selected_feature).get(selected_value, None)

    @app.callback(
        Output("marker-shape-dropdown", "options"),
        Input("projection-dropdown", "value"),
        State("json-data-store", "data"),
    )
    def update_marker_shape_dropdown_options(selected_projection, json_data):
        reader = get_reader(json_data)
        is_3d = is_projection_3d(reader, selected_projection)
        marker_shapes = MARKER_SHAPES_3D if is_3d else MARKER_SHAPES_2D
        return [{"label": shape, "value": shape} for shape in marker_shapes]

    @app.callback(
        Output("json-data-store", "data", allow_duplicate=True),
        Input("apply-style-button", "n_clicks"),
        State("feature-dropdown", "value"),
        State("json-data-store", "data"),
        State("feature-value-dropdown", "value"),
        State("marker-color-picker", "value"),
        State("marker-shape-dropdown", "value"),
        prevent_initial_call=True,
    )
    def update_styles(
        n_clicks,
        selected_feature,
        json_data,
        selected_value,
        selected_color,
        selected_shape,
    ):
        if n_clicks is None or not selected_value:
            raise PreventUpdate
        reader = JsonReader(json_data)
        if selected_color and "rgb" in selected_color:
            color_str = "rgba({r}, {g}, {b}, {a})".format(**selected_color["rgb"])
            reader.update_feature_color(selected_feature, selected_value, color_str)
        elif selected_color:
            reader.update_feature_color(
                selected_feature,
                selected_value,
                selected_color.get("hex", selected_color),
            )
        if selected_shape:
            reader.update_marker_shape(selected_feature, selected_value, selected_shape)
        return reader.get_data()

    # Download callbacks
    @app.callback(
        Output("download-json", "data"),
        Input("download-json-button", "n_clicks"),
        State("json-data-store", "data"),
        prevent_initial_call=True,
    )
    def download_json(n_clicks, json_data):
        if n_clicks is None or json_data is None:
            raise PreventUpdate
        return dict(
            content=json.dumps(json_data, indent=2), filename="protspace_data.json"
        )

    @app.callback(
        [
            Output("download-format-dropdown", "options"),
            Output("download-format-dropdown", "value"),
        ],
        Input("projection-dropdown", "value"),
        State("json-data-store", "data"),
        State("download-format-dropdown", "value"),
    )
    def update_download_options(selected_projection, json_data, current_format):
        if not selected_projection or not json_data:
            raise PreventUpdate
        reader = get_reader(json_data)
        projection_info = reader.get_projection_info(selected_projection)
        is_3d = projection_info["dimensions"] == 3
        options = [
            {"label": "SVG", "value": "svg"},
            {"label": "PNG", "value": "png"},
            {"label": "JPEG", "value": "jpeg"},
            {"label": "WEBP", "value": "webp"},
            {"label": "PDF", "value": "pdf"},
            {"label": "HTML", "value": "html"},
            {"label": "JSON", "value": "json"},
        ]
        if is_3d:
            options = [
                opt for opt in options if opt["value"] in ["html", "png", "jpeg"]
            ]
        value = (
            current_format
            if current_format in [o["value"] for o in options]
            else options[0]["value"]
        )
        return options, value

    @app.callback(
        Output("download-plot", "data"),
        Input("download-button", "n_clicks"),
        State("scatter-plot", "figure"),
        State("projection-dropdown", "value"),
        State("feature-dropdown", "value"),
        State("image-width", "value"),
        State("image-height", "value"),
        State("download-format-dropdown", "value"),
        State("json-data-store", "data"),
        State("protein-search-dropdown", "value"),
        State("marker-size-input", "value"),
        prevent_initial_call=True,
    )
    def download_plot(
        n_clicks,
        figure,
        selected_projection,
        selected_feature,
        width,
        height,
        download_format,
        json_data,
        selected_proteins,
        marker_size,
    ):
        if n_clicks is None:
            raise PreventUpdate
        reader = JsonReader(json_data)
        is_3d = reader.get_projection_info(selected_projection)["dimensions"] == 3
        fig_obj = go.Figure(figure)
        if download_format == "html":
            buffer = io.StringIO()
            fig_obj.write_html(buffer)
            return dict(
                content=buffer.getvalue(),
                filename=f"{selected_projection}_{selected_feature}.html",
            )
        return dcc.send_bytes(
            save_plot(fig_obj, is_3d, width, height, download_format),
            f"{selected_projection}_{selected_feature}.{download_format}",
        )
