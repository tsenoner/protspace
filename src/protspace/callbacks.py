import base64
import io
import json
import zipfile
from pathlib import Path

import dash
import plotly.graph_objs as go
from dash import no_update, dcc
from dash.dependencies import Input, Output, State
from dash.exceptions import PreventUpdate
import pandas as pd

from .data_loader import JsonReader
from .plotting import create_plot, save_plot
from .config import MARKER_SHAPES_2D, MARKER_SHAPES_3D


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
                if file.endswith(".pdb") or file.endswith(".cif"):
                    with z.open(file) as f:
                        pdb_files[file] = f.read()
        return (
            pdb_files,
            f"Successfully extracted {len(pdb_files)} PDB files from {filename}",
        )
    except Exception as e:
        return None, f"Error processing {filename}: {str(e)}"


def setup_callbacks(app):
    @app.callback(
        Output("help-menu", "style"),
        Input("help-button", "n_clicks"),
        State("help-menu", "style"),
    )
    def toggle_help_menu(n_clicks, current_style):
        if n_clicks is None:
            return {"display": "none"}
        if current_style["display"] == "none":
            return {
                "display": "block",
                "width": "100%",  # "300px",
                "padding": "20px",
                "backgroundColor": "#f0f0f0",
                "borderRadius": "5px",
            }
        else:
            return {"display": "none"}

    @app.callback(
        Output("json-data-store", "data", allow_duplicate=True),
        [
            Input("upload-json", "contents"),
            State("upload-json", "filename"),
        ],
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
        [
            Input("upload-pdb-zip", "contents"),
            State("upload-pdb-zip", "filename"),
            State("pdb-files-store", "data"),
        ],
        prevent_initial_call=True,
    )
    def update_pdb_files(contents, filename, pdb_files_store_data):
        if contents is None:
            raise PreventUpdate

        pdb_files, message = parse_zip_contents(contents, filename)
        if pdb_files is None:
            print(message)
            return pdb_files_store_data  # Return previous data

        # Convert PDB files content to base64 strings for storage
        pdb_files_base64 = {
            Path(k).stem.replace(".", "_"): base64.b64encode(v).decode("utf-8")
            for k, v in pdb_files.items()
        }

        # Merge with existing pdb_files_store_data
        if pdb_files_store_data:
            pdb_files_base64.update(pdb_files_store_data)

        return pdb_files_base64

    @app.callback(
        [
            Output("feature-dropdown", "options"),
            Output("feature-dropdown", "value"),
            Output("projection-dropdown", "options"),
            Output("projection-dropdown", "value"),
            Output("protein-search-dropdown", "options"),
        ],
        Input("json-data-store", "data"),
        [
            State("feature-dropdown", "value"),
            State("projection-dropdown", "value"),
        ],
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

        # Preserve selected feature if it's still valid, otherwise select the first one
        feature_value = (
            selected_feature
            if selected_feature in all_features
            else (all_features[0] if all_features else None)
        )

        # Preserve selected projection if it's still valid, otherwise select the first one
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

    @app.callback(
        [
            Output("scatter-plot", "figure"),
            Output("json-data-store", "data", allow_duplicate=True),
        ],
        [
            Input("projection-dropdown", "value"),
            Input("feature-dropdown", "value"),
            Input("protein-search-dropdown", "value"),
            Input("apply-style-button", "n_clicks"),
            Input("marker-size-input", "value"),
        ],
        [
            State("json-data-store", "data"),
            State("feature-value-dropdown", "value"),
            State("marker-color-picker", "value"),
            State("marker-shape-dropdown", "value"),
        ],
        prevent_initial_call=True,
    )
    def update_graph(
        selected_projection,
        selected_feature,
        selected_proteins,
        n_clicks,
        marker_size,
        json_data,
        selected_value,
        selected_color,
        selected_shape,
    ):
        ctx = dash.callback_context
        if (
            not ctx.triggered
            or json_data is None
            or not selected_projection
            or not selected_feature
        ):
            # Return a blank figure and no update to json_data
            fig = go.Figure()
            fig.update_layout(
                xaxis=dict(visible=False),
                yaxis=dict(visible=False),
                plot_bgcolor="white",
                margin=dict(l=0, r=0, t=0, b=0),
            )
            return fig, no_update

        reader = JsonReader(json_data)

        # Initialize json_data_output
        json_data_output = no_update

        trigger_id = ctx.triggered[0]["prop_id"].split(".")[0]

        if trigger_id == "apply-style-button":
            if selected_value:
                if selected_color and "rgb" in selected_color:
                    selected_color_str = "rgba({r}, {g}, {b}, {a})".format(
                        **selected_color["rgb"]
                    )
                    reader.update_feature_color(
                        selected_feature, selected_value, selected_color_str
                    )
                elif selected_color:
                    # Handle cases where color is a string (e.g., from hex)
                    color_val = (
                        selected_color["hex"]
                        if isinstance(selected_color, dict)
                        else selected_color
                    )
                    reader.update_feature_color(
                        selected_feature, selected_value, color_val
                    )

                if selected_shape:
                    reader.update_marker_shape(
                        selected_feature, selected_value, selected_shape
                    )
            # Update the JSON data in the store
            json_data = reader.get_data()
            json_data_output = json_data

        fig, _ = create_plot(
            reader,
            selected_projection,
            selected_feature,
            selected_proteins,
            marker_size,
        )

        return fig, json_data_output

    @app.callback(
        [
            Output("protein-search-dropdown", "value"),
            Output("ngl-molecule-viewer", "data"),
            Output("ngl-viewer-div", "style"),
            Output("scatter-plot-div", "style"),
        ],
        [
            Input("scatter-plot", "clickData"),
            Input("protein-search-dropdown", "value"),
        ],
        State("pdb-files-store", "data"),
        prevent_initial_call=True,
    )
    def update_selected_proteins_and_structure(
        click_data, current_selected_proteins, pdb_files_data
    ):
        ctx = dash.callback_context
        triggered_input = ctx.triggered[0]["prop_id"].split(".")[0]

        # Update `current_selected_proteins` list
        if triggered_input == "scatter-plot":
            if (click_data is None) or ("customdata" not in click_data["points"][0]):
                raise PreventUpdate

            point = click_data["points"][0]
            protein_id = point["customdata"][0]
            if current_selected_proteins and protein_id in current_selected_proteins:
                current_selected_proteins.remove(protein_id)
            else:
                if current_selected_proteins:
                    current_selected_proteins.append(protein_id)
                else:
                    current_selected_proteins = [protein_id]

        if not current_selected_proteins or not pdb_files_data:
            # Hide NGL Viewer and set scatter plot to full width
            scatter_style = {
                "border": "2px solid #dddddd",
                "height": "calc(100vh - 200px)",
                "width": "100%",
                "display": "inline-block",
                "verticalAlign": "top",
            }
            ngl_style = {"display": "none"}
            return current_selected_proteins, no_update, ngl_style, scatter_style

        data_list = []
        for protein_id in current_selected_proteins:
            protein_id_key = protein_id.replace(".", "_")
            if protein_id_key in pdb_files_data:
                pdb_content_base64 = pdb_files_data[protein_id_key]
                pdb_content = base64.b64decode(pdb_content_base64).decode("utf-8")

                data_structure = {
                    "filename": f"{protein_id}.pdb",
                    "ext": "pdb",
                    "selectedValue": protein_id,
                    "chain": "ALL",
                    "aaRange": "ALL",
                    "chosen": {"atoms": "", "residues": ""},
                    "color": "black",
                    "config": {"input": pdb_content, "type": "text/plain"},
                    "uploaded": True,
                    "resetView": True,
                }
                data_list.append(data_structure)
            else:
                print(f"PDB file for protein {protein_id} not found in uploaded files.")

        if data_list:
            # Show NGL Viewer and set scatter plot to half width
            scatter_style = {
                "border": "2px solid #dddddd",
                "height": "calc(100vh - 200px)",
                "width": "49%",
                "display": "inline-block",
                "verticalAlign": "top",
            }
            ngl_style = {
                "border": "2px solid #dddddd",
                "height": "calc(100vh - 200px)",
                "width": "49%",
                "display": "inline-block",
                "verticalAlign": "top",
            }
            return current_selected_proteins, data_list, ngl_style, scatter_style
        else:
            # Hide NGL Viewer and set scatter plot to full width
            scatter_style = {
                "border": "2px solid #dddddd",
                "height": "calc(100vh - 200px)",
                "width": "100%",
                "display": "inline-block",
                "verticalAlign": "top",
            }
            ngl_style = {"display": "none"}
            return current_selected_proteins, [], ngl_style, scatter_style

    @app.callback(
        Output("download-json", "data"),
        Input("download-json-button", "n_clicks"),
        State("json-data-store", "data"),
        prevent_initial_call=True,
    )
    def download_json(n_clicks, json_data):
        if n_clicks == 0 or json_data is None:
            raise PreventUpdate

        return dict(
            content=json.dumps(json_data, indent=2),
            filename="protspace_data.json",
        )

    @app.callback(
        [
            Output("marker-style-controller", "style"),
            Output("left-panel", "style"),
        ],
        Input("settings-button", "n_clicks"),
        State("marker-style-controller", "style"),
    )
    def toggle_marker_style_controller(n_clicks, current_style):
        if n_clicks is None:
            return {"display": "none"}, {"width": "100%"}

        if current_style["display"] == "none":
            return (
                {
                    "display": "inline-block",
                    "width": "20%",
                    "padding": "20px",
                    "backgroundColor": "#f0f0f0",
                    "borderRadius": "5px",
                    "verticalAlign": "top",
                },
                {"width": "80%"},
            )
        else:
            return {"display": "none"}, {"width": "100%"}

    @app.callback(
        Output("feature-value-dropdown", "options"),
        [
            Input("feature-dropdown", "value"),
            State("json-data-store", "data"),
        ],
    )
    def update_feature_value_options(selected_feature, json_data):
        if selected_feature is None or json_data is None:
            return []
        reader = get_reader(json_data)

        # Get unique values and check for NaNs
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
        [
            Input("feature-dropdown", "value"),
            Input("feature-value-dropdown", "value"),
            State("json-data-store", "data"),
        ],
    )
    def update_marker_color_picker(selected_feature, selected_value, json_data):
        if selected_feature is None or selected_value is None or json_data is None:
            raise PreventUpdate

        reader = get_reader(json_data)
        feature_colors = reader.get_feature_colors(selected_feature)
        if selected_value in feature_colors:
            return {"hex": feature_colors[selected_value]}
        else:
            # Default to black
            return {"hex": "#000000"}

    @app.callback(
        Output("marker-shape-dropdown", "value"),
        [
            Input("feature-dropdown", "value"),
            Input("feature-value-dropdown", "value"),
            State("json-data-store", "data"),
        ],
    )
    def update_marker_shape_dropdown(selected_feature, selected_value, json_data):
        if not selected_feature or not selected_value or not json_data:
            return None
        reader = get_reader(json_data)
        return reader.get_marker_shape(selected_feature).get(selected_value, None)

    @app.callback(
        [
            Output("download-format-dropdown", "options"),
            Output("download-format-dropdown", "value"),
        ],
        Input("projection-dropdown", "value"),
        [
            State("json-data-store", "data"),
            State("download-format-dropdown", "value"),
        ],
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
            ]  # Only some formats supported for 3D

        value = (
            current_format
            if current_format in [o["value"] for o in options]
            else options[0]["value"]
        )
        return options, value

    @app.callback(
        Output("download-plot", "data"),
        Input("download-button", "n_clicks"),
        [
            State("scatter-plot", "figure"),
            State("projection-dropdown", "value"),
            State("feature-dropdown", "value"),
            State("image-width", "value"),
            State("image-height", "value"),
            State("download-format-dropdown", "value"),
            State("json-data-store", "data"),
            State("protein-search-dropdown", "value"),
            State("marker-size-input", "value"),
        ],
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

        # For HTML format, create a self-contained HTML file
        if download_format == "html":
            buffer = io.StringIO()
            fig_obj.write_html(buffer)
            return dict(
                content=buffer.getvalue(),
                filename=f"{selected_projection}_{selected_feature}.html",
            )

        # For other formats, use the save_plot function
        return dcc.send_bytes(
            save_plot(fig_obj, is_3d, width, height, download_format),
            f"{selected_projection}_{selected_feature}.{download_format}",
        )

    @app.callback(
        Output("marker-shape-dropdown", "options"),
        Input("projection-dropdown", "value"),
        State("json-data-store", "data"),
    )
    def update_marker_shape_dropdown_options(selected_projection, json_data):
        if not selected_projection or not json_data:
            raise PreventUpdate

        reader = get_reader(json_data)
        projection_info = reader.get_projection_info(selected_projection)
        is_3d = projection_info["dimensions"] == 3

        if is_3d:
            shapes = MARKER_SHAPES_3D
        else:
            shapes = MARKER_SHAPES_2D

        return [{"label": shape, "value": shape} for shape in shapes]
