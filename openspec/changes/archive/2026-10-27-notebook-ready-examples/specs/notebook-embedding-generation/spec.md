## ADDED Requirements

### Requirement: The Embeddings notebook runs on an example FASTA by default

When step 1 holds no FASTA path, the Embeddings notebook SHALL fetch an example FASTA of
snake-venom proteins from UniProt and embed it, unless the user ticked the box to upload their
own FASTA, in which case it SHALL ask for the upload. A path in step 1 SHALL always be used.

#### Scenario: Run all on a fresh notebook

- **WHEN** the user runs all without changing step 1
- **THEN** step 4 writes the example FASTA and step 5 embeds it

#### Scenario: The user's own file

- **WHEN** step 1 holds a path, or the upload box is ticked
- **THEN** that file, or the uploaded one, is embedded and no example is fetched
