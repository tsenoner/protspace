"""
Length binning operations for protein sequences.

This module provides functionality to bin protein lengths into fixed and quantile-based categories.
"""

from collections import namedtuple

import numpy as np

ProteinFeatures = namedtuple("ProteinFeatures", ["identifier", "features"])


class LengthBinner:
    """Handles protein length binning operations."""

    def add_bins(self, proteins: list[ProteinFeatures]) -> list[ProteinFeatures]:
        """
        Add length_fixed and length_quantile bins, remove length field.

        Args:
            proteins: List of ProteinFeatures with 'length' field

        Returns:
            Updated list of ProteinFeatures with length bins added and length removed
        """
        lengths = self._extract_lengths(proteins)
        fixed_bins = self.compute_fixed_bins(lengths)
        quantile_bins = self.compute_quantile_bins(lengths, num_bins=10)

        return self._update_proteins_with_bins(proteins, fixed_bins, quantile_bins)

    @staticmethod
    def _extract_lengths(proteins: list[ProteinFeatures]) -> list[int | None]:
        """Extract length values from protein features."""
        lengths = []
        for protein in proteins:
            length_str = protein.features.get("length", "")
            if length_str and str(length_str).isdigit():
                lengths.append(int(length_str))
            else:
                lengths.append(None)
        return lengths

    @staticmethod
    def _update_proteins_with_bins(
        proteins: list[ProteinFeatures], fixed_bins: list[str], quantile_bins: list[str]
    ) -> list[ProteinFeatures]:
        """Update proteins with bin values and remove length field."""
        updated_proteins = []
        for i, protein in enumerate(proteins):
            updated_features = protein.features.copy()

            updated_features["length_fixed"] = fixed_bins[i]
            updated_features["length_quantile"] = quantile_bins[i]

            # Remove original length field
            if "length" in updated_features:
                del updated_features["length"]

            updated_proteins.append(
                ProteinFeatures(
                    identifier=protein.identifier, features=updated_features
                )
            )

        return updated_proteins

    @staticmethod
    def compute_fixed_bins(lengths: list[int | None]) -> list[str]:
        """
        Compute fixed bins with predefined ranges.

        Args:
            lengths: List of protein lengths (None for unknown)

        Returns:
            List of bin labels for each length
        """
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

    @staticmethod
    def compute_quantile_bins(
        lengths: list[int | None], num_bins: int = 10
    ) -> list[str]:
        """
        Compute quantile-based bins where each bin has approximately the same number of sequences.

        Args:
            lengths: List of protein lengths (None for unknown)
            num_bins: Number of quantile bins to create

        Returns:
            List of bin labels for each length (e.g., "100-199")
        """
        valid_lengths = [length for length in lengths if length is not None]
        if not valid_lengths:
            return ["unknown"] * len(lengths)

        sorted_lengths = sorted(valid_lengths)

        quantiles = np.linspace(0, 100, num_bins + 1)
        boundaries = np.percentile(sorted_lengths, quantiles)

        # Remove duplicate boundaries
        unique_boundaries = []
        for i, boundary in enumerate(boundaries):
            if i == 0 or boundary != unique_boundaries[-1]:
                unique_boundaries.append(boundary)

        # Handle case where all lengths are the same
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
