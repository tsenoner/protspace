from dash import html

# Centralized styles for better maintainability
HELP_MENU_STYLES = {
    "section": {"fontSize": "16px", "color": "#383838", "marginLeft": "20px"},
    "list": {"marginTop": "0px"},
    "overview_item": {"margin": "2px 0"},
    "detail_section": {"marginBottom": "20px"},
    "section_header": {"marginBottom": "-10px"},
    "container": {
        "maxHeight": "calc(100vh - 300px)",
        "overflowY": "auto"
    }
}

def create_help_menu():
    # Define styles once
    section_style = HELP_MENU_STYLES["section"]
    list_style = HELP_MENU_STYLES["list"]

    return html.Div([
        html.H3("ProtSpace Help Guide"),
        html.Div([
            html.H4("Interface Overview"),
            html.Div([
                html.Img(
                    src="assets/annotated_image.png",
                    alt="ProtSpace Interface Overview",
                    style={"width": "100%", "height": "auto"}
                ),
                html.Div([
                    html.P([html.Strong("A: Feature Selection"), " - Choose between protein properties to visualize"], style=HELP_MENU_STYLES["overview_item"]),
                    html.P([html.Strong("B: Projection Method"), " - Change between different precomputed projections"], style=HELP_MENU_STYLES["overview_item"]),
                    html.P([html.Strong("C: Search Function"), " - Find and highlight specific proteins and its 3D structure if provided"], style=HELP_MENU_STYLES["overview_item"]),
                    html.P([html.Strong("D: Utility Buttons"), " - Help menu, JSON download, JSON upload, zipped PDB upload, marker settings"], style=HELP_MENU_STYLES["overview_item"]),
                    html.P([html.Strong("E: Interactive Plot"), " - Click, zoom, and explore protein relationships"], style=HELP_MENU_STYLES["overview_item"]),
                    html.P([html.Strong("F: Export Graph"), " - Save visualization as SVG or HTML"], style=HELP_MENU_STYLES["overview_item"])
                ], style=HELP_MENU_STYLES["detail_section"]),

                # Detailed sections
                html.H4("A. Feature Selection", style=HELP_MENU_STYLES["section_header"]),
                html.Ul([
                    html.Li("Switch between features"),
                    html.Li("Color-code data points based on protein properties"),
                    html.Li("Missing values shown as <NaN>"),
                    html.Li("Customize colors and shapes for each feature group using the settings button")
                ]),

                html.H4("B. Projection Method", style=HELP_MENU_STYLES["section_header"]),
                html.Ul([
                    html.Li("Toggle between 2D and 3D visualizations"),
                    html.Li("PCA: Preserves global structure"),
                    html.Li("UMAP: Emphasizes local relationships"),
                    html.Li("PaCMAP: Can emphasizes local and global patterns, based on choosen parameters"),
                ]),

                html.H4("C. Search Functions", style=HELP_MENU_STYLES["section_header"]),
                html.Ul([
                    html.Li("Search by protein identifier"),
                    html.Li("Select multiple proteins simultaneously"),
                    html.Li("Highlight selected proteins in plot"),
                    html.Li("View corresponding 3D structures when available")
                ]),

                html.H4("D. Utility Buttons", style=HELP_MENU_STYLES["section_header"]),
                html.Ul([
                    html.Li([html.Em("Help:"), " Access this guide"]),
                    html.Li([html.Em("JSON Download:"), " Download JSON file to share with colleugues"]),
                    html.Li([html.Em("JSON Upload:"), " Upload precomputed JSON file for visualization"]),
                    html.Li([html.Em("PDB Upload:"), " Add protein structures as a zipped directory with PDB files named by protein identifier"]),
                    html.Li([html.Em("Settings:"), " Customize marker shapes (circle, square, diamond, etc.) and colors"]),
                ]),

                html.H4("E. Interactive Plot", style={"marginBottom": "5px"}),
                html.Div([
                    html.Strong("2D Plot Navigation", style=section_style),
                    html.Ul([
                        html.Li([html.Em("Select & Zoom:"), " Click and hold left mouse button to select an area"]),
                        html.Li([html.Em("Reset View:"), " Double-click to return to full visualization"]),
                    ], style=list_style),

                    html.Strong("3D Plot Navigation", style=section_style),
                    html.Ul([
                        html.Li([html.Em("Orbital Rotation:"), " Click and hold left mouse button"]),
                        html.Li([html.Em("Pan:"), " Click and hold right mouse button"]),
                        html.Li([html.Em("Zoom:"), " Use mouse wheel while cursor is in graph"])
                    ], style=list_style),

                    html.Strong("Legend Interaction", style=section_style),
                    html.Ul([
                        html.Li([html.Em("Hide/Show Groups:"), " Click on a group in legend"]),
                        html.Li([html.Em("Isolate Group:"), " Double-click on displayed group (double-click again for all groups)"])
                    ], style=list_style),

                    html.Strong("Data Interaction", style=section_style),
                    html.Ul([
                        html.Li([html.Em("View Details:"), " Mouse over points"]),
                        html.Li([html.Em("Select Molecules:"), " Click on data points to select (shows protein structure if PDB structure provided)"])
                    ], style=list_style)
                ]),

                html.H4("F. Export Graph", style=HELP_MENU_STYLES["section_header"]),
                html.Ul([
                    html.Li("2D plots: SVG format"),
                    html.Li("3D plots: Interactive HTML files"),
                    html.Li("Adjustable width and height"),
                ])
            ])
        ], style=HELP_MENU_STYLES["container"])
    ])