from dash import html


def create_help_menu():
    return html.Div(
        [
            html.H3("ProtSpace Help Guide"),
            html.Div(
                [
                    html.H4("Interface Overview"),
                    html.Div(
                        [
                            html.Img(
                                src="assets/tmp.png",
                                alt="ProtSpace Interface Overview",
                                style={
                                    "width": "100%",
                                    "height": "auto",
                                    "cursor": "pointer",
                                },
                            ),
                            html.Div(
                                [
                                    html.P(
                                        [
                                            html.Strong("A"),
                                            ": Feature Selection - Choose protein properties for visualization",
                                        ]
                                    ),
                                    html.P(
                                        [
                                            html.Strong("B"),
                                            ": Projection Method - Select dimensionality reduction view",
                                        ]
                                    ),
                                    html.P(
                                        [
                                            html.Strong("C"),
                                            ": Search Bar - Find specific proteins",
                                        ]
                                    ),
                                    html.P(
                                        [
                                            html.Strong("D"),
                                            ": Control Buttons - Settings, download, and help options",
                                        ]
                                    ),
                                    html.P(
                                        [
                                            html.Strong("E"),
                                            ": Interactive Plot - Click, zoom, and explore data points",
                                        ]
                                    ),
                                ],
                                # style={
                                #     "fontSize": "12px",
                                #     "backgroundColor": "#f8f9fa",
                                #     "padding": "10px",
                                #     "borderRadius": "5px",
                                # },
                            ),
                        ],
                    ),

                    # Same content as before
                    html.H4("Core Features"),
                    html.Ul(
                        [
                            html.Li(
                                [
                                    html.Strong("Feature Selection"),
                                    ": Choose protein features from the dropdown to color-code data points. Features represent different protein properties or classifications.",
                                ]
                            ),
                            html.Li(
                                [
                                    html.Strong("Projection Views"),
                                    ": Switch between different dimensionality reduction visualizations (PCA, UMAP, t-SNE, etc.). 2D and 3D projections available.",
                                ]
                            ),
                            html.Li(
                                [
                                    html.Strong("Protein Search"),
                                    ": Use the search dropdown to find and highlight specific proteins. Multiple selections supported.",
                                ]
                            ),
                        ]
                    ),
                    html.H4("Visualization Controls"),
                    html.Ul(
                        [
                            html.Li(
                                [
                                    html.Strong("Interactive Plots"),
                                    html.Ul(
                                        [
                                            html.Li(
                                                "Click on points to select/deselect proteins"
                                            ),
                                            html.Li(
                                                "Hover over points to view protein details"
                                            ),
                                            html.Li("Drag to pan, scroll to zoom"),
                                            html.Li("Double-click to reset view"),
                                        ]
                                    ),
                                ]
                            ),
                            html.Li(
                                [
                                    html.Strong("Style Customization (Settings ⚙️)"),
                                    html.Ul(
                                        [
                                            html.Li(
                                                "Change colors for specific feature values"
                                            ),
                                            html.Li(
                                                "Modify marker shapes (circle, square, diamond, etc.)"
                                            ),
                                            html.Li(
                                                "Styles are saved in the visualization state"
                                            ),
                                        ]
                                    ),
                                ]
                            ),
                            html.Li(
                                [
                                    html.Strong("Plot Export"),
                                    html.Ul(
                                        [
                                            html.Li(
                                                "2D plots: SVG format with customizable dimensions"
                                            ),
                                            html.Li("3D plots: Interactive HTML files"),
                                            html.Li(
                                                "Set width and height before downloading"
                                            ),
                                        ]
                                    ),
                                ]
                            ),
                        ]
                    ),
                    html.H4("Structure Visualization"),
                    html.Ul(
                        [
                            html.Li(
                                [
                                    html.Strong("PDB Viewer"),
                                    html.Ul(
                                        [
                                            html.Li(
                                                "Upload PDB files as ZIP to enable structure viewing"
                                            ),
                                            html.Li(
                                                "Click data points to display corresponding structures"
                                            ),
                                            html.Li(
                                                "Multiple structures can be viewed simultaneously"
                                            ),
                                            html.Li(
                                                "Interactive 3D manipulation of protein structures"
                                            ),
                                        ]
                                    ),
                                ]
                            )
                        ]
                    ),
                    html.H4("Data Management"),
                    html.Ul(
                        [
                            html.Li(
                                [
                                    html.Strong("File Operations"),
                                    html.Ul(
                                        [
                                            html.Li("Save visualization state as JSON"),
                                            html.Li("Load previously saved states"),
                                            html.Li(
                                                "Import new protein structures (ZIP of PDB files)"
                                            ),
                                        ]
                                    ),
                                ]
                            ),
                            html.Li(
                                [
                                    html.Strong("Data Types"),
                                    html.Ul(
                                        [
                                            html.Li(
                                                "Supports continuous and categorical features"
                                            ),
                                            html.Li(
                                                "Handles missing values (shown as <NaN>)"
                                            ),
                                            html.Li(
                                                "Compatible with various dimensionality reduction methods"
                                            ),
                                        ]
                                    ),
                                ]
                            ),
                        ]
                    ),
                    html.H4("Tips & Shortcuts"),
                    html.Ul(
                        [
                            html.Li(
                                "Hold Shift while selecting to compare multiple proteins"
                            ),
                            html.Li("Use browser refresh to reset all selections"),
                            html.Li(
                                "Export plots at high resolution by setting large dimensions"
                            ),
                            html.Li(
                                "Save visualization state frequently to preserve customizations"
                            ),
                        ]
                    ),
                ],
                style={
                    "maxHeight": "calc(100vh - 300px)",
                    "overflowY": "auto",
                },
            ),
        ]
    )
