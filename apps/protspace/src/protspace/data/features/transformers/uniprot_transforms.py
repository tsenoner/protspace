"""
UniProt-specific feature transformations.

This module contains transformations for UniProt features to convert
raw values into user-friendly formats.
"""


class UniProtTransformer:
    """Transformations for UniProt-specific features."""

    @staticmethod
    def transform_annotation_score(value: str) -> str:
        """
        Convert float annotation score to integer string.

        Args:
            value: Annotation score as string (e.g., "5.0")

        Returns:
            Integer string (e.g., "5")
        """
        if not value:
            return value

        try:
            return str(int(float(value)))
        except (ValueError, TypeError):
            return value

    @staticmethod
    def transform_protein_families(value: str) -> str:
        """
        Extract first family (before comma/semicolon).

        Args:
            value: Protein families string (may contain multiple families)

        Returns:
            First family only
        """
        if not value:
            return value

        protein_families_value = str(value)

        if "," in protein_families_value:
            return protein_families_value.split(",")[0].strip()
        elif ";" in protein_families_value:
            return protein_families_value.split(";")[0].strip()
        else:
            return protein_families_value

    @staticmethod
    def transform_reviewed(value: str) -> str:
        """
        Convert boolean to Swiss-Prot/TrEMBL.

        Args:
            value: Boolean as string ("true"/"false") or old format ("reviewed"/"unreviewed")

        Returns:
            "Swiss-Prot" for reviewed, "TrEMBL" for unreviewed
        """
        if not value:
            return value

        value_lower = str(value).strip().lower()

        if value_lower in ["reviewed", "true"]:
            return "Swiss-Prot"
        elif value_lower in ["unreviewed", "false"]:
            return "TrEMBL"

        return value

    @staticmethod
    def transform_xref_pdb(value: str) -> str:
        """
        Convert PDB IDs to True/False.

        Args:
            value: PDB IDs (semicolon-separated) or empty string

        Returns:
            "True" if PDB structures exist, "False" otherwise
        """
        if value and str(value).strip():
            return "True"
        return "False"

    @staticmethod
    def transform_fragment(value: str) -> str:
        """
        Convert 'fragment' to 'yes'.

        Args:
            value: Fragment status string

        Returns:
            "yes" if fragment, original value otherwise
        """
        if not value:
            return value

        if str(value).strip().lower() == "fragment":
            return "yes"

        return value

    @staticmethod
    def transform_cc_subcellular_location(value: str) -> str:
        """
        Keep subcellular location as semicolon-separated values.

        This is a pass-through as the new parser already provides clean format.

        Args:
            value: Semicolon-separated location values

        Returns:
            Original value (already in correct format)
        """
        return str(value) if value else ""
