"""
UniProt JSON Parser - Extract data from UniProt API responses.

AVAILABLE PROPERTIES:
=====================
entry                    - Primary UniProt accession number
entry_name               - UniProtKB entry name (e.g., 'P53_HUMAN')
gene_primary             - Primary gene name
organism_name            - Organism scientific name
organism_id              - NCBI Taxonomy ID
protein_name             - Recommended protein name
xref_proteomes           - Proteome identifiers (list)
lineage                  - Taxonomic lineage (list)
virus_hosts              - Virus host information (list)
sequence                 - Amino acid sequence
length                   - Sequence length in amino acids
mass                     - Molecular weight in Daltons
fragment                 - Fragment type (if sequence is partial)
ft_non_adj               - Non-adjacent residues (list)
ft_non_std               - Non-standard residues (list)
ft_non_ter               - Non-terminal residues
annotation_score         - Annotation quality score (1-5)
keyword                  - Keyword names (list)
keyword_id               - Keyword IDs (list)
protein_existence        - Protein existence level
reviewed                 - True if Swiss-Prot (reviewed), False if TrEMBL
uniparc_id               - UniParc identifier
cc_subcellular_location  - Subcellular location values (list)
protein_families         - Protein family description
ec                       - EC numbers (list)
go                       - All Gene Ontology terms (list of dicts)
go_p                     - GO Biological Process terms (list)
go_f                     - GO Molecular Function terms (list)
go_c                     - GO Cellular Component terms (list)
go_id                    - GO term IDs only (list)
date_created             - Entry creation date
date_modified            - Last modification date
date_sequence_modified   - Last sequence modification date
version                  - Entry version number
ft_disulfid              - Disulfide bond features (list)
ft_glycosylation         - Glycosylation features (list)
ft_lipidation            - Lipidation features (list)
ft_mod_res               - Modified residue features (list)
ft_signal                - Signal peptide features
xref_pdb                 - PDB cross-references (list)
"""

from typing import Any

import pandas as pd
from unipressed import UniprotkbClient

# List of all available properties for validation
AVAILABLE_PROPERTIES = [
    "entry",
    "entry_name",
    "gene_primary",
    "organism_name",
    "organism_id",
    "protein_name",
    "xref_proteomes",
    "lineage",
    "virus_hosts",
    "sequence",
    "length",
    "mass",
    "fragment",
    "ft_non_adj",
    "ft_non_std",
    "ft_non_ter",
    "annotation_score",
    "keyword",
    "keyword_id",
    "protein_existence",
    "reviewed",
    "uniparc_id",
    "cc_subcellular_location",
    "protein_families",
    "ec",
    "go",
    "go_p",
    "go_f",
    "go_c",
    "go_id",
    "date_created",
    "date_modified",
    "date_sequence_modified",
    "version",
    "ft_disulfid",
    "ft_glycosylation",
    "ft_lipidation",
    "ft_mod_res",
    "ft_signal",
    "xref_pdb",
]


class UniProtEntry:
    """Parser for UniProt JSON entries from the REST API."""

    def __init__(self, data: dict[str, Any]) -> None:
        """Initialize with raw JSON data from UniProt API."""
        self.data = data

    # --- Names & Taxonomy ---

    @property
    def entry(self) -> str:
        """Primary UniProt accession number."""
        return self.data.get("primaryAccession", "")

    @property
    def entry_name(self) -> str:
        """UniProtKB entry name (e.g., 'P53_HUMAN')."""
        return self.data.get("uniProtkbId", "")

    @property
    def gene_primary(self) -> str:
        """Primary gene name."""
        genes = self.data.get("genes", [])
        if genes and "geneName" in genes[0]:
            return genes[0]["geneName"].get("value", "")
        return ""

    @property
    def organism_name(self) -> str:
        """Organism scientific name."""
        return self.data.get("organism", {}).get("scientificName", "")

    @property
    def organism_id(self) -> int:
        """NCBI Taxonomy ID."""
        return self.data.get("organism", {}).get("taxonId", 0)

    @property
    def protein_name(self) -> str:
        """Recommended protein name."""
        desc = self.data.get("proteinDescription", {})
        rec_name = desc.get("recommendedName", {})
        full_name = rec_name.get("fullName", {})
        return full_name.get("value", "")

    @property
    def xref_proteomes(self) -> list[str]:
        """Proteome identifiers."""
        proteomes = self.get_cross_references("Proteomes")
        return [p.get("id", "") for p in proteomes]

    @property
    def lineage(self) -> list[str]:
        """Taxonomic lineage."""
        return self.data.get("organism", {}).get("lineage", [])

    @property
    def virus_hosts(self) -> list[str]:
        """Virus host information."""
        hosts = self.data.get("organismHosts", [])
        return [host.get("scientificName", "") for host in hosts]

    # --- Sequence ---

    @property
    def sequence(self) -> str:
        """Amino acid sequence."""
        return self.data.get("sequence", {}).get("value", "")

    @property
    def length(self) -> int:
        """Sequence length in amino acids."""
        return self.data.get("sequence", {}).get("length", 0)

    @property
    def mass(self) -> int:
        """Molecular weight in Daltons."""
        return self.data.get("sequence", {}).get("molWeight", 0)

    @property
    def fragment(self) -> str:
        """Fragment type (if sequence is partial)."""
        return self.data.get("sequence", {}).get("fragment", "")

    @property
    def ft_non_adj(self) -> list[str]:
        """Non-adjacent residues."""
        features = self.get_features("Non-adjacent residues")
        return [
            f"{f['location']['start']['value']}-{f['location']['end']['value']}"
            for f in features
        ]

    @property
    def ft_non_std(self) -> list[int]:
        """Non-standard residues."""
        features = self.get_features("Non-standard residue")
        return [f["location"]["start"]["value"] for f in features]

    @property
    def ft_non_ter(self) -> int | None:
        """Non-terminal residues."""
        features = self.get_features("Non-terminal residue")
        if features:
            return features[0]["location"]["start"]["value"]
        return None

    # --- Miscellaneous ---

    @property
    def annotation_score(self) -> float:
        """Annotation quality score (1-5)."""
        return self.data.get("annotationScore", 0.0)

    @property
    def keyword(self) -> list[str]:
        """Keyword names."""
        keywords = self.data.get("keywords", [])
        return [kw.get("name", "") for kw in keywords]

    @property
    def keyword_id(self) -> list[str]:
        """Keyword IDs."""
        keywords = self.data.get("keywords", [])
        return [kw.get("id", "") for kw in keywords]

    @property
    def protein_existence(self) -> str:
        """Protein existence level."""
        return self.data.get("proteinExistence", "")

    @property
    def reviewed(self) -> bool:
        """True if Swiss-Prot (reviewed), False if TrEMBL."""
        entry_type = self.data.get("entryType", "").lower()
        return "reviewed" in entry_type or "swiss-prot" in entry_type

    @property
    def uniparc_id(self) -> str:
        """UniParc identifier."""
        return self.data.get("extraAttributes", {}).get("uniParcId", "")

    # --- Subcellular Location ---

    @property
    def cc_subcellular_location(self) -> list[str]:
        """Subcellular location values."""
        comments = self.get_comments("SUBCELLULAR LOCATION")
        locations = []
        for comment in comments:
            for subloc in comment.get("subcellularLocations", []):
                loc = subloc.get("location", {})
                value = loc.get("value", "")
                if value:
                    locations.append(value)
        return locations

    # --- Family & Domains ---

    @property
    def protein_families(self) -> str:
        """Protein family description."""
        comments = self.get_comments("SIMILARITY")
        for comment in comments:
            for text in comment.get("texts", []):
                value = text.get("value", "")
                prefix = "Belongs to the "
                if value.startswith(prefix):
                    return value[len(prefix) :]
                return value
        return ""

    # --- Function ---

    @property
    def ec(self) -> list[str]:
        """EC numbers."""
        desc = self.data.get("proteinDescription", {})
        ec_numbers = desc.get("recommendedName", {}).get("ecNumbers", [])
        for alt in desc.get("alternativeNames", []):
            ec_numbers.extend(alt.get("ecNumbers", []))
        return [ec.get("value", "") for ec in ec_numbers]

    # --- Gene Ontology ---

    @property
    def go(self) -> list[dict[str, str]]:
        """All Gene Ontology terms."""
        return self.get_go_terms()

    @property
    def go_p(self) -> list[str]:
        """GO Biological Process terms."""
        return [term["term"] for term in self.get_go_terms(aspect="P")]

    @property
    def go_f(self) -> list[str]:
        """GO Molecular Function terms."""
        return [term["term"] for term in self.get_go_terms(aspect="F")]

    @property
    def go_c(self) -> list[str]:
        """GO Cellular Component terms."""
        return [term["term"] for term in self.get_go_terms(aspect="C")]

    @property
    def go_id(self) -> list[str]:
        """GO term IDs only."""
        return [term["id"] for term in self.get_go_terms()]

    # --- Dates & Versions ---

    @property
    def date_created(self) -> str:
        """Entry creation date."""
        return self.data.get("entryAudit", {}).get("firstPublicDate", "")

    @property
    def date_modified(self) -> str:
        """Last modification date."""
        return self.data.get("entryAudit", {}).get("lastAnnotationUpdateDate", "")

    @property
    def date_sequence_modified(self) -> str:
        """Last sequence modification date."""
        return self.data.get("entryAudit", {}).get("lastSequenceUpdateDate", "")

    @property
    def version(self) -> int:
        """Entry version number."""
        return self.data.get("entryAudit", {}).get("entryVersion", 0)

    # --- PTM / Processing ---

    @property
    def ft_disulfid(self) -> list[str]:
        """Disulfide bond features."""
        bonds = self.get_features("Disulfide bond")
        return [
            f"{b['location']['start']['value']}-{b['location']['end']['value']}"
            for b in bonds
        ]

    @property
    def ft_glycosylation(self) -> list[dict[int, str]]:
        """Glycosylation features."""
        features = self.get_features("Glycosylation")
        return [
            {int(f["location"]["start"]["value"]): f.get("description", "")}
            for f in features
        ]

    @property
    def ft_lipidation(self) -> list[dict[int, str]]:
        """Lipidation features."""
        features = self.get_features("Lipidation")
        return [
            {int(f["location"]["start"]["value"]): f.get("description", "")}
            for f in features
        ]

    @property
    def ft_mod_res(self) -> list[dict[int, str]]:
        """Modified residue features."""
        features = self.get_features("Modified residue")
        return [
            {int(f["location"]["start"]["value"]): f.get("description", "")}
            for f in features
        ]

    @property
    def ft_signal(self) -> str:
        """Signal peptide features."""
        features = self.get_features("Signal")
        if features:
            loc = features[0]["location"]
            return f"{loc['start']['value']}-{loc['end']['value']}"
        return ""

    # --- External: 3D Structure ---

    @property
    def xref_pdb(self) -> list[str]:
        """PDB cross-references."""
        return [f["id"] for f in self.get_cross_references("PDB")]

    # --- Core Methods ---

    def get_features(self, feature_type: str | None = None) -> list[dict[str, Any]]:
        """Get features, optionally filtered by type."""
        features = self.data.get("features", [])
        if feature_type:
            return [f for f in features if f.get("type") == feature_type]
        return features

    def get_comments(self, comment_type: str | None = None) -> list[dict[str, Any]]:
        """Get comments, optionally filtered by type."""
        comments = self.data.get("comments", [])
        if comment_type:
            return [c for c in comments if c.get("commentType") == comment_type]
        return comments

    def get_cross_references(self, database: str | None = None) -> list[dict[str, Any]]:
        """Get cross-references, optionally filtered by database."""
        xrefs = self.data.get("uniProtKBCrossReferences", [])
        if database:
            return [x for x in xrefs if x.get("database") == database]
        return xrefs

    def get_go_terms(self, aspect: str | None = None) -> list[dict[str, str]]:
        """Get GO terms, optionally filtered by aspect (P/F/C)."""
        go_refs = self.get_cross_references("GO")
        result = []
        for go in go_refs:
            props = {p["key"]: p["value"] for p in go.get("properties", [])}
            term = {
                "id": go.get("id", ""),
                "term": props.get("GoTerm", ""),
                "evidence": props.get("GoEvidenceType", ""),
            }
            if aspect:
                if term["term"].startswith(f"{aspect}:"):
                    result.append(term)
            else:
                result.append(term)
        return result

    def __repr__(self) -> str:
        """String representation."""
        return f"UniProtEntry({self.entry})"


def fetch_uniprot_data(
    accessions: list[str], properties: list[str] | None = None
) -> pd.DataFrame:
    """
    Fetch UniProt entries and extract specified properties into a DataFrame.

    Args:
        accessions: List of UniProt accession numbers
        properties: List of property names to extract. If None, extracts all available.
                    Use AVAILABLE_PROPERTIES to see all options.

    Returns:
        DataFrame with one row per accession and columns for each property

    Example:
        >>> df = fetch_uniprot_data(
        ...     ["P04637", "P53_HUMAN"],
        ...     properties=["entry", "protein_name", "organism_name", "length"]
        ... )
    """

    # Validate properties
    if properties is None:
        properties = AVAILABLE_PROPERTIES
    else:
        invalid = [p for p in properties if p not in AVAILABLE_PROPERTIES]
        if invalid:
            raise ValueError(
                f"Invalid properties: {invalid}. Available: {AVAILABLE_PROPERTIES}"
            )

    # Fetch records
    records = UniprotkbClient.fetch_many(accessions)
    entries = [UniProtEntry(record) for record in records]

    # Extract properties
    data = []
    for entry in entries:
        row = {}
        for prop in properties:
            try:
                row[prop] = getattr(entry, prop)
            except (KeyError, AttributeError, IndexError):
                row[prop] = None
        data.append(row)

    return pd.DataFrame(data)
