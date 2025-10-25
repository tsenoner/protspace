"""
InterPro-specific feature transformations.

This module contains transformations for InterPro features to convert
raw values into user-friendly formats.
"""


class InterProTransformer:
    """Transformations for InterPro-specific features."""

    @staticmethod
    def transform_cath(value: str) -> str:
        """
        Clean CATH IDs (remove G3DSA: prefix, sort).

        Args:
            value: CATH IDs (semicolon-separated with G3DSA: prefix)

        Returns:
            Cleaned and sorted CATH IDs (semicolon-separated)
        """
        if not value:
            return value

        cath_value = str(value)
        # Split by semicolon, strip G3DSA: prefix from each value, sort
        cath_values = cath_value.split(";")
        cleaned = [v.replace("G3DSA:", "").strip() for v in cath_values if v.strip()]
        return ";".join(sorted(cleaned))

    @staticmethod
    def transform_signal_peptide(value: str) -> str:
        """
        Convert signal peptide annotation to True/False.

        Args:
            value: Signal peptide annotation string

        Returns:
            "True" if signal peptide present, "False" otherwise
        """
        if not value:
            return "False"

        if "SIGNAL_PEPTIDE" in str(value):
            return "True"

        return "False"

    @staticmethod
    def transform_pfam(value: str) -> str:
        """
        Keep Pfam IDs as semicolon-separated values.

        Pfam is already handled correctly by InterPro retriever (semicolon-separated, sorted).
        This is a pass-through function.

        Args:
            value: Semicolon-separated Pfam IDs

        Returns:
            Original value (already in correct format)
        """
        return str(value) if value else ""
