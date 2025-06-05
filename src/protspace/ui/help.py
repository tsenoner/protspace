from dash import html
import dash_bootstrap_components as dbc

# Centralized styles for better maintainability
HELP_MENU_STYLES = {
    "section": {"fontSize": "16px", "color": "#383838", "marginLeft": "20px"},
    "list": {"marginTop": "0px"},
    "overview_item": {"margin": "2px 0"},
    "detail_section": {"marginBottom": "20px"},
    "section_header": {"marginBottom": "-2px"},
    "container": {"maxHeight": "calc(100vh - 300px)", "overflowY": "auto"},
    "link": {"color": "#0066cc", "textDecoration": "underline"},
}


def create_help_menu():
    # Define styles once
    section_style = HELP_MENU_STYLES["section"]
    list_style = HELP_MENU_STYLES["list"]

    interface_content = dbc.Card(
        dbc.CardBody(
            [
                # html.H4("Interface Overview"),
                html.Div(
                    [
                        html.Img(
                            src="assets/annotated_image.png",
                            alt="ProtSpace Interface Overview",
                            style={"width": "100%", "height": "auto"},
                        ),
                        html.Div(
                            [
                                html.P(
                                    [
                                        html.Strong("A: Feature Selection"),
                                        " - Choose between protein properties to visualize",
                                    ],
                                    style=HELP_MENU_STYLES["overview_item"],
                                ),
                                html.P(
                                    [
                                        html.Strong("B: Projection Method"),
                                        " - Change between different precomputed projections",
                                    ],
                                    style=HELP_MENU_STYLES["overview_item"],
                                ),
                                html.P(
                                    [
                                        html.Strong("C: Search Function"),
                                        " - Find and highlight specific proteins and its 3D structure if provided",
                                    ],
                                    style=HELP_MENU_STYLES["overview_item"],
                                ),
                                html.P(
                                    [
                                        html.Strong("D: Utility Buttons"),
                                        " - Help menu, JSON download, JSON upload, zipped PDB upload, marker settings",
                                    ],
                                    style=HELP_MENU_STYLES["overview_item"],
                                ),
                                html.P(
                                    [
                                        html.Strong("E: Interactive Plot"),
                                        " - Click, zoom, and explore protein relationships",
                                    ],
                                    style=HELP_MENU_STYLES["overview_item"],
                                ),
                                html.P(
                                    [
                                        html.Strong("F: Export Graph"),
                                        " - Save visualization as SVG or HTML",
                                    ],
                                    style=HELP_MENU_STYLES["overview_item"],
                                ),
                            ],
                            style=HELP_MENU_STYLES["detail_section"],
                        ),
                        # Detailed sections
                        html.H5(
                            "A. Feature Selection",
                            style=HELP_MENU_STYLES["section_header"],
                        ),
                        html.Ul(
                            [
                                html.Li(
                                    "Switch between features (columns provided in the CSV file)"
                                ),
                                html.Li(
                                    "Color-code data points based on protein properties"
                                ),
                                html.Li("Missing values shown as <NaN>"),
                                html.Li(
                                    "Customize colors and shapes for each feature group using the settings button"
                                ),
                            ]
                        ),
                        html.H5(
                            "B. Projection Method",
                            style=HELP_MENU_STYLES["section_header"],
                        ),
                        html.Ul(
                            [
                                html.Li("Toggle between 2D and 3D visualizations"),
                                html.Li([
                                    "PCA: Preserves global structure - ",
                                    html.A("Pearson (1901)", href="https://doi.org/10.1080/14786440109462720", target="_blank", style=HELP_MENU_STYLES["link"]),
                                ]),
                                html.Li([
                                    "UMAP: Emphasizes local relationships - ",
                                    html.A("McInnes et al. (2018)", href="https://arxiv.org/abs/1802.03426", target="_blank", style=HELP_MENU_STYLES["link"])
                                ]),
                                html.Li([
                                    "PaCMAP: Can emphasizes local and global patterns, based on choosen parameters - ",
                                    html.A("Wang et al. (2021)", href="http://jmlr.org/papers/v22/20-1061.html", target="_blank", style=HELP_MENU_STYLES["link"])
                                ]),
                                html.Li([
                                    "For a comparison of dimensionality reduction methods, see ",
                                    html.A(
                                        "Huang et al. (2022)",
                                        href="https://www.nature.com/articles/s42003-022-03628-x",
                                        target="_blank",
                                        style=HELP_MENU_STYLES["link"],
                                    ),
                                ]),
                            ]
                        ),
                        html.H5(
                            "C. Search Functions",
                            style=HELP_MENU_STYLES["section_header"],
                        ),
                        html.Ul(
                            [
                                html.Li("Search by protein identifier"),
                                html.Li("Select multiple proteins simultaneously"),
                                html.Li("Highlight selected proteins in plot"),
                                html.Li(
                                    "View corresponding 3D structures when available"
                                ),
                            ]
                        ),
                        html.H5(
                            "D. Utility Buttons",
                            style=HELP_MENU_STYLES["section_header"],
                        ),
                        html.Ul(
                            [
                                html.Li([html.Em("Help:"), " Access this guide"]),
                                html.Li(
                                    [
                                        html.Em("JSON Download:"),
                                        " Download JSON file to share with colleugues",
                                    ]
                                ),
                                html.Li(
                                    [
                                        html.Em("JSON Upload:"),
                                        " Upload precomputed JSON file for visualization",
                                    ]
                                ),
                                html.Li(
                                    [
                                        html.Em("PDB Upload:"),
                                        " Add protein structures as a zipped directory with PDB files named by protein identifier",
                                    ]
                                ),
                                html.Li(
                                    [
                                        html.Em("Settings:"),
                                        " Customize marker shapes (circle, square, diamond, etc.) and colors",
                                    ]
                                ),
                            ]
                        ),
                        html.H5("E. Interactive Plot", style={"marginBottom": "5px"}),
                        html.Div(
                            [
                                html.Strong("2D Plot Navigation", style=section_style),
                                html.Ul(
                                    [
                                        html.Li(
                                            [
                                                html.Em("Select & Zoom:"),
                                                " Click and hold left mouse button to select an area",
                                            ]
                                        ),
                                        html.Li(
                                            [
                                                html.Em("Reset View:"),
                                                " Double-click to return to full visualization",
                                            ]
                                        ),
                                    ],
                                    style=list_style,
                                ),
                                html.Strong("3D Plot Navigation", style=section_style),
                                html.Ul(
                                    [
                                        html.Li(
                                            [
                                                html.Em("Orbital Rotation:"),
                                                " Click and hold left mouse button",
                                            ]
                                        ),
                                        html.Li(
                                            [
                                                html.Em("Pan:"),
                                                " Click and hold right mouse button",
                                            ]
                                        ),
                                        html.Li(
                                            [
                                                html.Em("Zoom:"),
                                                " Use mouse wheel while cursor is in graph",
                                            ]
                                        ),
                                    ],
                                    style=list_style,
                                ),
                                html.Strong("Legend Interaction", style=section_style),
                                html.Ul(
                                    [
                                        html.Li(
                                            [
                                                html.Em("Hide/Show Groups:"),
                                                " Click on a group in legend",
                                            ]
                                        ),
                                        html.Li(
                                            [
                                                html.Em("Isolate Group:"),
                                                " Double-click on displayed group (double-click again for all groups)",
                                            ]
                                        ),
                                    ],
                                    style=list_style,
                                ),
                                html.Strong("Data Interaction", style=section_style),
                                html.Ul(
                                    [
                                        html.Li(
                                            [
                                                html.Em("View Details:"),
                                                " Mouse over points",
                                            ]
                                        ),
                                        html.Li(
                                            [
                                                html.Em("Select Molecules:"),
                                                " Click on data points to select (shows protein structure if PDB structure provided)",
                                            ]
                                        ),
                                    ],
                                    style=list_style,
                                ),
                            ]
                        ),
                        html.H5(
                            "F. Export Graph", style=HELP_MENU_STYLES["section_header"]
                        ),
                        html.Ul(
                            [
                                html.Li("2D plots: SVG format"),
                                html.Li("3D plots: Interactive HTML files"),
                                html.Li("Adjustable width and height"),
                            ]
                        ),
                    ]
                ),
            ]
        ),
        className="mt-3",
    )
    json_content = dbc.Card(
        dbc.CardBody(
            [
                # html.H4("JSON File Structure", style=HELP_MENU_STYLES["section_header"]),
                html.Div(
                    [
                        html.P(
                            "The JSON file used by ProtSpace contains three main sections:"
                        ),
                        html.Strong("1. protein_data", style=section_style),
                        html.P(
                            "This section contains all feature information about each protein:",
                            style={"marginLeft": "20px"},
                        ),
                        html.Pre(
                            """
{
    "protein_data": {
        "protein1": {
            "features": {
                "category": "toxin",
                "family": "3FTx",
                ...
            }
        },
        "protein2": {
            "features": {
                "category": "enzyme",
                "family": "PLA2",
                ...
            }
        }
    }
}""",
                            style={
                                "backgroundColor": "#f8f8f8",
                                "padding": "10px",
                                "borderRadius": "5px",
                            },
                        ),
                        html.Strong("2. projections", style=section_style),
                        html.P(
                            "Contains different dimensionality reduction results:",
                            style={"marginLeft": "20px"},
                        ),
                        html.Pre(
                            """
{
    "projections": [
        {
            "name": "UMAP_2D",
            "dimensions": 2,
            "data": [
                {
                    "identifier": "protein1",
                    "coordinates": {
                        "x": 1.234,
                        "y": -0.567
                    }
                },
                {
                    "identifier": "protein2",
                    "coordinates": {
                        "x": -0.707,
                        "y": 0.122
                    }
                },
                ...
            ]
        },
        ...
    ]
}""",
                            style={
                                "backgroundColor": "#f8f8f8",
                                "padding": "10px",
                                "borderRadius": "5px",
                            },
                        ),
                        html.Strong(
                            "3. visualization_state (optional)", style=section_style
                        ),
                        html.P(
                            "Stores custom styling for features:",
                            style={"marginLeft": "20px"},
                        ),
                        html.Pre(
                            """
{
    "visualization_state": {
        "feature_colors": {
            "category": {
                "toxin": "rgba(255, 0, 0, 0.8)",
                "enzyme": "rgba(0, 0, 255, 0.8)"
            }
        },
        "marker_shapes": {
            "category": {
                "toxin": "circle",
                "enzyme": "square"
            }
        }
    }
}""",
                            style={
                                "backgroundColor": "#f8f8f8",
                                "padding": "10px",
                                "borderRadius": "5px",
                            },
                        ),
                        html.H4("Key Points:", style={"marginTop": "20px"}),
                        html.Ul(
                            [
                                html.Li(
                                    "The 'identifier' in projections must match the protein keys in protein_data"
                                ),
                                html.Li(
                                    "2D projections require x and y coordinates, 3D projections need x, y, and z"
                                ),
                                html.Li(
                                    "Marker shapes must be one of the supported types (circle, square, diamond, etc.) - https://plotly.com/python/marker-style/"
                                ),
                            ]
                        ),
                        html.P(
                            [
                                "You can use the ",
                                html.Code("protspace-json"),
                                " command-line tool to generate this JSON file from your protein embeddings or similarity matrix.",
                            ]
                        ),
                    ]
                )
            ]
        ),
        className="mt-3",
    )

    help_menu = html.Div(
        [
            html.H3("ProtSpace Help Guide"),
            html.Div(
                [
                    dbc.Tabs(
                        [
                            dbc.Tab(interface_content, label="Interface Overview"),
                            dbc.Tab(json_content, label="JSON File Structure"),
                        ]
                    )
                ],
                style=HELP_MENU_STYLES["container"],
            ),
        ]
    )

    return help_menu

    # return html.Div([
    #     html.H2("ProtSpace Help Guide"),
    #     html.Div([
    #         html.H3("Interface Overview"),
    #         html.Div([
    #             html.Img(
    #                 src="assets/annotated_image.png",
    #                 alt="ProtSpace Interface Overview",
    #                 style={"width": "100%", "height": "auto"}
    #             ),
    #             html.Div([
    #                 html.P([html.Strong("A: Feature Selection"), " - Choose between protein properties to visualize"], style=HELP_MENU_STYLES["overview_item"]),
    #                 html.P([html.Strong("B: Projection Method"), " - Change between different precomputed projections"], style=HELP_MENU_STYLES["overview_item"]),
    #                 html.P([html.Strong("C: Search Function"), " - Find and highlight specific proteins and its 3D structure if provided"], style=HELP_MENU_STYLES["overview_item"]),
    #                 html.P([html.Strong("D: Utility Buttons"), " - Help menu, JSON download, JSON upload, zipped PDB upload, marker settings"], style=HELP_MENU_STYLES["overview_item"]),
    #                 html.P([html.Strong("E: Interactive Plot"), " - Click, zoom, and explore protein relationships"], style=HELP_MENU_STYLES["overview_item"]),
    #                 html.P([html.Strong("F: Export Graph"), " - Save visualization as SVG or HTML"], style=HELP_MENU_STYLES["overview_item"])
    #             ], style=HELP_MENU_STYLES["detail_section"]),

    #             # Detailed sections
    #             html.H4("A. Feature Selection", style=HELP_MENU_STYLES["section_header"]),
    #             html.Ul([
    #                 html.Li("Switch between features"),
    #                 html.Li("Color-code data points based on protein properties"),
    #                 html.Li("Missing values shown as <NaN>"),
    #                 html.Li("Customize colors and shapes for each feature group using the settings button")
    #             ]),

    #             html.H4("B. Projection Method", style=HELP_MENU_STYLES["section_header"]),
    #             html.Ul([
    #                 html.Li("Toggle between 2D and 3D visualizations"),
    #                 html.Li("PCA: Preserves global structure"),
    #                 html.Li("UMAP: Emphasizes local relationships"),
    #                 html.Li("PaCMAP: Can emphasizes local and global patterns, based on choosen parameters"),
    #             ]),

    #             html.H4("C. Search Functions", style=HELP_MENU_STYLES["section_header"]),
    #             html.Ul([
    #                 html.Li("Search by protein identifier"),
    #                 html.Li("Select multiple proteins simultaneously"),
    #                 html.Li("Highlight selected proteins in plot"),
    #                 html.Li("View corresponding 3D structures when available")
    #             ]),

    #             html.H4("D. Utility Buttons", style=HELP_MENU_STYLES["section_header"]),
    #             html.Ul([
    #                 html.Li([html.Em("Help:"), " Access this guide"]),
    #                 html.Li([html.Em("JSON Download:"), " Download JSON file to share with colleugues"]),
    #                 html.Li([html.Em("JSON Upload:"), " Upload precomputed JSON file for visualization"]),
    #                 html.Li([html.Em("PDB Upload:"), " Add protein structures as a zipped directory with PDB files named by protein identifier"]),
    #                 html.Li([html.Em("Settings:"), " Customize marker shapes (circle, square, diamond, etc.) and colors"]),
    #             ]),

    #             html.H4("E. Interactive Plot", style={"marginBottom": "5px"}),
    #             html.Div([
    #                 html.Strong("2D Plot Navigation", style=section_style),
    #                 html.Ul([
    #                     html.Li([html.Em("Select & Zoom:"), " Click and hold left mouse button to select an area"]),
    #                     html.Li([html.Em("Reset View:"), " Double-click to return to full visualization"]),
    #                 ], style=list_style),

    #                 html.Strong("3D Plot Navigation", style=section_style),
    #                 html.Ul([
    #                     html.Li([html.Em("Orbital Rotation:"), " Click and hold left mouse button"]),
    #                     html.Li([html.Em("Pan:"), " Click and hold right mouse button"]),
    #                     html.Li([html.Em("Zoom:"), " Use mouse wheel while cursor is in graph"])
    #                 ], style=list_style),

    #                 html.Strong("Legend Interaction", style=section_style),
    #                 html.Ul([
    #                     html.Li([html.Em("Hide/Show Groups:"), " Click on a group in legend"]),
    #                     html.Li([html.Em("Isolate Group:"), " Double-click on displayed group (double-click again for all groups)"])
    #                 ], style=list_style),

    #                 html.Strong("Data Interaction", style=section_style),
    #                 html.Ul([
    #                     html.Li([html.Em("View Details:"), " Mouse over points"]),
    #                     html.Li([html.Em("Select Molecules:"), " Click on data points to select (shows protein structure if PDB structure provided)"])
    #                 ], style=list_style)
    #             ]),

    #             html.H4("F. Export Graph", style=HELP_MENU_STYLES["section_header"]),
    #             html.Ul([
    #                 html.Li("2D plots: SVG format"),
    #                 html.Li("3D plots: Interactive HTML files"),
    #                 html.Li("Adjustable width and height"),
    #             ])
    #         ]),
    #         html.H3("JSON File Structure", style=HELP_MENU_STYLES["section_header"]),
    #         html.Div([
    #             html.P("The JSON file used by ProtSpace contains three main sections:"),

    #             html.Strong("1. protein_data", style=section_style),
    #             html.P("This section contains information about each protein and its features:", style={"marginLeft": "20px"}),
    #             html.Pre("""
    #             {
    #                 "protein_data": {
    #                     "protein1": {
    #                         "features": {
    #                             "category": "toxin",
    #                             "family": "3FTx",
    #                             "length": "61"
    #                         }
    #                     },
    #                     "protein2": {
    #                         "features": {
    #                             "category": "enzyme",
    #                             "family": "PLA2",
    #                             "length": "118"
    #                         }
    #                     }
    #                 }
    #             }""", style={"backgroundColor": "#f8f8f8", "padding": "10px", "borderRadius": "5px"}),

    #             html.Strong("2. projections", style=section_style),
    #             html.P("Contains the dimensionality reduction results:", style={"marginLeft": "20px"}),
    #             html.Pre("""
    #             {
    #                 "projections": [
    #                     {
    #                         "name": "UMAP_2D",
    #                         "dimensions": 2,
    #                         "info": {
    #                             "n_neighbors": 15,
    #                             "min_dist": 0.1
    #                         },
    #                         "data": [
    #                             {
    #                                 "identifier": "protein1",
    #                                 "coordinates": {
    #                                     "x": 1.234,
    #                                     "y": -0.567
    #                                 }
    #                             }
    #                         ]
    #                     }
    #                 ]
    #             }""", style={"backgroundColor": "#f8f8f8", "padding": "10px", "borderRadius": "5px"}),

    #             html.Strong("3. visualization_state (optional)", style=section_style),
    #             html.P("Stores custom styling for features:", style={"marginLeft": "20px"}),
    #             html.Pre("""
    #             {
    #                 "visualization_state": {
    #                     "feature_colors": {
    #                         "category": {
    #                             "toxin": "rgba(255, 0, 0, 0.8)",
    #                             "enzyme": "rgba(0, 0, 255, 0.8)"
    #                         }
    #                     },
    #                     "marker_shapes": {
    #                         "category": {
    #                             "toxin": "circle",
    #                             "enzyme": "square"
    #                         }
    #                     }
    #                 }
    #             }""", style={"backgroundColor": "#f8f8f8", "padding": "10px", "borderRadius": "5px"}),

    #             html.H4("Key Points:", style={"marginTop": "20px"}),
    #             html.Ul([
    #                 html.Li("The 'identifier' in projections must match the protein keys in protein_data"),
    #                 html.Li("2D projections require x and y coordinates, 3D projections need x, y, and z"),
    #                 html.Li("All feature values are stored as strings"),
    #                 html.Li("Colors should use rgba format for consistency"),
    #                 html.Li("Marker shapes must be one of the supported types (circle, square, diamond, etc.)")
    #             ]),

    #             html.P([
    #                 "You can use the ",
    #                 html.Code("protspace-json"),
    #                 " command-line tool to generate this JSON file from your protein embeddings or similarity matrix."
    #             ])
    #         ])
    #     ], style=HELP_MENU_STYLES["container"])
    # ])
