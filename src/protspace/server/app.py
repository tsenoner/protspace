import json
import base64
import zipfile
from typing import Any, Dict, Optional, Union
from pathlib import Path

import dash_bootstrap_components as dbc
from dash import Dash

from protspace.server.callbacks import setup_callbacks
from protspace.ui.layout import create_layout
from protspace.utils import JsonReader
from protspace.utils.arrow_reader import ArrowReader
from protspace.visualization.plotting import create_plot, save_plot


class ProtSpace:
    """Main application class for ProtSpace."""

    def __init__(
        self,
        pdb_zip: Optional[str] = None,
        default_json_file: Optional[str] = None,
        arrow_dir: Optional[str] = None,
    ):
        self.pdb_zip = pdb_zip
        self.default_json_data = None
        self.arrow_reader = None
        self.pdb_files_data = {}

        if default_json_file:
            with open(default_json_file, "r") as f:
                self.default_json_data = json.load(f)
        elif arrow_dir:
            self.arrow_reader = ArrowReader(Path(arrow_dir))
            # Convert Arrow data to JSON format for compatibility
            self.default_json_data = self.arrow_reader.get_data()

        if self.pdb_zip:
            self.load_pdb_files_from_zip(self.pdb_zip)

    def load_pdb_files_from_zip(self, zip_path):
        """Load PDB files from a ZIP archive and store them in pdb_files_data."""
        pdb_files = {}
        try:
            with zipfile.ZipFile(zip_path, "r") as z:
                for file in z.namelist():
                    if file.endswith(".pdb") or file.endswith(".cif"):
                        with z.open(file) as f:
                            content = f.read()
                            pdb_files[Path(file).stem.replace(".", "_")] = (
                                base64.b64encode(content).decode("utf-8")
                            )
            self.pdb_files_data = pdb_files
        except Exception as e:
            print(f"Error loading PDB ZIP: {e}")

    def create_app(self):
        """Create and configure the Dash app."""
        current_dir = Path(__file__).parent
        assets_path = str(current_dir.parent / "assets")

        app = Dash(
            __name__,
            assets_folder=assets_path,
            suppress_callback_exceptions=True,
            external_stylesheets=[dbc.themes.BOOTSTRAP],
        )
        app.title = "ProtSpace"
        app.layout = create_layout(self)
        setup_callbacks(app)
        return app

    def get_default_json_data(self) -> Optional[Dict[str, Any]]:
        """Return the default JSON data if available."""
        return self.default_json_data

    def get_pdb_files_data(self) -> Dict[str, str]:
        """Return the PDB files data."""
        return self.pdb_files_data

    # def run_server(
    #     self, port: int = 8050, debug: bool = False, quiet: bool = True
    # ) -> None:
    #     """Run the Dash server."""
    #     app = self.create_app()
    #     app.run_server(debug=debug, port=port)

    def run_server(
        self, port: int = 8050, debug: bool = False, quiet: bool = False
    ) -> None:
        import __main__
        import sys
        import os

        def is_interactive():
            return not hasattr(__main__, "__file__")

        def supress_output():
            sys.stdout = open(os.devnull, "w")
            sys.stderr = open(os.devnull, "w")

        if is_interactive():
            supress_output()
        elif quiet:
            print(f"Dash app is running on http://localhost:{port}/")
            print("Press Ctrl+C to quit")
            supress_output()

        app = self.create_app()
        app.run(debug=debug, port=port)

    def generate_plot(
        self,
        projection: str,
        feature: str,
        filename: Union[str, Path],
        width: int = 1600,
        height: int = 1000,
        file_format: str = "png",
    ) -> None:
        """Generate a plot image for a specific projection and feature."""
        if not self.default_json_data:
            raise ValueError("No JSON data loaded")

        reader = JsonReader(self.default_json_data)
        fig, is_3d = create_plot(reader, projection, feature)

        # Get image bytes from save_plot
        image_bytes = save_plot(fig, is_3d, width, height, file_format)

        # Add file extension if not present
        filename_path = Path(filename)
        if not filename_path.suffix:
            filename_path = filename_path.with_suffix(f".{file_format}")

        # Write to file
        with open(filename_path, "wb") as f:
            f.write(image_bytes)
