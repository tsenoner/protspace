import csv
import pandas as pd
import numpy as np
from typing import List, Union, Tuple
from pathlib import Path

from protspace.data.uniprot_feature_retriever import (
    UniProtFeatureRetriever,
    UNIPROT_FEATURES,
    ProteinFeatures,
)
from protspace.data.taxonomy_feature_retriever import (
    TaxonomyFeatureRetriever,
    TAXONOMY_FEATURES,
)

import logging

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_FEATURES = UNIPROT_FEATURES + TAXONOMY_FEATURES
NEEDED_UNIPROT_FEATURES = ["accession", "organism_id"]
LENGTH_BINNING_FEATURES = ["length_fixed", "length_quantile"]


class ProteinFeatureExtractor:
    def __init__(
        self,
        headers: List[str],
        features: List = None,
        output_path: Path = None,
        non_binary: bool = False,
    ):
        self.headers = headers
        self.user_features = self._validate_features(features) if features else None
        self.uniprot_features, self.taxonomy_features = self._initialize_features(
            DEFAULT_FEATURES
        )
        self.output_path = output_path
        self.non_binary = non_binary

    def to_pd(self) -> pd.DataFrame:
        # We always have at least one uniprot feature, if only taxonomy provided we need the organism_id from uniprot
        fetched_uniprot = self.get_uniprot_features(self.headers, self.uniprot_features)

        taxon_counts = self._get_taxon_counts(fetched_uniprot)
        unique_taxons = list(taxon_counts.keys())
        taxonomy_features = self.get_taxonomy_features(
            unique_taxons, self.taxonomy_features
        )

        all_features = self._merge_features(fetched_uniprot, taxonomy_features)

        if self.output_path:
            # Save to file and read back
            if self.non_binary:
                self.save_csv(all_features)
                df = pd.read_csv(self.output_path)
            else:
                self.save_arrow(all_features)
                df = pd.read_parquet(self.output_path)
        else:
            # Create DataFrame directly without saving to file
            df = self._create_dataframe_from_features(all_features)

        if self.user_features:
            columns_to_keep = [df.columns[0]]
            for feature in self.user_features:
                if feature in df.columns:
                    columns_to_keep.append(feature)

            return df[columns_to_keep]
        else:
            return df

    def get_uniprot_features(
        self, headers: List[str], features: List[str]
    ) -> List[ProteinFeatures]:
        uniprot_fetcher = UniProtFeatureRetriever(headers, features)
        return uniprot_fetcher.fetch_features()

    def get_taxonomy_features(self, taxons: List[int], features: List[str]) -> str:
        taxonomy_fetcher = TaxonomyFeatureRetriever(taxons, features)
        return taxonomy_fetcher.fetch_features()

    def _create_dataframe_from_features(self, fetched_uniprot: List[ProteinFeatures]) -> pd.DataFrame:
        """Create DataFrame directly from protein features without saving to file."""
        fetched_uniprot = self._compute_length_bins(fetched_uniprot)

        data_rows = []
        csv_headers = (
            ["identifier"] + list(fetched_uniprot[0].features.keys())
            if fetched_uniprot
            else ["identifier"]
        )

        for protein in fetched_uniprot:
            row = [protein.identifier] + [
                protein.features.get(header, "") for header in csv_headers[1:]
            ]
            modified_row = self._modify_if_needed(row, csv_headers)
            data_rows.append(modified_row)

        df = pd.DataFrame(data_rows, columns=csv_headers)
        return df

    def save_csv(self, fetched_uniprot: List[ProteinFeatures]):
        fetched_uniprot = self._compute_length_bins(fetched_uniprot)

        with open(self.output_path, "w", newline="") as f:
            writer = csv.writer(f)
            csv_headers = (
                ["identifier"] + list(fetched_uniprot[0].features.keys())
                if fetched_uniprot
                else ["identifier"]
            )
            writer.writerow(csv_headers)

            for protein in fetched_uniprot:
                row = [protein.identifier] + [
                    protein.features.get(header, "") for header in csv_headers[1:]
                ]
                modified_row = self._modify_if_needed(row, csv_headers)
                writer.writerow(modified_row)

    def save_arrow(self, fetched_uniprot: List[ProteinFeatures]):
        """Save protein features data in binary parquet format."""
        fetched_uniprot = self._compute_length_bins(fetched_uniprot)

        data_rows = []
        csv_headers = (
            ["identifier"] + list(fetched_uniprot[0].features.keys())
            if fetched_uniprot
            else ["identifier"]
        )

        for protein in fetched_uniprot:
            row = [protein.identifier] + [
                protein.features.get(header, "") for header in csv_headers[1:]
            ]
            modified_row = self._modify_if_needed(row, csv_headers)
            data_rows.append(modified_row)

        df = pd.DataFrame(data_rows, columns=csv_headers)
        df.to_parquet(self.output_path, index=False)

    def _compute_length_bins(
        self, fetched_uniprot: List[ProteinFeatures]
    ) -> List[ProteinFeatures]:
        """Compute length-based binning features for all proteins."""
        lengths = []
        for protein in fetched_uniprot:
            length_str = protein.features.get("length", "")
            if length_str and length_str.isdigit():
                lengths.append(int(length_str))
            else:
                lengths.append(None)

        fixed_bins = self._compute_fixed_bins(lengths)
        quantile_bins = self._compute_quantile_bins(lengths, 10)

        updated_proteins = []
        for i, protein in enumerate(fetched_uniprot):
            updated_features = protein.features.copy()

            updated_features["length_fixed"] = fixed_bins[i]
            updated_features["length_quantile"] = quantile_bins[i]

            del updated_features["length"]

            updated_proteins.append(
                ProteinFeatures(
                    identifier=protein.identifier, features=updated_features
                )
            )

        return updated_proteins

    def _compute_fixed_bins(self, lengths: List[Union[int, None]]) -> List[str]:
        """Compute fixed bins with predefined ranges."""
        fixed_ranges = [
            (0, 50, "<50"),
            (50, 100, "50-100"),
            (100, 200, "100-200"),
            (200, 400, "200-400"),
            (400, 600, "400-600"),
            (600, 800, "600-800"),
            (800, 1000, "800-1000"),
            (1000, 1200, "1000-1200"),
            (1200, 1400, "1200-1400"),
            (1400, 1600, "1400-1600"),
            (1600, 1800, "1600-1800"),
            (1800, 2000, "1800-2000"),
            (2000, float("inf"), "2000+"),
        ]

        bins = []
        for length in lengths:
            if length is None:
                bins.append("unknown")
            else:
                assigned = False
                for min_val, max_val, label in fixed_ranges:
                    if min_val <= length < max_val:
                        bins.append(label)
                        assigned = True
                        break
                if not assigned:
                    bins.append("2000+")

        return bins

    def _compute_quantile_bins(
        self, lengths: List[Union[int, None]], num_bins: int
    ) -> List[str]:
        """Compute quantile-based bins where each bin has approximately the same number of sequences."""
        valid_lengths = [l for l in lengths if l is not None]
        if not valid_lengths:
            return ["unknown"] * len(lengths)

        sorted_lengths = sorted(valid_lengths)

        quantiles = np.linspace(0, 100, num_bins + 1)
        boundaries = np.percentile(sorted_lengths, quantiles)

        unique_boundaries = []
        for i, boundary in enumerate(boundaries):
            if i == 0 or boundary != unique_boundaries[-1]:
                unique_boundaries.append(boundary)

        if len(unique_boundaries) < 2:
            return [
                f"{int(valid_lengths[0])}" if l is not None else "unknown"
                for l in lengths
            ]

        bins = []
        for length in lengths:
            if length is None:
                bins.append("unknown")
            else:
                bin_index = np.searchsorted(unique_boundaries[1:], length, side="right")
                bin_index = min(
                    bin_index, len(unique_boundaries) - 2
                )  # Ensure we don't go out of bounds

                bin_start = int(unique_boundaries[bin_index])
                bin_end = int(unique_boundaries[bin_index + 1])

                if bin_index == len(unique_boundaries) - 2:
                    # Last bin - include the maximum value
                    bins.append(f"{bin_start}-{bin_end}")
                else:
                    # All other bins are right-exclusive
                    bins.append(f"{bin_start}-{bin_end - 1}")

        return bins

    def _get_taxon_counts(self, fetched_uniprot: List[ProteinFeatures]) -> dict:
        """Returns a dictionary with organism IDs as keys and their occurrence counts as values."""
        id_counts = {}

        for protein in fetched_uniprot:
            organism_id = protein.features.get("organism_id")
            if organism_id:
                org_id = int(organism_id)
                id_counts[org_id] = id_counts.get(org_id, 0) + 1

        return id_counts

    def _modify_if_needed(self, row: List, csv_headers: List) -> List:
        modified_row = row.copy()

        if "annotation_score" in csv_headers:
            idx = csv_headers.index("annotation_score")
            if idx < len(row) and row[idx]:
                try:
                    modified_row[idx] = str(int(float(row[idx])))
                except (ValueError, TypeError):
                    pass

        if "protein_families" in csv_headers:
            idx = csv_headers.index("protein_families")
            if idx < len(row) and row[idx]:
                protein_families_value = str(row[idx])

                if "," in protein_families_value:
                    modified_row[idx] = protein_families_value.split(",")[0].strip()
                elif ";" in protein_families_value:
                    modified_row[idx] = protein_families_value.split(";")[0].strip()
                else:
                    modified_row[idx] = protein_families_value

        return modified_row

    def _initialize_features(
        self, features: List[str]
    ) -> Tuple[List[str], Union[List[str], None]]:
        """
        Separates features into UniProt and Taxonomy features.
        """
        # If user specified features, only use those (plus required ones)
        if self.user_features:
            uniprot_features = [
                feature for feature in features if feature in UNIPROT_FEATURES
            ]
            taxonomy_features = [
                feature for feature in features if feature in TAXONOMY_FEATURES
            ]
            
            # Check if user requested length binning features
            user_has_length_features = any(
                feature in self.user_features for feature in LENGTH_BINNING_FEATURES
            )
            
            # If user requested length features, we need the length feature from UniProt
            if user_has_length_features and "length" not in uniprot_features:
                uniprot_features.append("length")

            uniprot_features = self._modify_uniprot_features(uniprot_features)

            # We have taxonomy, so we need the organism_ids in uniprot_features
            if taxonomy_features:
                return uniprot_features, taxonomy_features
            else:
                return uniprot_features, None
        
        # No user features specified, use defaults
        uniprot_features = [
            feature for feature in features if feature in UNIPROT_FEATURES
        ]
        taxonomy_features = [
            feature for feature in features if feature in TAXONOMY_FEATURES
        ]

        uniprot_features = self._modify_uniprot_features(uniprot_features)

        # We have taxonomy, so we need the organism_ids in uniprot_features
        if taxonomy_features:
            return uniprot_features, taxonomy_features

        # We have other features than the needed ones
        elif len(uniprot_features) > len(NEEDED_UNIPROT_FEATURES):
            return uniprot_features, None

        else:
            logger.info("No features provided, using default UniProt features")
            return UNIPROT_FEATURES, None

    def _validate_features(
        self,
        user_features: List[str],
        all_features: List[str] = DEFAULT_FEATURES + LENGTH_BINNING_FEATURES,
    ) -> str:
        """
        Checks if the user provided features which are available.
        """
        if user_features is None:
            return None

        for feature in user_features:
            if feature not in all_features:
                raise ValueError(
                    f"Feature {feature} is not a valid feature. Valid features are: {all_features}"
                )

        return user_features

    def _modify_uniprot_features(self, features: List[str]) -> List[str]:
        filtered_features = [f for f in features if f not in NEEDED_UNIPROT_FEATURES]
        return NEEDED_UNIPROT_FEATURES + filtered_features

    def _merge_features(
        self, fetched_uniprot: List[ProteinFeatures], taxonomy_features: dict
    ) -> List[ProteinFeatures]:
        merged_features = []

        # First, we'll analyze taxonomy features to find the top 9 most frequent values for each feature
        feature_value_counts = {}

        # Collect all values for each taxonomy feature
        for org_id, tax_data in taxonomy_features.items():
            for feature_name, feature_value in tax_data["features"].items():
                if feature_name not in feature_value_counts:
                    feature_value_counts[feature_name] = {}

                if feature_value not in feature_value_counts[feature_name]:
                    feature_value_counts[feature_name][feature_value] = 0

                feature_value_counts[feature_name][feature_value] += 1

        # Determine top 9 values for each feature
        top_values = {}
        for feature_name, counts in feature_value_counts.items():
            # Sort values by count (descending) and take top 9
            sorted_values = sorted(counts.items(), key=lambda x: x[1], reverse=True)
            top_values[feature_name] = {val[0] for val in sorted_values[:9]}

        # Process each protein
        for protein in fetched_uniprot:
            organism_id = protein.features.get("organism_id")

            # Create a copy of the protein to avoid modifying the original
            updated_protein = ProteinFeatures(
                identifier=protein.identifier, features=protein.features.copy()
            )

            # If this organism_id has taxonomy features, add them to the protein
            if organism_id and int(organism_id) in taxonomy_features:
                tax_features = taxonomy_features[int(organism_id)]["features"]

                # Add each taxonomy feature to the protein features
                for feature_name, feature_value in tax_features.items():
                    # Check if this value is in the top 9 for this feature
                    if (
                        feature_name in top_values
                        and feature_value in top_values[feature_name]
                    ):
                        updated_protein.features[feature_name] = feature_value
                    else:
                        updated_protein.features[feature_name] = "other"

            merged_features.append(updated_protein)

        return merged_features
