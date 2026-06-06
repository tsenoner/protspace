<!--
  AUTO-GENERATED — do not edit by hand.
  Source: packages/utils/src/visualization/annotation-metadata.ts
  Regenerate: pnpm docs:annotations
-->

# Annotation Reference

ProtSpace annotations come from several sources. Predicted (machine-learning) annotations are flagged with a ⚡ Predicted badge in the app; everything else is experimental or curated. The descriptions below are the same text shown in the in-app information popovers.

## Predicted (Biocentral)

Machine-learning predictions (not experimentally curated). Marked with a ⚡ Predicted badge in the app.

### `predicted_membrane` {#predicted_membrane}

**Membrane** · ⚡ Predicted

Membrane vs. soluble prediction from the LightAttention model.

### `predicted_signal_peptide` {#predicted_signal_peptide}

**Signal peptide** · ⚡ Predicted

Signal-peptide presence predicted by the TMbed model (from topology).

### `predicted_subcellular_location` {#predicted_subcellular_location}

**Subcellular location** · ⚡ Predicted

10-class subcellular localization predicted by the LightAttention model.

### `predicted_transmembrane` {#predicted_transmembrane}

**Transmembrane** · ⚡ Predicted

Transmembrane type (none / alpha-helical / beta-barrel) predicted by TMbed.

## UniProt

Curated annotations from the UniProt knowledgebase.

### `annotation_score` {#annotation_score}

**Annotation score**

UniProt annotation quality score from 1 (low) to 5 (high).

### `cc_subcellular_location` {#cc_subcellular_location}

**Subcellular location**

Subcellular location(s) of the protein, with evidence codes.

### `ec` {#ec}

**EC number**

Enzyme Commission number(s) and enzyme name describing catalytic activity.

### `fragment` {#fragment}

**Fragment**

Whether the sequence entry is a fragment rather than the complete protein.

### `gene_name` {#gene_name}

**Gene name**

Primary gene name for the protein.

### `go_bp` {#go_bp}

**GO — Biological Process**

Gene Ontology Biological Process terms, with evidence codes.

### `go_cc` {#go_cc}

**GO — Cellular Component**

Gene Ontology Cellular Component terms, with evidence codes.

### `go_mf` {#go_mf}

**GO — Molecular Function**

Gene Ontology Molecular Function terms, with evidence codes.

### `keyword` {#keyword}

**Keywords**

Controlled-vocabulary UniProt keywords summarising protein attributes.

### `length` {#length}

**Sequence length**

Length of the protein sequence in amino acids.

### `protein_existence` {#protein_existence}

**Protein existence**

Evidence level for the existence of the protein.

### `protein_families` {#protein_families}

**Protein family**

Protein family membership (first family), with evidence code.

### `reviewed` {#reviewed}

**Reviewed (Swiss-Prot)**

Whether the entry is reviewed (Swiss-Prot) or unreviewed (TrEMBL).

### `xref_pdb` {#xref_pdb}

**Has PDB structure**

Whether an experimental 3D structure exists in the PDB for this protein.

## InterPro

Signature-database matches aggregated by InterPro.

### `cath` {#cath}

**CATH-Gene3D**

Protein structure classification from CATH-Gene3D.

### `cdd` {#cdd}

**CDD**

Conserved domain assignments from CDD.

### `panther` {#panther}

**PANTHER**

Protein family and subfamily classification from PANTHER.

### `pfam` {#pfam}

**Pfam**

Protein family classification from Pfam, with bit scores.

### `pfam_clan` {#pfam_clan}

**Pfam clan**

Higher-level Pfam clan grouping derived from Pfam family membership.

### `prints` {#prints}

**PRINTS**

Protein fingerprint matches from PRINTS.

### `prosite` {#prosite}

**PROSITE**

Protein motif matches from PROSITE patterns.

### `signal_peptide` {#signal_peptide}

**Signal peptide (Phobius)**

Signal peptide prediction from Phobius.

### `smart` {#smart}

**SMART**

Domain architecture assignments from SMART.

### `superfamily` {#superfamily}

**SUPERFAMILY**

Structural and functional domain assignments from SUPERFAMILY.

## Taxonomy

Taxonomic lineage of the source organism.

### `class` {#class}

**Class**

Taxonomic class of the source organism.

### `domain` {#domain}

**Domain**

Top-level biological domain (e.g. Bacteria, Archaea, Eukaryota).

### `family` {#family}

**Family**

Taxonomic family of the source organism.

### `genus` {#genus}

**Genus**

Taxonomic genus of the source organism.

### `kingdom` {#kingdom}

**Kingdom**

Taxonomic kingdom of the source organism.

### `order` {#order}

**Order**

Taxonomic order of the source organism.

### `phylum` {#phylum}

**Phylum**

Taxonomic phylum of the source organism.

### `root` {#root}

**Root**

Cellular / acellular classification at the root of the taxonomy.

### `species` {#species}

**Species**

Taxonomic species of the source organism.

## TED Domains

Structure-based domains from TED (AlphaFold).

### `ted_domains` {#ted_domains}

**TED domains**

Structure-based domains with CATH classification and pLDDT confidence, from TED (AlphaFold).
