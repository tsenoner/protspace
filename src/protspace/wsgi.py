import os

from dotenv import load_dotenv

from protspace import ProtSpace

load_dotenv(".env.example")

protspace = ProtSpace(
    pdb_zip=os.getenv("PDB_ZIP_PATH"),
    arrow_dir=os.getenv("ARROW_DIR_PATH"),
)

# Create the Dash app
app = protspace.create_app()

# Expose the Flask server for Gunicorn
server = app.server
