"""Centralized styles for the ProtSpace application."""

from protspace.config import HELP_PANEL_WIDTH_PERCENT, SETTINGS_PANEL_WIDTH_PERCENT

# General layout
BASE_STYLE = {
    "padding": "20px",
}

# Header components
HEADER_CONTAINER_STYLE = {
    "display": "flex",
    "justifyContent": "space-between",
    "alignItems": "center",
}
HEADER_LOGO_STYLE = {
    "height": "60px",
    "width": "auto",
    "cursor": "pointer",
}
HEADER_TITLE_STYLE = {
    "margin": "0",
    "padding": "10px 0",
    "flexGrow": "0",
}
HEADER_GITHUB_BUTTON_STYLE = {
    "background": "none",
    "border": "none",
    "cursor": "pointer",
    "padding": "0",
}

# Control bar components
CONTROL_BAR_STYLE = {
    "display": "flex",
    "flexWrap": "nowrap",
    "alignItems": "center",
    "marginBottom": "10px",
}
DROPDOWNS_CONTAINER_STYLE = {
    "display": "flex",
    "flexGrow": "1",
    "flexWrap": "nowrap",
    "alignItems": "center",
}
DROPDOWN_STYLE = {
    "width": "200px",
    "marginRight": "10px",
    "minWidth": "150px",
}
PROTEIN_SEARCH_DROPDOWN_STYLE = {
    "flexGrow": "1",
    "marginRight": "10px",
    "minWidth": "150px",
}
UTILITIES_CONTAINER_STYLE = {
    "display": "flex",
    "flexWrap": "nowrap",
    "alignItems": "center",
}
UTILITY_BUTTON_STYLE = {"marginLeft": "5px"}


# Main view components
MAIN_VIEW_CONTAINER_STYLE = {"display": "flex"}

LEFT_PANEL_STYLE = {"width": "100%", "display": "inline-block"}

BASE_VIEWER_STYLE = {
    "border": "2px solid #dddddd",
    "height": "calc(100vh - 200px)",
    "verticalAlign": "top",
}

SCATTER_PLOT_DIV_STYLE = {
    **BASE_VIEWER_STYLE,
    "width": "100%",
    "display": "inline-block",
    "verticalAlign": "top",
}

MOLSTAR_VIEWER_DIV_STYLE = {
    **BASE_VIEWER_STYLE,
    "width": "49%",
    "display": "none",
    "verticalAlign": "top",
}

# Side panels (Settings and Help)
SIDE_PANEL_BASE_STYLE = {
    "display": "none",
    "padding": "20px",
    "backgroundColor": "#f0f0f0",
    "borderRadius": "5px",
    "verticalAlign": "top",
}

MARKER_STYLE_CONTROLLER_STYLE = {
    **SIDE_PANEL_BASE_STYLE,
    "width": f"{SETTINGS_PANEL_WIDTH_PERCENT}%",
}

HELP_MENU_STYLE = {
    **SIDE_PANEL_BASE_STYLE,
    "width": f"{HELP_PANEL_WIDTH_PERCENT}%",
    "maxHeight": "calc(100vh - 200px)",
    "overflowY": "auto",
}


# Download bar components
DOWNLOAD_SETTINGS_STYLE = {
    "marginTop": "10px",
    "display": "flex",
    "alignItems": "center",
    "gap": "10px",
}
DOWNLOAD_INPUT_STYLE = {"width": "80px"}
DOWNLOAD_INPUT_WITH_MARGIN_STYLE = {"width": "80px", "marginRight": "20px"}
DOWNLOAD_LABEL_STYLE = {"marginRight": "10px"}
DOWNLOAD_DROPDOWN_STYLE = {"width": "100px"}
