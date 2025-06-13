import dash_daq as daq
from dash import dcc, html
from dash_bio import NglMoleculeViewer
from dash_iconify import DashIconify

from .config import MARKER_SHAPES, MARKER_SHAPES_2D
from .data_loader import JsonReader
from .layout_help import create_help_menu


def create_layout(app):
    """Create the layout for the Dash application."""

    # Get default data if available
    default_json_data = app.get_default_json_data()
    if default_json_data:
        reader = JsonReader(default_json_data)
        features = sorted(reader.get_all_features())
        projections = sorted(reader.get_projection_names())
        protein_ids = sorted(reader.get_protein_ids())

        feature_options = [{"label": feature, "value": feature} for feature in features]
        projection_options = [{"label": proj, "value": proj} for proj in projections]
        protein_options = [{"label": pid, "value": pid} for pid in protein_ids]

        # Select the first feature and projection
        first_feature = features[0] if features else None
        first_projection = projections[0] if projections else None

        projection_info = reader.get_projection_info(first_projection)
        is_3d = projection_info["dimensions"] == 3
        marker_shapes = MARKER_SHAPES if is_3d else MARKER_SHAPES_2D
    else:
        feature_options = []
        projection_options = []
        protein_options = []
        first_feature = None
        first_projection = None
        marker_shapes = MARKER_SHAPES

    # Get PDB files data if available
    pdb_files_data = app.get_pdb_files_data()

    common_layout = [
        html.Div(
            [
                # Left: Rostlab logo
                html.A(
                    html.Img(
                        src="assets/Helix simple flat.png",
                        style={
                            "height": "60px",  # Maintain consistent height with GitHub icon
                            "width": "auto",  # Maintain aspect ratio
                            "cursor": "pointer",
                        },
                    ),
                    href="https://rostlab.org",
                    target="_blank",
                    title="Visit Rostlab",
                ),
                # Center: ProtSpace title
                html.H1(
                    "ProtSpace",
                    style={
                        "margin": "0",
                        "padding": "10px 0",
                        "flexGrow": "0",
                    },
                ),
                # Right: GitHub link
                html.A(
                    html.Button(
                        DashIconify(
                            icon="mdi:github",
                            width=50,
                            height=50,
                        ),
                        title="GitHub Repository",
                        style={
                            "background": "none",
                            "border": "none",
                            "cursor": "pointer",
                            "padding": "0",
                        },
                    ),
                    href="https://github.com/tsenoner/protspace",
                    target="_blank",
                ),
            ],
            style={
                "display": "flex",
                "justifyContent": "space-between",
                "alignItems": "center",
            },
        ),
        # html.H1(
        #     "ProtSpace",
        #     style={"textAlign": "center", "margin": "0", "padding": "10px 0"},
        # ),
        html.Div(
            [
                html.Div(
                    [
                        dcc.Dropdown(
                            id="feature-dropdown",
                            options=feature_options,
                            value=first_feature,
                            placeholder="Select a feature",
                            style={
                                "width": "200px",
                                "marginRight": "10px",
                                "minWidth": "150px",
                            },
                        ),
                        dcc.Dropdown(
                            id="projection-dropdown",
                            options=projection_options,
                            value=first_projection,
                            placeholder="Select a projection",
                            style={
                                "width": "200px",
                                "marginRight": "10px",
                                "minWidth": "150px",
                            },
                        ),
                        dcc.Dropdown(
                            id="protein-search-dropdown",
                            options=protein_options,
                            placeholder="Search for protein identifiers",
                            multi=True,
                            style={
                                "flexGrow": "1",
                                "marginRight": "10px",
                                "minWidth": "150px",
                            },
                        ),
                    ],
                    style={
                        "display": "flex",
                        "flexGrow": "1",
                        "flexWrap": "nowrap",
                        "alignItems": "center",
                    },
                ),
                html.Div(
                    [
                        html.Button(
                            DashIconify(
                                icon="material-symbols:help-outline",
                                width=24,
                                height=24,
                            ),
                            id="help-button",
                            title="Help",
                            style={"marginLeft": "5px"},
                        ),
                        html.Button(
                            DashIconify(
                                icon="material-symbols:download",
                                width=24,
                                height=24,
                            ),
                            id="download-json-button",
                            title="Download JSON",
                            style={"marginLeft": "5px"},
                        ),
                        dcc.Download(id="download-json"),
                        dcc.Upload(
                            id="upload-json",
                            children=html.Button(
                                DashIconify(
                                    icon="material-symbols:upload",
                                    width=24,
                                    height=24,
                                ),
                                title="Upload JSON",
                                style={"marginLeft": "5px"},
                            ),
                            multiple=False,
                        ),
                        dcc.Upload(
                            id="upload-pdb-zip",
                            children=html.Button(
                                DashIconify(
                                    icon="fa6-solid:file-zipper",
                                    width=24,
                                    height=24,
                                ),
                                title="Upload PDB ZIP",
                                style={"marginLeft": "5px"},
                            ),
                            multiple=False,
                        ),
                        html.Button(
                            DashIconify(icon="carbon:settings", width=24, height=24),
                            id="settings-button",
                            title="Settings",
                            style={"marginLeft": "5px"},
                        ),
                    ],
                    style={
                        "display": "flex",
                        "flexWrap": "nowrap",
                        "alignItems": "center",
                    },
                ),
            ],
            style={
                "display": "flex",
                "flexWrap": "nowrap",
                "alignItems": "center",
                "marginBottom": "10px",
            },
        ),
        html.Div(
            [
                html.Div(
                    id="left-panel",
                    style={"width": "100%", "display": "inline-block"},
                    children=[
                        html.Div(
                            [
                                dcc.Graph(
                                    id="scatter-plot",
                                    style={"height": "100%"},
                                    responsive=True,
                                )
                            ],
                            id="scatter-plot-div",
                            style={
                                "border": "2px solid #dddddd",
                                "height": "calc(100vh - 200px)",
                                "width": "100%",
                                "display": "inline-block",
                                "verticalAlign": "top",
                            },
                        ),
                        html.Div(
                            [
                                NglMoleculeViewer(
                                    id="ngl-molecule-viewer",
                                    width="100%",
                                    height="calc(100vh - 200px)",
                                    molStyles={
                                        "representations": ["cartoon"],
                                        "chosenAtomsColor": "white",
                                        "chosenAtomsRadius": 0.5,
                                        "molSpacingXaxis": 50,
                                        "sideByside": True,
                                    },
                                ),
                            ],
                            id="ngl-viewer-div",
                            style={
                                "border": "2px solid #dddddd",
                                "height": "calc(100vh - 200px)",
                                "display": "none",
                                "verticalAlign": "top",
                            },
                        ),
                    ],
                ),
                # Hidden div to contain the marker style controller
                html.Div(
                    [
                        html.Div(
                            [
                                html.H3("Marker Style"),
                                html.Label("Select a value:"),
                                dcc.Dropdown(
                                    id="feature-value-dropdown",
                                    style={"marginBottom": "10px"},
                                ),
                                html.Label("Select a color:"),
                                daq.ColorPicker(
                                    id="marker-color-picker",
                                    size=150,
                                    style={"marginBottom": "10px"},
                                ),
                                html.Label("Select a shape:"),
                                dcc.Dropdown(
                                    id="marker-shape-dropdown",
                                    options=[
                                        {"label": shape, "value": shape}
                                        for shape in marker_shapes
                                    ],
                                    style={"marginBottom": "20px"},
                                ),
                                html.Button(
                                    "Apply Style",
                                    id="apply-style-button",
                                    style={"marginTop": "10px"},
                                ),
                            ],
                        ),
                    ],
                    id="marker-style-controller",
                    style={
                        "display": "none",
                        "width": "20%",
                        "padding": "20px",
                        "backgroundColor": "#f0f0f0",
                        "borderRadius": "5px",
                        "verticalAlign": "top",
                    },
                ),
            ],
            style={"display": "flex"},
        ),
        html.Div(
            id="download-settings",
            style={
                "marginTop": "10px",
                "display": "flex",
                "alignItems": "center",
                "gap": "10px",
            },
            children=[
                html.Label("Download Plot:", style={"fontWeight": "bold"}),
                html.Label("Size:"),
                dcc.Input(
                    id="image-width",
                    type="number",
                    placeholder="Width",
                    value=1600,
                    style={"width": "80px"},
                ),
                dcc.Input(
                    id="image-height",
                    type="number",
                    placeholder="Height",
                    value=1000,
                    style={"width": "80px"},
                ),
                html.Label("Format:"),
                dcc.Dropdown(
                    id="download-format-dropdown",
                    options=[
                        {"label": "SVG", "value": "svg"},
                        {"label": "PNG", "value": "png"},
                        {"label": "HTML", "value": "html"},
                    ],
                    value="svg",
                    clearable=False,
                    style={"width": "100px"},
                    className="drop-up",
                ),
                html.Button("Download", id="download-button"),
                dcc.Download(id="download-plot"),
                html.Label("Marker Size:"),
                dcc.Input(
                    id="marker-size-input",
                    type="number",
                    placeholder="Size",
                    value=10,
                    min=1,
                    max=30,
                    style={"width": "80px"},
                ),
            ],
        ),
        dcc.Store(id="json-data-store", data=default_json_data),
        dcc.Store(id="pdb-files-store", data=pdb_files_data),
        html.Div(
            id="help-menu", style={"display": "none"}, children=create_help_menu()
        ),
    ]

    return html.Div(common_layout, style={"padding": "20px"})
