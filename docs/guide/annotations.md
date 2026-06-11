<!--
  AUTO-GENERATED — do not edit by hand.
  Brief text + metadata: packages/utils/src/visualization/annotation-metadata.ts
  Detailed text + source links: docs/scripts/annotation-details.ts
  Regenerate: pnpm docs:annotations
-->

# Annotation Reference

ProtSpace annotations come from several sources. **Computational predictions** — from a machine-learning model, sequence topology, or 3D structure (Biocentral, the Phobius `signal_peptide`, and TED) — are flagged with a ⚡ Predicted badge in the app; reference signature matches (Pfam, CATH-Gene3D, …) and curated or factual data (UniProt, Taxonomy) are not. For each annotation, the **bold lead line** is the same short summary shown in the app's info popover, and the paragraph beneath it is a fuller explanation — what the value means, how it is produced, and what it looks like — with a link to the authoritative source.

## Predicted (Biocentral)

Biocentral columns are machine-learning predictions served by the [Biocentral API](https://biocentral.rostlab.org) (Rost lab, TUM). ProtSpace fetches the protein sequence from UniProt, submits it to the Biocentral models, and stores the returned per-protein prediction; all four columns are flagged ⚡ Predicted to distinguish them from experimental annotations. The underlying models (LightAttention, TMbed) take protein language model embeddings (ProtT5) as input rather than multiple sequence alignments, so predictions are available for any sequence regardless of homology to characterized proteins.

### `predicted_membrane` {#predicted_membrane}

**Membrane** · ⚡ Predicted

Membrane vs. soluble prediction from the LightAttention model.

This is the binary membrane-bound vs water-soluble task originally introduced alongside subcellular localization by DeepLoc, here predicted with the same LightAttention architecture over ProtT5 embeddings (no alignments). It distinguishes proteins embedded in or attached to a membrane from freely soluble proteins; values are the two categories `Membrane` and `Soluble`. See [Almagro Armenteros et al., DeepLoc, Bioinformatics 2017](https://doi.org/10.1093/bioinformatics/btx431) for the membrane/soluble task and [Stärk et al., Bioinformatics Advances 2021](https://doi.org/10.1093/bioadv/vbab035) for the LightAttention model.

### `predicted_signal_peptide` {#predicted_signal_peptide}

**Signal peptide** · ⚡ Predicted

Signal-peptide presence predicted by the TMbed model (from topology).

TMbed labels every residue as transmembrane helix (H), transmembrane beta strand (B), signal peptide (S), or non-membrane (further split into inside/outside) from ProtT5 embeddings, with a Viterbi decoder that constrains signal peptides to start at the N-terminus. ProtSpace collapses these per-residue labels into a protein-level boolean: a protein is `True` when an N-terminal signal-peptide (S) segment is predicted and `False` otherwise. See [Bernhofer & Rost, BMC Bioinformatics 2022](https://doi.org/10.1186/s12859-022-04873-x).

### `predicted_subcellular_location` {#predicted_subcellular_location}

**Subcellular location** · ⚡ Predicted

10-class subcellular localization predicted by the LightAttention model.

LightAttention is a lightweight neural network that uses softmax-weighted aggregation (linear in sequence length) over per-residue ProtT5 embeddings to assign a single localization without requiring multiple sequence alignments. The 10 classes are the DeepLoc set: Nucleus, Cytoplasm, Extracellular, Mitochondrion, Cell membrane, Endoplasmic reticulum, Plastid, Golgi apparatus, Lysosome/Vacuole, and Peroxisome; each protein receives exactly one as a categorical value. See [Stärk, Dallago, Heinzinger & Rost, Bioinformatics Advances 2021](https://doi.org/10.1093/bioadv/vbab035).

### `predicted_transmembrane` {#predicted_transmembrane}

**Transmembrane** · ⚡ Predicted

Transmembrane type (none / alpha-helical / beta-barrel) predicted by TMbed.

From the same TMbed per-residue topology (H = transmembrane helix, B = transmembrane beta strand, S = signal peptide), ProtSpace summarizes the membrane-spanning segments into a single protein-level category. Values are `alpha-helical` when transmembrane helices (H) are predicted, `beta-barrel` when transmembrane beta strands (B) are predicted, and `none` when neither is present. See [Bernhofer & Rost, BMC Bioinformatics 2022](https://doi.org/10.1186/s12859-022-04873-x).

## UniProt

These columns come from the UniProt Knowledgebase (UniProtKB), retrieved by ProtSpace through the [UniProt REST API](https://rest.uniprot.org) and attached to each protein as an annotation column. They cover entry identity and curation status (gene name, reviewed, annotation score, protein existence), sequence properties (length, fragment), high-level classification (keywords, protein family, subcellular location, PDB structure availability), and two standardized function ontologies — Enzyme Commission (EC) numbers and Gene Ontology (GO) terms. Where an annotation carries supporting evidence, ProtSpace appends a UniProt evidence code after a pipe (`|`), ranked from experimental (`EXP`) down to electronically inferred (`IEA`) and drawn from a UniProt subset of the [Evidence & Conclusion Ontology](https://www.uniprot.org/help/evidences).

### `annotation_score` {#annotation_score}

**Annotation score**

UniProt annotation quality score from 1 (low) to 5 (high).

The score is a heuristic measure of how much annotation content an entry carries, not a judgement of its biological correctness. UniProt computes it by summing scores assigned to the entry's individual annotations (protein and gene names, function, sequence features, GO terms, cross-references), where annotations backed by experimental evidence count more than predicted ones, and the open-ended total is split into five subintervals so that the best-curated, literature-rich entries reach the top of the scale. In ProtSpace it is an integer from 1 to 5, so colouring by it separates sparsely annotated proteins from well-characterised ones. See [UniProt: Annotation score](https://www.uniprot.org/help/annotation_score).

### `cc_subcellular_location` {#cc_subcellular_location}

**Subcellular location**

Subcellular location(s) of the protein, with evidence codes.

Drawn from the UniProt subcellular location comment (CC) line, this describes where in the cell the mature protein resides, using a controlled vocabulary that also captures membrane topology and orientation. A protein may have several locations, and ProtSpace stores each one with its evidence code appended after a pipe, semicolon-separated, e.g. `Cytoplasm|EXP;Nucleus|IEA`; the codes are drawn from a UniProt subset of the [Evidence & Conclusion Ontology](https://www.uniprot.org/help/evidences) and range from experimental (EXP, IDA) down to electronic inference (IEA). Values are free combinations of vocabulary terms rather than a fixed list. See [UniProt: Subcellular location](https://www.uniprot.org/help/subcellular_location).

### `ec` {#ec}

**EC number**

Enzyme Commission number(s) and enzyme name describing catalytic activity.

EC numbers are a four-level hierarchy (class.subclass.sub-subclass.serial, e.g. 2.7.11.1) that classifies an enzyme by the reaction it catalyses rather than by sequence or structure. The first digit is one of seven top-level classes: 1 oxidoreductases, 2 transferases, 3 hydrolases, 4 lyases, 5 isomerases, 6 ligases, and 7 translocases (the newest class, added by the IUBMB in 2018 for enzymes that move ions or molecules across membranes). Partial numbers with trailing dashes (e.g. 3.4.-.-) indicate a known class but unresolved deeper specificity, and a single protein may carry several EC numbers if it is multifunctional. ProtSpace appends the human-readable enzyme name from [ExPASy ENZYME](https://enzyme.expasy.org/) and an evidence code, e.g. `2.7.11.1 (Non-specific serine/threonine protein kinase)|EXP`.

### `fragment` {#fragment}

**Fragment**

Whether the sequence entry is a fragment rather than the complete protein.

An entry is flagged as a fragment when only part of the protein has been sequenced, or when the coding sequence it derives from is annotated as incomplete (missing exons, or not fully contained within the source INSDC nucleotide record). This matters for embedding interpretation because a fragment's pLM representation reflects only the sequenced portion, not the full-length protein. ProtSpace encodes this as a simple flag: `yes` for fragments, otherwise empty. See [UniProt: Sequence status](https://www.uniprot.org/help/sequence_status).

### `gene_name` {#gene_name}

**Gene name**

Primary gene name for the protein.

This is the gene symbol UniProt designates as primary for the protein, typically the officially approved name from the relevant nomenclature authority (e.g. HGNC for human), with any synonyms and ordered-locus or ORF names recorded separately and not shown here. Values are short alphanumeric symbols such as `TP53` or `BRCA1`; an entry may lack one when no gene name is assigned. Grouping points by gene name highlights orthologues and paralogues that share a symbol across organisms. See [UniProt: Gene name](https://www.uniprot.org/help/gene_name).

### `go_bp` {#go_bp}

**GO — Biological Process**

Gene Ontology Biological Process terms, with evidence codes.

Biological Process is one of the three orthogonal aspects of the [Gene Ontology](https://geneontology.org/docs/ontology-documentation/), capturing the larger biological objective a gene product contributes to — broad programmes such as "signal transduction" or "DNA repair" accomplished by ordered assemblies of molecular functions. Terms come from a controlled vocabulary organised as a directed acyclic graph, so a term can have several more-general parents and a protein is typically annotated to several BP terms of differing granularity. ProtSpace strips the aspect prefix and keeps the term name plus its evidence code, joining multiple terms with `;` (e.g. `apoptotic process|IDA;signal transduction|IEA`); evidence ranges from experimental (EXP, IDA, IMP) to computational and electronic (ISS, IEA).

### `go_cc` {#go_cc}

**GO — Cellular Component**

Gene Ontology Cellular Component terms, with evidence codes.

Cellular Component is the [Gene Ontology](https://geneontology.org/docs/ontology-documentation/) aspect describing where in the cell a gene product is located — subcellular structures such as membranes and organelles, macromolecular complexes, and (where relevant) the extracellular environment. Like the other aspects it is a directed acyclic graph of controlled-vocabulary terms, so localisations nest from general (e.g. "membrane") to specific (e.g. "mitochondrial inner membrane"). ProtSpace strips the aspect prefix and retains each term name with its evidence code, multiple terms separated by `;`; the strongest-to-weakest evidence ladder (EXP, HDA, IDA, TAS … IEA) lets you distinguish experimentally localised proteins from electronically inferred ones.

### `go_mf` {#go_mf}

**GO — Molecular Function**

Gene Ontology Molecular Function terms, with evidence codes.

Molecular Function is the [Gene Ontology](https://geneontology.org/docs/ontology-documentation/) aspect describing the molecular-level activity a gene product performs — for example "catalytic activity", "protein kinase activity", or "transcription factor binding" — independent of where or when it acts. Terms are drawn from a controlled vocabulary structured as a directed acyclic graph, so a protein usually carries several MF terms spanning general and specific activities. ProtSpace strips the aspect prefix and keeps each term name with its evidence code, joining multiple terms with `;` (e.g. `ATP binding|IDA;protein serine/threonine kinase activity|IEA`); MF annotations frequently mirror the catalytic activity captured by the EC number for enzymes.

### `keyword` {#keyword}

**Keywords**

Controlled-vocabulary UniProt keywords summarising protein attributes.

Keywords are a hierarchical controlled vocabulary, mostly assigned by curators, that summarise an entry across ten categories: Biological process, Cellular component, Coding sequence diversity, Developmental stage, Disease, Domain, Ligand, Molecular function, PTM, and Technical term. ProtSpace stores them as a semicolon-separated list of `KW-id (label)` pairs, e.g. `KW-0002 (3D-structure);KW-0025 (Alternative splicing)`, so a single protein can carry many keywords spanning several categories. Colouring by keyword is useful for picking out functional or structural attributes shared across an embedding. See [UniProt: Keywords](https://www.uniprot.org/help/keywords).

### `length` {#length}

**Sequence length**

Length of the protein sequence in amino acids.

This is the number of amino acid residues in the entry's canonical sequence and is the most direct measure of protein size. Values are positive integers, ranging from a few dozen residues for short peptides to tens of thousands for the largest proteins such as titin. Because sequence length influences how a pLM pools its per-residue representation, colouring by length can reveal whether apparent embedding structure tracks protein size. See [UniProt: Sequences](https://www.uniprot.org/help/sequences).

### `protein_existence` {#protein_existence}

**Protein existence**

Evidence level for the existence of the protein.

UniProt assigns one of five protein-existence (PE) levels in decreasing order of evidence: 1 Evidence at protein level (e.g. mass spectrometry, structure, antibody detection), 2 Evidence at transcript level, 3 Inferred from homology, 4 Predicted, and 5 Uncertain. It indicates how confidently the protein is known to exist, not the quality of its functional annotation. ProtSpace stores the descriptive label, e.g. `Evidence at protein level`, so it can be used to separate experimentally validated proteins from purely predicted ones. See [UniProt: Protein existence](https://www.uniprot.org/help/protein_existence).

### `protein_families` {#protein_families}

**Protein family**

Protein family membership (first family), with evidence code.

This records the protein's family or superfamily classification as curated by UniProt, capturing evolutionary and functional relatedness. ProtSpace keeps the first family listed, with its evidence code appended after a pipe, e.g. `Protein kinase superfamily|ISS` (ISS = inferred from sequence or structural similarity); evidence codes follow a UniProt subset of the [Evidence & Conclusion Ontology](https://www.uniprot.org/help/evidences). Because pLM embeddings often cluster by family, this column is a natural reference for checking how well an embedding recovers known family structure. See [UniProt: Family and domains section](https://www.uniprot.org/help/family_and_domains_section).

### `reviewed` {#reviewed}

**Reviewed (Swiss-Prot)**

Whether the entry is reviewed (Swiss-Prot) or unreviewed (TrEMBL).

Reviewed entries belong to UniProtKB/Swiss-Prot, the manually curated section where biologists critically review experimental and predicted data and verify each sequence; unreviewed entries belong to UniProtKB/TrEMBL, which is automatically annotated and far larger, holding records that have not yet been manually examined. The two sections are kept separate so that Swiss-Prot's high-quality curation is not diluted, and TrEMBL entries graduate into Swiss-Prot once curated. ProtSpace stores this as a boolean: `true` for Swiss-Prot, `false` for TrEMBL. See [UniProt: UniProtKB](https://www.uniprot.org/help/uniprotkb).

### `xref_pdb` {#xref_pdb}

**Has PDB structure**

Whether an experimental 3D structure exists in the PDB for this protein.

This flag reflects whether the entry has at least one cross-reference to the [Protein Data Bank](https://www.uniprot.org/help/PDB), i.e. an experimentally determined 3D structure (X-ray, NMR, or cryo-EM) covering all or part of the protein. It distinguishes structurally characterised proteins from those known only by sequence, which is useful when relating embedding clusters to structural coverage. ProtSpace stores it as a boolean, `True` or `False`. See [UniProt: PDB cross-references](https://www.uniprot.org/help/PDB).

## InterPro

[InterPro](https://www.ebi.ac.uk/interpro/) integrates predictive models ("signatures") from a consortium of member databases into a single classification of protein families, domains, and functional sites. ProtSpace queries the InterPro Matches API by MD5 sequence hash and exposes the per-member-database hits directly, one ProtSpace column per member database. Each value is a semicolon-separated list of `accession (name)|score` entries, where the score is the value reported by that database's own tool (a bit score for the HMMER-based members such as Pfam); higher means a stronger match, and scores are not comparable across different databases. Most members match a sequence against curated reference models of known families and domains, so ProtSpace treats them as reference annotations; the exception is Phobius (`signal_peptide`), a de-novo topology predictor, which carries the ⚡ Predicted badge.

### `cath` {#cath}

**CATH-Gene3D**

Protein structure classification from CATH-Gene3D.

CATH-Gene3D (contributed by Gene3D) assigns sequences to CATH domain superfamilies using profile HMMs, where the four-part code denotes Class, Architecture, Topology, and Homologous superfamily. InterPro returns these matches with a `G3DSA:` prefix on the accession; ProtSpace strips that prefix so values read as the bare CATH code (e.g. `3.40.50.300 (...)|bit_score`). Like SUPERFAMILY, it groups proteins by inferred fold and domain architecture rather than overall sequence identity. See [CATH-Gene3D at InterPro](https://www.ebi.ac.uk/interpro/entry/cathgene3d/).

### `cdd` {#cdd}

**CDD**

Conserved domain assignments from CDD.

NCBI's Conserved Domain Database (CDD) detects domains by comparing the sequence against position-specific scoring matrices (PSSMs) built from curated, often structure-informed alignments, using RPS-BLAST; models include domains imported from Pfam, SMART, COG, TIGRFAM/NCBIfam and NCBI's own curation. Values pair a CDD accession and name with the match score. CDD helps resolve conserved functional cores and is curated independently of the HMM-based members. See [CDD at InterPro](https://www.ebi.ac.uk/interpro/entry/cdd/).

### `panther` {#panther}

**PANTHER**

Protein family and subfamily classification from PANTHER.

PANTHER (Protein ANalysis THrough Evolutionary Relationships) organises proteins into families and subfamilies, each backed by a phylogenetic tree, a multiple sequence alignment, and an HMM, so a match reports the best-fitting family or subfamily rather than an isolated domain; subfamilies are orthologous groups defined from the family tree by a mix of automated inference and curation. Accessions look like `PTHR24356` for families and `PTHR24356:SF42` for subfamilies, reported with the HMM score. Because subfamilies capture finer functional distinctions, this column can separate functionally divergent members of one broad family. See [PANTHER at InterPro](https://www.ebi.ac.uk/interpro/entry/panther/).

### `pfam` {#pfam}

**Pfam**

Protein family classification from Pfam, with bit scores.

Each Pfam entry is built from a curated seed alignment of representative members and represented as a profile hidden Markov model that is built and searched with HMMER, so a value records which Pfam-A family or domain the sequence matches together with the HMMER bit score (higher = better fit to the family model). Pfam is among the most widely used domain resources and seeds a large share of InterPro entries. Values look like `PF00069 (Pkinase)|412.5;...`, frequently with several domains per protein. The database is now maintained within [InterPro's Pfam member resource](https://www.ebi.ac.uk/interpro/entry/pfam/).

### `pfam_clan` {#pfam_clan}

**Pfam clan**

Higher-level Pfam clan grouping derived from Pfam family membership.

A Pfam clan groups families judged to share common ancestry on the basis of sequence, structure, function, and profile-HMM similarity (the latter assessed with HHsearch), capturing divergent families that no single family HMM could unify. This column is not returned by the InterPro API; ProtSpace derives it by mapping each matched Pfam family to its parent clan, yielding clan accessions of the form `CL0016`. It gives a coarser, more robust grouping than `pfam` for colouring related families together. See [EBI's guide to grouping Pfam entries into clans](https://www.ebi.ac.uk/training/online/courses/pfam-creating-protein-families/grouping-pfam-entries-into-clans/).

### `prints` {#prints}

**PRINTS**

Protein fingerprint matches from PRINTS.

PRINTS describes a family or domain with a fingerprint: a group of several conserved motifs excised from a sequence alignment that co-occur along the sequence and whose diagnostic power is refined by iterative database scanning, so a match is strongest when most motifs are present, giving more discriminating power than any single motif or regular expression. Values give a PRINTS accession (`PR#####`) and name with the match score. Fingerprints are well suited to discriminating closely related subfamilies. See [PRINTS at InterPro](https://www.ebi.ac.uk/interpro/entry/prints/).

### `prosite` {#prosite}

**PROSITE**

Protein motif matches from PROSITE patterns.

This column reports PROSITE pattern matches: short regular-expression motifs (typically 10-20 residues spanning catalytic or ligand-binding sites) derived from curated alignments, as distinct from PROSITE's separate, more sensitive generalised profiles. A hit indicates the sequence contains the motif, reported as a PROSITE accession (`PS#####`) and name with a score. Patterns are precise but can miss diverged sites or produce chance matches, so they complement the broader HMM-based family columns. See [PROSITE at ExPASy](https://prosite.expasy.org/).

### `signal_peptide` {#signal_peptide}

**Signal peptide (Phobius)** · ⚡ Predicted

Signal peptide prediction from Phobius.

Phobius is a single HMM that jointly models signal-peptide and transmembrane-helix topology in one network of interconnected states, letting it distinguish the hydrophobic core of a signal peptide from a transmembrane segment and so cut the cross-prediction errors that affect separate predictors (Käll, Krogh & Sonnhammer, J. Mol. Biol. 338:1027-1036, 2004). Unlike the other columns here, ProtSpace collapses the Phobius match into a boolean, so values are `True` (signal peptide predicted) or `False`. This makes a convenient two-class colouring for likely-secreted versus other proteins. See the paper at [doi:10.1016/j.jmb.2004.03.016](https://doi.org/10.1016/j.jmb.2004.03.016).

### `smart` {#smart}

**SMART**

Domain architecture assignments from SMART.

SMART (Simple Modular Architecture Research Tool) is a collection of manually curated profile HMMs with a focus on mobile signalling, extracellular, and chromatin-associated domains, used to dissect multidomain architectures. Each value gives a SMART accession and name with the model's bit score, and a single protein commonly carries several SMART domains reflecting its modular layout. Because the families are hand-curated, SMART often provides clean annotation for well-studied signalling domains. See [SMART at InterPro](https://www.ebi.ac.uk/interpro/entry/smart/).

### `superfamily` {#superfamily}

**SUPERFAMILY**

Structural and functional domain assignments from SUPERFAMILY.

SUPERFAMILY uses a library of profile HMMs based on the SCOP classification, with each model corresponding to a SCOP domain and aiming to represent an entire superfamily, so a match indicates a likely shared 3D fold and common evolutionary ancestor even at low sequence identity. Each value pairs a SUPERFAMILY accession and name with the HMM bit score. Because the models are anchored on proteins of known structure, this column is useful for grouping distant homologues by fold rather than by close sequence similarity. See the [SUPERFAMILY member database at InterPro](https://www.ebi.ac.uk/interpro/entry/ssf/).

## Taxonomy

The nine taxonomy columns trace the source organism up the standard Linnaean / NCBI rank ladder, from most general to most specific: **root → domain → kingdom → phylum → class → order → family → genus → species** (they are listed below in that rank order rather than alphabetically). ProtSpace takes each entry's `organism_id` and queries the [UniProt Taxonomy API](https://www.uniprot.org/help/taxonomy) (backed by [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy)) to resolve them; `root` is the cellular/acellular split and `domain` the Bacteria/Archaea/Eukaryota level. Intermediate ranks are not defined for every lineage, so a given column can be empty for some organisms. Colouring by a rank is a quick way to see how organism provenance maps onto an embedding.

### `root` {#root}

**Root**

Cellular / acellular classification at the root of the taxonomy.

The root sits above the three-domain system and separates cellular life (organisms with a cell — Bacteria, Archaea, Eukaryota) from acellular agents (viruses and viroids); NCBI Taxonomy formalises this split with its top ranks `cellular root` and `acellular root`. In practice this column is near-binary and is most useful for quickly distinguishing viral from cellular proteins in an embedding. It is the broadest of the nine ranks ProtSpace resolves from the organism's `organism_id` via the UniProt Taxonomy API, backed by [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy).

### `domain` {#domain}

**Domain**

Top-level biological domain (e.g. Bacteria, Archaea, Eukaryota).

This is the highest rank of the three-domain system proposed by Woese, Kandler and Wheelis (1990), dividing cellular life into Bacteria, Archaea, and Eukaryota; NCBI Taxonomy now records this as a formal `domain` rank (renamed from `superkingdom` in 2025). It is a small, well-defined categorical set, which makes it a robust way to colour large embeddings by deep evolutionary lineage. Values come from [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy) via the UniProt Taxonomy API.

### `kingdom` {#kingdom}

**Kingdom**

Taxonomic kingdom of the source organism.

Kingdom is the rank below domain (e.g. Metazoa, Viridiplantae, Fungi within Eukaryota). NCBI Taxonomy does not assign a kingdom to every lineage — many bacterial and archaeal entries have no formal kingdom — so this column can be empty for some organisms. Values are the kingdom-rank node returned by the [UniProt Taxonomy API](https://www.uniprot.org/help/taxonomy) for the entry's organism.

### `phylum` {#phylum}

**Phylum**

Taxonomic phylum of the source organism.

Phylum groups organisms by broad body plan or major lineage (e.g. Chordata, Pseudomonadota, Ascomycota), one rank below kingdom. It is a free-text categorical column whose value set scales with the taxonomic breadth of the dataset. The value is the phylum-rank ancestor of the entry's organism in [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy).

### `class` {#class}

**Class**

Taxonomic class of the source organism.

Class is the rank between phylum and order (e.g. Mammalia, Gammaproteobacteria, Insecta). As with the other intermediate Linnaean ranks, NCBI does not guarantee a class node for every lineage, so the value may be absent. It is resolved as the class-rank ancestor of the organism via the [UniProt Taxonomy API](https://www.uniprot.org/help/taxonomy).

### `order` {#order}

**Order**

Taxonomic order of the source organism.

Order groups related families one level below class (e.g. Primates, Enterobacterales). It is a categorical string column drawn from the standard Linnaean ladder. The value is the order-rank ancestor of the entry's source organism in [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy), retrieved through the UniProt Taxonomy API.

### `family` {#family}

**Family**

Taxonomic family of the source organism.

Family is the rank below order grouping closely related genera (e.g. Hominidae, Enterobacteriaceae). It offers finer lineage resolution than order while still spanning many species, which makes it useful for distinguishing clades within a focused dataset. The value is the family-rank ancestor of the organism from [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy) via the UniProt Taxonomy API.

### `genus` {#genus}

**Genus**

Taxonomic genus of the source organism.

Genus is the first part of the binomial name and groups closely related species (e.g. _Homo_, _Escherichia_). Together with species it gives the most fine-grained taxonomic colouring ProtSpace provides. The value is the genus-rank node for the entry's organism resolved through the [UniProt Taxonomy API](https://www.uniprot.org/help/taxonomy), backed by NCBI Taxonomy.

### `species` {#species}

**Species**

Taxonomic species of the source organism.

Species is the most specific of the nine ranks, corresponding to the full binomial (e.g. _Homo sapiens_, _Escherichia coli_). It typically produces the largest number of distinct categories in a dataset, so it is best suited to multi-organism collections rather than single-proteome bundles. The value is the species-rank node for the entry's `organism_id` from [NCBI Taxonomy](https://www.ncbi.nlm.nih.gov/taxonomy) via the UniProt Taxonomy API.

## TED Domains

TED ([The Encyclopedia of Domains](https://ted.cathdb.info/)) provides structure-based domain assignments derived from AlphaFold models. ProtSpace fetches them per accession through the AlphaFold Database API and reports, for each domain, its [CATH](https://www.cathdb.info/) classification and the AlphaFold pLDDT confidence.

### `ted_domains` {#ted_domains}

**TED domains** · ⚡ Predicted

Structure-based domains with CATH classification and pLDDT confidence, from TED (AlphaFold).

TED ([The Encyclopedia of Domains](https://ted.cathdb.info/)) segments AlphaFold structures into domains by taking a consensus of three structure-based parsers — Chainsaw, Merizo, and UniDoc — and matches each against [CATH](https://www.cathdb.info/), whose four hierarchical levels are Class, Architecture, Topology, and Homologous superfamily (the four numbers in a code such as `2.60.40.720`). Each domain carries a pLDDT score, AlphaFold's per-residue model confidence on a 0–100 scale, here averaged over the domain's residues. ProtSpace fetches these per accession from the AlphaFold Database API and joins multiple domains with `;`, formatting each as `code (name)|pLDDT`, or `unclassified|{plddt}` when no CATH superfamily is assigned. The underlying resource was published by Lau, Bordin, Kandathil, Orengo, Jones et al. in [Science (2024)](https://doi.org/10.1126/science.adq4946), describing nearly 365 million domains across the AlphaFold Database, of which roughly 77% of nonredundant domains match a known CATH superfamily.
