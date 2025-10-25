import csv
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from protspace.data.feature_retrievers.interpro_feature_retriever import (
    INTERPRO_FEATURES,
    InterProFeatureRetriever,
)
from protspace.data.feature_retrievers.taxonomy_feature_retriever import (
    TAXONOMY_FEATURES,
    TaxonomyFeatureRetriever,
)
from protspace.data.feature_retrievers.uniprot_feature_retriever import (
    UNIPROT_FEATURES,
    ProteinFeatures,
    UniProtFeatureRetriever,
)

logging.basicConfig(format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_FEATURES = UNIPROT_FEATURES + TAXONOMY_FEATURES + INTERPRO_FEATURES
NEEDED_UNIPROT_FEATURES = ["accession", "organism_id"]
LENGTH_BINNING_FEATURES = ["length_fixed", "length_quantile"]


class ProteinFeatureExtractor:
    def __init__(
        self,
        headers: list[str],
        features: list = None,
        output_path: Path = None,
        non_binary: bool = False,
        sequences: dict = None,
    ):
        self.headers = headers
        self.user_features = self._validate_features(features) if features else None
        self.uniprot_features, self.taxonomy_features, self.interpro_features = (
            self._initialize_features(DEFAULT_FEATURES)
        )
        self.output_path = output_path
        self.non_binary = non_binary
        self.sequences = sequences  # Needed for InterPro MD5 calculation

    def to_pd(self) -> pd.DataFrame:
        # Track which feature sources failed
        failed_sources = []

        # We always have at least one uniprot feature, if only taxonomy provided we need the organism_id from uniprot
        fetched_uniprot = []
        try:
            fetched_uniprot = self.get_uniprot_features(
                self.headers, self.uniprot_features
            )
        except Exception as e:
            failed_sources.append(f"UniProt ({str(e)})")
            logger.warning(f"Failed to retrieve UniProt features: {e}")
            # Create minimal feature set with just identifiers
            fetched_uniprot = [
                ProteinFeatures(identifier=header, features={"organism_id": ""})
                for header in self.headers
            ]

        taxon_counts = self._get_taxon_counts(fetched_uniprot)
        unique_taxons = list(taxon_counts.keys())
        taxonomy_features = {}
        if self.taxonomy_features:
            taxonomy_features = self.get_taxonomy_features(
                unique_taxons, self.taxonomy_features
            )
            # Check if taxonomy retrieval failed (returns empty dict on error)
            if not taxonomy_features and unique_taxons:
                failed_sources.append("Taxonomy")

        # Fetch InterPro features if requested
        interpro_features = []
        if self.interpro_features:
            try:
                # Extract sequences from UniProt data for InterPro MD5 calculation
                sequences = {}
                for protein in fetched_uniprot:
                    if "sequence" in protein.features and protein.features["sequence"]:
                        sequences[protein.identifier] = protein.features["sequence"]

                # Update self.sequences for InterPro retrieval
                self.sequences = sequences
                interpro_features = self.get_interpro_features(
                    self.headers, self.interpro_features
                )
            except Exception as e:
                failed_sources.append(f"InterPro ({str(e)})")
                logger.warning(f"Failed to retrieve InterPro features: {e}")

        # Report failed sources
        if failed_sources:
            logger.warning(
                f"Could not retrieve features from the following sources: {', '.join(failed_sources)}"
            )

        all_features = self._merge_features(
            fetched_uniprot, taxonomy_features, interpro_features
        )

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

        # Always remove organism_id from final output (it's only needed internally)
        if "organism_id" in df.columns:
            df = df.drop(columns=["organism_id"])

        if self.user_features:
            columns_to_keep = [df.columns[0]]
            for feature in self.user_features:
                if feature in df.columns:
                    columns_to_keep.append(feature)

            return df[columns_to_keep]
        else:
            # Filter out sequence if it was auto-added for InterPro but not explicitly requested
            if self.interpro_features and "sequence" in df.columns:
                # Check if sequence was explicitly requested by user
                if not self.user_features or "sequence" not in self.user_features:
                    df = df.drop(columns=["sequence"])
            return df

    def get_uniprot_features(
        self, headers: list[str], features: list[str]
    ) -> list[ProteinFeatures]:
        uniprot_fetcher = UniProtFeatureRetriever(headers, features)
        return uniprot_fetcher.fetch_features()

    def get_taxonomy_features(self, taxons: list[int], features: list[str]) -> str:
        try:
            taxonomy_fetcher = TaxonomyFeatureRetriever(taxons, features)
            return taxonomy_fetcher.fetch_features()
        except Exception as e:
            logger.warning(
                "Skipping taxonomy features due to initialization/fetch error: %s",
                str(e),
            )
            # Return an empty mapping so later merge logic treats taxonomy as absent
            return {}

    def get_interpro_features(
        self, headers: list[str], features: list[str]
    ) -> list[ProteinFeatures]:
        interpro_fetcher = InterProFeatureRetriever(headers, features, self.sequences)
        return interpro_fetcher.fetch_features()

    def _create_dataframe_from_features(
        self, fetched_uniprot: list[ProteinFeatures]
    ) -> pd.DataFrame:
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

    def save_csv(self, fetched_uniprot: list[ProteinFeatures]):
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

    def save_arrow(self, fetched_uniprot: list[ProteinFeatures]):
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
        self, fetched_uniprot: list[ProteinFeatures]
    ) -> list[ProteinFeatures]:
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

    def _compute_fixed_bins(self, lengths: list[int | None]) -> list[str]:
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
        self, lengths: list[int | None], num_bins: int
    ) -> list[str]:
        """Compute quantile-based bins where each bin has approximately the same number of sequences."""
        valid_lengths = [length for length in lengths if length is not None]
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
                f"{int(valid_lengths[0])}" if length is not None else "unknown"
                for length in lengths
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

    def _get_taxon_counts(self, fetched_uniprot: list[ProteinFeatures]) -> dict:
        """Returns a dictionary with organism IDs as keys and their occurrence counts as values."""
        id_counts = {}

        for protein in fetched_uniprot:
            organism_id = protein.features.get("organism_id")
            if organism_id:
                org_id = int(organism_id)
                id_counts[org_id] = id_counts.get(org_id, 0) + 1

        return id_counts

    def _modify_if_needed(self, row: list, csv_headers: list) -> list:
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

        # pfam is already handled correctly by InterPro retriever (semicolon-separated, sorted)
        # No additional processing needed

        if "cath" in csv_headers:
            idx = csv_headers.index("cath")
            if idx < len(row) and row[idx]:
                cath_value = str(row[idx])
                # Split by semicolon, strip G3DSA: prefix from each value, sort
                cath_values = cath_value.split(";")
                cleaned = [
                    v.replace("G3DSA:", "").strip() for v in cath_values if v.strip()
                ]
                modified_row[idx] = ";".join(sorted(cleaned))

        if "cc_subcellular_location" in csv_headers:
            idx = csv_headers.index("cc_subcellular_location")
            if idx < len(row) and row[idx]:
                # Already in clean semicolon-separated format from new parser
                # No processing needed, keep as is
                modified_row[idx] = str(row[idx])

        if "fragment" in csv_headers:
            idx = csv_headers.index("fragment")
            if idx < len(row) and row[idx]:
                fragment_value = str(row[idx]).strip().lower()
                if fragment_value == "fragment":
                    modified_row[idx] = "yes"

        if "reviewed" in csv_headers:
            idx = csv_headers.index("reviewed")
            if idx < len(row) and row[idx]:
                reviewed_value = str(row[idx]).strip().lower()
                if reviewed_value == "reviewed":
                    modified_row[idx] = "Swiss-Prot"
                elif reviewed_value == "unreviewed":
                    modified_row[idx] = "TrEMBL"

        if "signal_peptide" in csv_headers:
            idx = csv_headers.index("signal_peptide")
            if idx < len(row) and row[idx]:
                signal_peptide_value = str(row[idx])
                if "SIGNAL_PEPTIDE" in signal_peptide_value:
                    modified_row[idx] = "True"
                else:
                    modified_row[idx] = "False"
            else:
                # If the value is empty or doesn't exist, set to False
                modified_row[idx] = "False"

        return modified_row

    def _initialize_features(
        self, features: list[str]
    ) -> tuple[list[str], list[str] | None, list[str] | None]:
        """
        Separates features into UniProt, Taxonomy, and InterPro features.
        """
        # If user specified features, only use those (plus required ones)
        if self.user_features:
            uniprot_features = [
                feature for feature in features if feature in UNIPROT_FEATURES
            ]
            taxonomy_features = [
                feature for feature in features if feature in TAXONOMY_FEATURES
            ]
            interpro_features = [
                feature for feature in features if feature in INTERPRO_FEATURES
            ]

            # Check if user requested length binning features
            user_has_length_features = any(
                feature in self.user_features for feature in LENGTH_BINNING_FEATURES
            )

            # If user requested length features, we need the length feature from UniProt
            if user_has_length_features and "length" not in uniprot_features:
                uniprot_features.append("length")

            uniprot_features = self._modify_uniprot_features(
                uniprot_features, interpro_features
            )

            # We have taxonomy, so we need the organism_ids in uniprot_features
            if taxonomy_features or interpro_features:
                return (
                    uniprot_features,
                    taxonomy_features if taxonomy_features else None,
                    interpro_features if interpro_features else None,
                )
            else:
                return uniprot_features, None, None

        # No user features specified, use defaults
        uniprot_features = [
            feature for feature in features if feature in UNIPROT_FEATURES
        ]
        taxonomy_features = [
            feature for feature in features if feature in TAXONOMY_FEATURES
        ]
        interpro_features = [
            feature for feature in features if feature in INTERPRO_FEATURES
        ]

        uniprot_features = self._modify_uniprot_features(
            uniprot_features, interpro_features
        )

        # We have taxonomy or interpro features, so we need the organism_ids in uniprot_features
        if taxonomy_features or interpro_features:
            return (
                uniprot_features,
                taxonomy_features if taxonomy_features else None,
                interpro_features if interpro_features else None,
            )

        # We have other features than the needed ones
        elif len(uniprot_features) > len(NEEDED_UNIPROT_FEATURES):
            return uniprot_features, None, None

        else:
            logger.info("No features provided, using default UniProt features")
            return UNIPROT_FEATURES, None, None

    def _validate_features(
        self,
        user_features: list[str],
        all_features: list[str] = DEFAULT_FEATURES + LENGTH_BINNING_FEATURES,
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

    def _modify_uniprot_features(
        self, features: list[str], interpro_features: list[str] = None
    ) -> list[str]:
        filtered_features = [f for f in features if f not in NEEDED_UNIPROT_FEATURES]
        result = NEEDED_UNIPROT_FEATURES + filtered_features

        # Always include sequence if InterPro features are requested (needed for MD5 calculation)
        if interpro_features and "sequence" not in result:
            result.append("sequence")

        return result

    def _merge_features(
        self,
        fetched_uniprot: list[ProteinFeatures],
        taxonomy_features: dict,
        interpro_features: list[ProteinFeatures] = None,
    ) -> list[ProteinFeatures]:
        merged_features = []

        # Create a mapping from identifier to InterPro features for efficient lookup
        interpro_dict = {}
        if interpro_features:
            for interpro_protein in interpro_features:
                interpro_dict[interpro_protein.identifier] = interpro_protein.features

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

                # Add each taxonomy feature to the protein features directly
                for feature_name, feature_value in tax_features.items():
                    updated_protein.features[feature_name] = feature_value

            # Add InterPro features if available for this protein
            if protein.identifier in interpro_dict:
                interpro_data = interpro_dict[protein.identifier]
                for feature_name, feature_value in interpro_data.items():
                    updated_protein.features[feature_name] = feature_value

            merged_features.append(updated_protein)

        return merged_features
