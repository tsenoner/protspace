from dash_molstar.utils import molstar_helper as msh
import base64
import requests


def get_molstar_data(protein_id=None, pdb_files_data=None, content=None, ext=None):
    """
    Returns data for the Molstar viewer, either from a URL or from file content.

    Args:
        protein_id (str, optional): The protein ID (e.g., UniProt accession).
            If provided, the function will attempt to fetch data from the AlphaFold database.
        pdb_files_data (dict, optional): A dictionary containing pre-loaded PDB/CIF files.
        content (str, optional): The raw content of a PDB/CIF file.
        ext (str, optional): The file extension ('pdb' or 'cif') for the provided content.

    Returns:
        dict: A dictionary containing the data for the Molstar viewer, or None if data
        could not be retrieved.
    """
    if content:
        return msh.parse_content(content, ext)

    # Check local PDB files first
    if protein_id and pdb_files_data:
        protein_id_key = protein_id.replace(".", "_")
        if protein_id_key in pdb_files_data:
            pdb_content_base64, file_ext = pdb_files_data[protein_id_key]
            pdb_content = base64.b64decode(pdb_content_base64).decode("utf-8")
            return msh.parse_content(pdb_content, file_ext)

    if protein_id:
        # Try fetching from AlphaFold DB first
        url = f"https://alphafold.ebi.ac.uk/files/AF-{protein_id}-F1-model_v4.cif"
        try:
            # Check if the URL is valid before attempting to parse it
            response = requests.head(url)
            if response.status_code == 200:
                preset = {"kind": "standard", "plddt": "on"}
                return msh.parse_url(url, preset=preset)
        except requests.exceptions.RequestException as e:
            print(f"Error checking URL {url}: {e}")

    return None
