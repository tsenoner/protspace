import dash_daq as daq
import dash_bootstrap_components as dbc
from dash import dcc, html
import dash_molstar
from dash_iconify import DashIconify
import importlib.resources

from protspace import styles
from protspace.config import MARKER_SHAPES_2D, MARKER_SHAPES_3D
from protspace.utils import JsonReader


def _create_header():
    """Create the header section of the app."""
    return html.Div(
        [
            html.A(
                html.Img(src="assets/rostlab_logo.png", style=styles.HEADER_LOGO_STYLE),
                href="https://www.cs.cit.tum.de/bio/home/",
                target="_blank",
                title="Visit Rostlab",
            ),
            html.H1("ProtSpace", style=styles.HEADER_TITLE_STYLE),
            html.A(
                html.Button(
                    DashIconify(icon="mdi:github", width=50, height=50),
                    title="GitHub Repository",
                    style=styles.HEADER_GITHUB_BUTTON_STYLE,
                ),
                href="https://github.com/tsenoner/protspace",
                target="_blank",
            ),
        ],
        style=styles.HEADER_CONTAINER_STYLE,
    )


def _create_control_bar(
    feature_options,
    first_feature,
    projection_options,
    first_projection,
    protein_options,
):
    """Create the control bar with dropdowns and utility buttons."""
    return html.Div(
        [
            html.Div(
                [
                    dcc.Dropdown(
                        id="feature-dropdown",
                        options=feature_options,
                        value=first_feature,
                        placeholder="Select a feature",
                        style=styles.DROPDOWN_STYLE,
                    ),
                    dcc.Dropdown(
                        id="projection-dropdown",
                        options=projection_options,
                        value=first_projection,
                        placeholder="Select a projection",
                        style=styles.DROPDOWN_STYLE,
                    ),
                    dcc.Dropdown(
                        id="protein-search-dropdown",
                        options=protein_options,
                        placeholder="Search for protein identifiers",
                        multi=True,
                        style=styles.PROTEIN_SEARCH_DROPDOWN_STYLE,
                    ),
                ],
                style=styles.DROPDOWNS_CONTAINER_STYLE,
            ),
            html.Div(
                [
                    html.Button(
                        DashIconify(
                            icon="material-symbols:help-outline", width=24, height=24
                        ),
                        id="help-button",
                        title="Help",
                        style=styles.UTILITY_BUTTON_STYLE,
                    ),
                    html.Button(
                        DashIconify(
                            icon="material-symbols:download", width=24, height=24
                        ),
                        id="download-json-button",
                        title="Download JSON",
                        style=styles.UTILITY_BUTTON_STYLE,
                    ),
                    dcc.Download(id="download-json"),
                    dcc.Upload(
                        id="upload-json",
                        children=html.Button(
                            DashIconify(
                                icon="material-symbols:upload", width=24, height=24
                            ),
                            title="Upload JSON",
                            style=styles.UTILITY_BUTTON_STYLE,
                        ),
                        multiple=False,
                    ),
                    dcc.Upload(
                        id="upload-pdb-zip",
                        children=html.Button(
                            DashIconify(
                                icon="fa6-solid:file-zipper", width=24, height=24
                            ),
                            title="Upload PDB ZIP",
                            style=styles.UTILITY_BUTTON_STYLE,
                        ),
                        multiple=False,
                    ),
                    html.Button(
                        DashIconify(icon="carbon:settings", width=24, height=24),
                        id="settings-button",
                        title="Settings",
                        style=styles.UTILITY_BUTTON_STYLE,
                    ),
                ],
                style=styles.UTILITIES_CONTAINER_STYLE,
            ),
        ],
        style=styles.CONTROL_BAR_STYLE,
    )


def _create_main_view(marker_shapes):
    """Create the main view with plot, 3D viewer, and side panels."""
    return html.Div(
        [
            html.Div(
                id="left-panel",
                style=styles.LEFT_PANEL_STYLE,
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
                        style=styles.SCATTER_PLOT_DIV_STYLE,
                    ),
                    html.Div(
                        [
                            dash_molstar.MolstarViewer(
                                id="molstar-viewer",
                                style={
                                    "width": "100%",
                                    "height": "calc(100vh - 200px)",
                                },
                            ),
                        ],
                        id="molstar-viewer-div",
                        style=styles.MOLSTAR_VIEWER_DIV_STYLE,
                    ),
                ],
            ),
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
                                size=200,
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
                style=styles.MARKER_STYLE_CONTROLLER_STYLE,
            ),
            html.Div(
                id="help-menu",
                style=styles.HELP_MENU_STYLE,
                children=_create_help_menu(),
            ),
        ],
        style=styles.MAIN_VIEW_CONTAINER_STYLE,
    )


def _create_download_bar():
    """Create the download settings bar."""
    return html.Div(
        id="download-settings",
        style=styles.DOWNLOAD_SETTINGS_STYLE,
        children=[
            html.Label("Download Plot:", style={"fontWeight": "bold"}),
            html.Label("Size:"),
            dcc.Input(
                id="image-width",
                type="number",
                placeholder="Width",
                value=1600,
                style=styles.DOWNLOAD_INPUT_STYLE,
            ),
            dcc.Input(
                id="image-height",
                type="number",
                placeholder="Height",
                value=1000,
                style=styles.DOWNLOAD_INPUT_STYLE,
            ),
            html.Label("Format:"),
            html.Div(
                dcc.Dropdown(
                    id="download-format-dropdown",
                    options=[
                        {"label": "SVG", "value": "svg"},
                        {"label": "PNG", "value": "png"},
                        {"label": "JPEG", "value": "jpeg"},
                        {"label": "WEBP", "value": "webp"},
                        {"label": "PDF", "value": "pdf"},
                        {"label": "HTML", "value": "html"},
                        {"label": "JSON", "value": "json"},
                    ],
                    value="svg",
                    clearable=False,
                    style=styles.DOWNLOAD_DROPDOWN_STYLE,
                ),
                className="drop-up",
            ),
            html.Button("Download", id="download-button"),
            dcc.Download(id="download-plot"),
            html.Label("Marker Size:", style=styles.DOWNLOAD_LABEL_STYLE),
            dcc.Input(
                id="marker-size-input",
                type="number",
                value=10,
                min=1,
                max=100,
                step=1,
                style=styles.DOWNLOAD_INPUT_WITH_MARGIN_STYLE,
            ),
            html.Label("Legend Size:", style=styles.DOWNLOAD_LABEL_STYLE),
            dcc.Input(
                id="legend-marker-size-input",
                type="number",
                value=12,
                min=1,
                max=100,
                step=1,
                style=styles.DOWNLOAD_INPUT_STYLE,
            ),
        ],
    )


def create_layout(app):
    """Create the layout for the Dash application."""
    default_json_data = app.get_default_json_data()
    pdb_files_data = app.get_pdb_files_data()

    if default_json_data:
        reader = JsonReader(default_json_data)
        features = sorted(reader.get_all_features())
        projections = sorted(reader.get_projection_names())
        protein_ids = sorted(reader.get_protein_ids())

        feature_options = [{"label": feature, "value": feature} for feature in features]
        projection_options = [{"label": proj, "value": proj} for proj in projections]
        protein_options = [{"label": pid, "value": pid} for pid in protein_ids]

        first_feature = features[0] if features else None
        first_projection = projections[0] if projections else None

        projection_info = reader.get_projection_info(first_projection)
        is_3d = projection_info["dimensions"] == 3
        marker_shapes = MARKER_SHAPES_3D if is_3d else MARKER_SHAPES_2D
    else:
        feature_options, projection_options, protein_options = [], [], []
        first_feature, first_projection = None, None
        marker_shapes = MARKER_SHAPES_2D

    layout_components = [
        _create_header(),
        _create_control_bar(
            feature_options,
            first_feature,
            projection_options,
            first_projection,
            protein_options,
        ),
        _create_main_view(marker_shapes),
        _create_download_bar(),
        dcc.Store(id="json-data-store", data=default_json_data),
        dcc.Store(id="pdb-files-store", data=pdb_files_data),
    ]

    return html.Div(layout_components, style=styles.BASE_STYLE)


def _create_help_menu():
    """Create the help menu with content loaded from Markdown files."""

    def _load_md(file, with_image=False):
        try:
            with (
                importlib.resources.files("protspace.assets.help_content")
                .joinpath(file)
                .open("r") as f
            ):
                content = dcc.Markdown(f.read(), dangerously_allow_html=True)
                if with_image:
                    return html.Div(
                        [
                            html.Img(
                                src="assets/annotated_image.png",
                                style={
                                    "width": "100%",
                                    "height": "auto",
                                    "marginBottom": "20px",
                                },
                            ),
                            content,
                        ]
                    )
                return content
        except FileNotFoundError:
            return f"Error: {file} not found."

    return html.Div(
        [
            html.H3(
                "ProtSpace Help Guide",
                style={"textAlign": "center", "marginBottom": "20px"},
            ),
            dbc.Tabs(
                [
                    dbc.Tab(
                        _load_md("help_overview.md", with_image=True),
                        label="Interface Overview",
                    ),
                    dbc.Tab(_load_md("help_json.md"), label="JSON File Structure"),
                    dbc.Tab(_load_md("help_how_it_works.md"), label="How it works"),
                    dbc.Tab(_load_md("help_faq.md"), label="FAQ"),
                ]
            ),
        ],
        className="help-menu-container",
    )
