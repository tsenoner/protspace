import logging
import json
import tempfile
import shutil
from typing import List, Tuple, Any, Dict
from pathlib import Path
from tqdm import tqdm
import requests
import gzip

import numpy as np
import pandas as pd
from pymmseqs.commands import easy_search

from protspace.utils import REDUCERS, DimensionReductionConfig
from protspace.utils.reducers import MDS_NAME
from protspace.data.generate_csv import ProteinFeatureExtractor

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

class UniProtQueryProcessor:
    """Processor for UniProt query-based protein data analysis."""

    REDUCERS = REDUCERS

    def __init__(self, config: Dict[str, Any]):
        # Remove command-line specific arguments that aren't used for dimension reduction
        self.config = config.copy()
        for arg in [
            "query",
            "sp",
            "output",
            "methods",
            "verbose",
            "custom_names",
            "delimiter",
            "metadata",
            "save_files",
            "no_save_files",
            "with_fasta",
            "with_csv",
        ]:
            self.config.pop(arg, None)
        self.identifier_col = "identifier"
        self.custom_names = config.get("custom_names", {})

    def process_query(
        self,
        query: str,
        output_path: Path,
        swissprot_only: bool = False,
        metadata: str = None,
        delimiter: str = ",",
        save_fasta: bool = False,
        save_csv: bool = False,
    ) -> Tuple[pd.DataFrame, np.ndarray, List[str], Dict[str, Path]]:
        """
        Process a UniProt query and return data for visualization.
        
        Args:
            query: UniProt search query
            swissprot_only: Only search SwissProt entries
            metadata: Metadata features to fetch
            delimiter: CSV delimiter
            output_path: Path for output JSON file
            save_fasta: Whether to save FASTA file
            save_csv: Whether to save CSV metadata file
        
        Returns:
            Tuple of (metadata_df, embeddings_array, headers_list, saved_files_dict)
        """
        logger.info(f"Processing UniProt query: '{query}' (SwissProt only: {swissprot_only})")
        
        saved_files = {}

        output_dir = output_path.parent
        clean_query = self._clean_query_name(query)
        
        # Generate filenames for FASTA and CSV
        fasta_filename = f"{clean_query}_{'swissprot' if swissprot_only else 'uniprot'}_sequences.fasta"
        fasta_save_path = output_dir / fasta_filename if save_fasta else None
        
        csv_filename = f"{clean_query}_{'swissprot' if swissprot_only else 'uniprot'}_metadata.csv"
        csv_save_path = output_dir / csv_filename if save_csv else None

        # Download FASTA from UniProt
        headers, fasta_path = self._search_and_download_fasta(query, swissprot_only, save_to=fasta_save_path)
        if not headers:
            raise ValueError(f"No sequences found for query: '{query}'")
        
        # Generate similarity matrix
        data, headers = self._get_similarity_matrix(fasta_path, headers)
        if fasta_save_path:
            saved_files['fasta'] = fasta_save_path
        else:
            fasta_path.unlink(missing_ok=True)
        
        # Save similarity matrix
        if csv_save_path:
            similarity_matrix_path = csv_save_path.parent / f"{clean_query}_similarity_matrix.csv"
            self._save_similarity_matrix(data, headers, similarity_matrix_path)
            saved_files['similarity_matrix'] = similarity_matrix_path
        
        # Generate metadata CSV
        metadata_df = self._generate_metadata(headers, metadata, delimiter, csv_save_path)
        if csv_save_path:
            saved_files['csv'] = csv_save_path
        
        return metadata_df, data, headers, saved_files

    def _clean_query_name(self, query: str) -> str:
        """Clean query string to create valid filename."""
        clean_query = "".join(c for c in query if c.isalnum() or c in (' ', '-', '_')).rstrip()
        return clean_query.replace(' ', '_').lower()

    def _search_and_download_fasta(
        self,
        query: str,
        swissprot_only: bool = False,
        save_to: Path = None,
    ) -> Tuple[List[str], Path]:
        
        logger.info(f"Searching UniProt for query: '{query}' (SwissProt only: {swissprot_only})")
        
        base_url = "https://rest.uniprot.org/uniprotkb/stream"
        params = {
            "compressed": "true",
            "format": "fasta",
            "query": query
        }
        
        if swissprot_only:
            params["query"] = f"({query}) AND (reviewed:true)"
        
        try:
            response = requests.get(base_url, params=params, stream=True)
            response.raise_for_status()
            
            # Download to temporary compressed file first
            temp_file = tempfile.NamedTemporaryFile(mode='wb', suffix='.fasta.gz', delete=False)
            temp_gz_file = Path(temp_file.name)
            
            # Download compressed FASTA to temp file
            total_size = int(response.headers.get('content-length', 0))
            with tqdm(total=total_size, unit='B', unit_scale=True, desc="Downloading FASTA") as pbar:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        temp_file.write(chunk)
                        pbar.update(len(chunk))
            
            temp_file.close()
            
            # Extract identifiers from compressed FASTA file
            identifiers = self._extract_identifiers_from_fasta(str(temp_gz_file))
            
            # Always extract the FASTA file for processing
            if save_to:
                # Extract to the user-specified location
                extracted_fasta_path = save_to
                # Create directory if it doesn't exist
                extracted_fasta_path.parent.mkdir(parents=True, exist_ok=True)
                logger.info(f"Extracting FASTA to: {save_to}")
            else:
                # Extract to a temporary file
                extracted_fasta_path = temp_gz_file.with_suffix('')
                logger.info(f"Extracting FASTA to temporary file: {extracted_fasta_path}")
            
            with gzip.open(temp_gz_file, 'rt') as gz_file:
                content = gz_file.read()
                with open(extracted_fasta_path, 'w') as output_file:
                    output_file.write(content)
            
            # Clean up the compressed file since we don't need it anymore
            temp_gz_file.unlink(missing_ok=True)
            
            logger.info(f"Downloaded and extracted {len(identifiers)} sequences")
            
            return identifiers, extracted_fasta_path
            
        except requests.RequestException as e:
            logger.error(f"Error downloading FASTA: {e}")
            raise
        except Exception as e:
            logger.error(f"Error processing FASTA: {e}")
            raise
    
    def _get_similarity_matrix(
        self,
        fasta_path: Path,
        headers: List[str]
    ) -> Tuple[np.ndarray, List[str]]:
        """Generate similarity matrix using pymmseqs from extracted FASTA file."""
        n_seqs = len(headers)
        input_fasta = str(fasta_path.absolute())
        
        # Generate similarity matrix using pymmseqs
        logger.info("Generating similarity matrix using pymmseqs...")
        
        # Create temporary directory for pymmseqs output files
        temp_mmseqs_dir = str(Path(tempfile.mkdtemp(prefix="protspace_pymmseqs_")).absolute())
        temp_alignment_file = str(Path(temp_mmseqs_dir) / "output.tsv")
        
        try:
            df = easy_search(
                query_fasta=input_fasta, 
                target_fasta_or_db=input_fasta, 
                alignment_file=temp_alignment_file,
                tmp_dir=temp_mmseqs_dir,
                max_seqs=n_seqs * n_seqs,
                e=1000000,
                s=8,
            ).to_pandas()
            
            similarity_matrix = np.zeros((n_seqs, n_seqs))
            
            # Create header to index mapping
            header_to_idx = {header: idx for idx, header in enumerate(headers)}
            
            # Fill the similarity matrix with bit scores
            for _, row in df.iterrows():
                target = row['target']
                query = row['query']
                fident = row['fident']
                
                # Map headers to indices
                target_idx = header_to_idx.get(target)
                query_idx = header_to_idx.get(query)
                
                if target_idx is not None and query_idx is not None:
                    similarity_matrix[target_idx, query_idx] = fident
                    similarity_matrix[query_idx, target_idx] = fident
            
        finally:
            # Clean up temporary files and directories
            shutil.rmtree(temp_mmseqs_dir, ignore_errors=True)
        
        return similarity_matrix, headers

    def _save_similarity_matrix(self, similarity_matrix: np.ndarray, headers: List[str], save_path: Path):
        """Save similarity matrix as CSV with headers as row/column names."""
        # Create directory if it doesn't exist
        save_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Create DataFrame with headers as both index and columns
        df = pd.DataFrame(similarity_matrix, index=headers, columns=headers)
        df.to_csv(save_path)
        logger.info(f"Similarity matrix saved to: {save_path}")
    
    def _extract_identifiers_from_fasta(self, fasta_gz_path: str) -> List[str]:
        """Extract sequence identifiers from compressed FASTA file."""
        identifiers = []
        
        with gzip.open(fasta_gz_path, 'rt') as f:
            for line in f:
                if line.startswith('>'):
                    # Extract UniProt accession from FASTA header
                    # Format: >sp|P01308|INS_HUMAN or >tr|A0A0A0MRZ7|A0A0A0MRZ7_HUMAN
                    header = line.strip()
                    if '|' in header:
                        parts = header.split('|')
                        if len(parts) >= 2:
                            accession = parts[1]
                            identifiers.append(accession)
                    else:
                        # Fallback: use first word after >
                        accession = header[1:].split()[0]
                        identifiers.append(accession)
        
        return identifiers

    def _generate_metadata(self, headers: List[str], metadata: str, delimiter: str, csv_save_path: Path = None) -> pd.DataFrame:
        """Generate metadata CSV and return DataFrame."""
        # Create temporary directory for metadata generation
        temp_dir = Path(tempfile.mkdtemp(prefix="protspace_query_"))
        
        try:
            if metadata and metadata.endswith(".csv"):
                logger.info(f"Using delimiter: {repr(delimiter)} to read metadata")
                metadata_df = pd.read_csv(metadata, delimiter=delimiter).convert_dtypes()
            else:
                if metadata:
                    features = [feature.strip() for feature in metadata.split(",")]
                else:
                    features = None  # No specific features requested, use all

                # Generate CSV using ProteinFeatureExtractor
                temp_csv_path = temp_dir / "metadata.csv"
                metadata_df = ProteinFeatureExtractor(
                    headers=headers, features=features, csv_output=temp_csv_path
                ).to_pd()
                
                # Save to permanent location if requested
                if csv_save_path:
                    # Create directory if it doesn't exist
                    csv_save_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(temp_csv_path, csv_save_path)
                    logger.info(f"Metadata CSV saved to: {csv_save_path}")

        except Exception as e:
            logger.warning(f"Could not generate metadata ({str(e)}) - creating empty metadata")
            metadata_df = pd.DataFrame(columns=["identifier"])
        finally:
            # Clean up temporary directory
            shutil.rmtree(temp_dir, ignore_errors=True)

        # Create full metadata with NaN for missing entries
        full_metadata = pd.DataFrame({"identifier": headers})
        if len(metadata_df.columns) > 1:
            metadata_df = metadata_df.astype(str)
            full_metadata = full_metadata.merge(
                metadata_df.drop_duplicates("identifier"),
                on="identifier",
                how="left",
            )

        return full_metadata

    def process_reduction(self, data: np.ndarray, method: str, dims: int) -> Dict[str, Any]:
        """Process a single reduction method."""
        config = DimensionReductionConfig(n_components=dims, **self.config)

        # Special handling for MDS when using similarity matrix
        if method == MDS_NAME and config.precomputed is True:
            # Convert similarity to dissimilarity matrix if needed
            if np.allclose(np.diag(data), 1):
                # Convert similarity to distance: d = sqrt(max(s) - s)
                max_sim = np.max(data)
                data = np.sqrt(max_sim - data)

        reducer_cls = self.REDUCERS.get(method)
        if not reducer_cls:
            raise ValueError(f"Unknown reduction method: {method}")

        reducer = reducer_cls(config)
        reduced_data = reducer.fit_transform(data)

        method_spec = f"{method}{dims}"
        projection_name = self.custom_names.get(method_spec, f"{method.upper()}_{dims}")

        return {
            "name": projection_name,
            "dimensions": dims,
            "info": reducer.get_params(),
            "data": reduced_data,
        }

    def create_output(
        self,
        metadata: pd.DataFrame,
        reductions: List[Dict[str, Any]],
        headers: List[str],
    ) -> Dict[str, Any]:
        """Create the final output dictionary."""
        output = {"protein_data": {}, "projections": []}

        # Process features
        for _, row in metadata.iterrows():
            protein_id = row[self.identifier_col]
            features = (
                row.drop(self.identifier_col)
                .infer_objects(copy=False)
                .fillna("")
                .to_dict()
            )
            output["protein_data"][protein_id] = {"features": features}

        # Process projections
        for reduction in reductions:
            projection = {
                "name": reduction["name"],
                "dimensions": reduction["dimensions"],
                "info": reduction["info"],
                "data": [],
            }

            for i, header in enumerate(headers):
                coordinates = {
                    "x": float(reduction["data"][i][0]),
                    "y": float(reduction["data"][i][1]),
                }
                if reduction["dimensions"] == 3:
                    coordinates["z"] = float(reduction["data"][i][2])

                projection["data"].append(
                    {"identifier": header, "coordinates": coordinates}
                )

            output["projections"].append(projection)

        return output


def save_output(data: Dict[str, Any], output_path: Path):
    """Save output data to JSON file."""
    if output_path.exists():
        with output_path.open("r") as f:
            existing = json.load(f)
            existing["protein_data"].update(data["protein_data"])

            # Update or add projections
            existing_projs = {p["name"]: p for p in existing["projections"]}
            for new_proj in data["projections"]:
                existing_projs[new_proj["name"]] = new_proj
            existing["projections"] = list(existing_projs.values())

        data = existing

    with output_path.open("w") as f:
        json.dump(data, f, indent=2)
