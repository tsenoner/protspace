import logging
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

from protspace.utils import REDUCERS
from protspace.data.base_data_processor import BaseDataProcessor
from protspace.data.feature_manager import ProteinFeatureExtractor

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

class UniProtQueryProcessor(BaseDataProcessor):
    """Processor for UniProt query-based protein data analysis."""

    def __init__(self, config: Dict[str, Any]):
        # Remove command-line specific arguments that aren't used for dimension reduction
        clean_config = config.copy()
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
            "keep_tmp",
        ]:
            clean_config.pop(arg, None)
        
        # Initialize base class with cleaned config and reducers
        super().__init__(clean_config, REDUCERS)

    def process_query(
        self,
        query: str,
        output_path: Path,
        metadata: str = None,
        delimiter: str = ",",
        keep_tmp: bool = False,
        non_binary: bool = False,
    ) -> Tuple[pd.DataFrame, np.ndarray, List[str], Dict[str, Path]]:
        """
        Process a UniProt query and return data for visualization.
        
        Args:
            query: UniProt search query (exact query to send to UniProt)
            metadata: Metadata features to fetch
            delimiter: CSV delimiter
            output_path: Path for output JSON file
            keep_tmp: Whether to keep temporary files (FASTA, complete protein features, and similarity matrix)
            non_binary: Whether to use non-binary formats (CSV instead of parquet)
        
        Returns:
            Tuple of (metadata_df, embeddings_array, headers_list, saved_files_dict)
        """
        logger.info(f"Processing UniProt query: '{query}'")
        
        saved_files = {}
        fasta_filename = "sequences.fasta"
        
        # Metadata file format depends on non_binary flag
        if keep_tmp:
            fasta_save_path = output_path / fasta_filename

            if non_binary:
                metadata_filename = "all_features.csv"
            else:
                metadata_filename = "all_features.parquet"

            metadata_save_path = output_path / metadata_filename

        else:
            fasta_save_path = None
            metadata_save_path = None

        # Download FASTA from UniProt
        headers, fasta_path = self._search_and_download_fasta(query, save_to=fasta_save_path)
        if not headers:
            raise ValueError(f"No sequences found for query: '{query}'")
        
        # Generate similarity matrix
        data, headers = self._get_similarity_matrix(fasta_path, headers)
        if fasta_save_path:
            # Ensure directory exists when saving FASTA
            fasta_save_path.parent.mkdir(parents=True, exist_ok=True)
            saved_files['fasta'] = fasta_save_path
        else:
            fasta_path.unlink(missing_ok=True)
        
        # Save similarity matrix
        if metadata_save_path:
            similarity_matrix_path = metadata_save_path.parent / "similarity_matrix.csv"
            self._save_similarity_matrix(data, headers, similarity_matrix_path)
            saved_files['similarity_matrix'] = similarity_matrix_path
        
        # Generate metadata file
        metadata_df = self._generate_metadata(headers, metadata, delimiter, metadata_save_path, non_binary, keep_tmp)
        if metadata_save_path:
            # Ensure directory exists when saving metadata
            metadata_save_path.parent.mkdir(parents=True, exist_ok=True)
            saved_files['metadata'] = metadata_save_path
        
        return metadata_df, data, headers, saved_files

    def _search_and_download_fasta(
        self,
        query: str,
        save_to: Path = None,
    ) -> Tuple[List[str], Path]:
        
        logger.info(f"Searching UniProt for query: '{query}'")
        
        base_url = "https://rest.uniprot.org/uniprotkb/stream"
        params = {
            "compressed": "true",
            "format": "fasta",
            "query": query
        }
        
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

    def _generate_metadata(
        self,
        headers: List[str],
        metadata: str,
        delimiter: str,
        metadata_save_path: Path = None,
        non_binary: bool = False,
        keep_tmp: bool = False,
    ) -> pd.DataFrame:
        """Generate metadata CSV and return DataFrame."""        
        try:
            if metadata and metadata.endswith(".csv"):
                logger.info(f"Using delimiter: {repr(delimiter)} to read metadata")
                metadata_df = pd.read_csv(metadata, delimiter=delimiter).convert_dtypes()
            else:
                if metadata:
                    features = [feature.strip() for feature in metadata.split(",")]
                else:
                    features = None  # No specific features requested, use all

                # Create directory only if metadata_save_path is provided
                if metadata_save_path:
                    metadata_save_path.parent.mkdir(parents=True, exist_ok=True)
                    
                metadata_df = ProteinFeatureExtractor(
                    headers=headers,
                    features=features,
                    output_path=metadata_save_path,
                    non_binary=non_binary,
                ).to_pd()
                
                if keep_tmp and metadata_save_path:
                    logger.info(f"Metadata file saved to: {metadata_save_path}")
                else:
                    if metadata_save_path and metadata_save_path.exists():
                        metadata_save_path.unlink()
                        logger.debug(f"Temporary metadata file deleted: {metadata_save_path}")

        except Exception as e:
            logger.warning(f"Could not generate metadata ({str(e)}) - creating empty metadata")
            metadata_df = pd.DataFrame(columns=["identifier"])

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


