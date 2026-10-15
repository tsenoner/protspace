## ADDED Requirements

### Requirement: An HDF5 input's embedding name is resolved in a fixed order

Every command that reads HDF5 embeddings (`prepare`, `project`, `stats`, `transfer`) SHALL name
each HDF5 input from the first of these that yields a name:

1. the explicit suffix, `file.h5:name`;
2. the file's root attribute `model_name`;
3. a known model key found in the file name;
4. the file stem, only when this input is the command's only input.

A name resolved by rule 1 or 2 SHALL be the same as before this requirement existed.

#### Scenario: Explicit suffix wins

- **WHEN** `-i seqs_esm2_650m.h5:custom` is given for a file whose `model_name` is `prot_t5`
- **THEN** the embedding is named `custom`

#### Scenario: The attribute wins over the file name

- **WHEN** a file named `seqs_esm2_650m.h5` carries `model_name = prot_t5` and no suffix is given
- **THEN** the embedding is named `prot_t5`

#### Scenario: A single unnamed input falls back to its stem

- **WHEN** the command's only input is `results.h5`, with no suffix, no attribute and no known
  key in its name
- **THEN** the embedding is named `results`
- **AND** an info line says the stem is used and how to name the input with `:<model>`

### Requirement: A known model key is read from the end of the file name

A known model key SHALL be one of the keys of the projection display-name registry, excluding
the sequence-similarity source. It SHALL be matched against the whole stem or its trailing
`_`-delimited tokens, longest match first, without regard to case, and returned in the
registry's spelling.

#### Scenario: A known key at the end of the file name

- **WHEN** a file without `model_name` is named `Ss_mSCR_esm2_650m.h5`, `seqs_esm2_650m.h5` or
  `esm2_650m.h5`
- **THEN** the embedding is named `esm2_650m`
- **AND** an info line says the name was taken from the file name

#### Scenario: Longest known key wins

- **WHEN** the trailing tokens of a stem match two known keys of different lengths
- **THEN** the longer key is used

#### Scenario: A model named earlier in the stem is not used

- **WHEN** a file without `model_name` is named `esm2_650m_subset.h5`
- **THEN** no known key is found in its name

#### Scenario: A directory of files from different models

- **WHEN** a directory input without `model_name` attributes holds `seqs_prot_t5.h5` and
  `seqs_prost_t5.h5`
- **THEN** the command fails, naming each file and the model its name points to
- **AND** it does not fall back to the directory's name

### Requirement: Several unnamed inputs are refused with the reason and a correct example

When a command has more than one input and at least one HDF5 input has no name after rules 1-3,
the command SHALL fail before reading any embedding matrix. The message SHALL name the unnamed
inputs, say what the name decides for that command, and show a corrected command line for the
command actually run, built from the user's own paths, with a `<model>` placeholder rather than a
fixed model name.

#### Scenario: prepare with two unnamed files

- **WHEN** `protspace prepare -i a.h5 -i b.h5` is run and neither file has a name
- **THEN** it exits non-zero without a traceback
- **AND** the message says that inputs with the same name are merged (union of proteins) and
  inputs with different names are intersected (proteins in all of them)
- **AND** it shows `protspace prepare -i a.h5:<model> -i b.h5:<model>`

#### Scenario: The example names the command that was run

- **WHEN** the same two files are given to `protspace project` or `protspace stats`
- **THEN** the example starts with that command, not with `prepare`
- **AND** it does not suggest `prot_t5`

### Requirement: project refuses inputs that share an embedding name

`protspace project` SHALL fail before loading any embedding matrix when two of its inputs resolve
to the same embedding name, whichever rule named them, and SHALL point to `protspace prepare`,
which merges same-name inputs.

#### Scenario: Two files named after the same model

- **WHEN** `protspace project -i human_esm2_650m.h5 -i mouse_esm2_650m.h5` is run
- **THEN** it exits non-zero without a traceback
- **AND** the message says the inputs share the name `esm2_650m` and suggests `protspace prepare`

### Requirement: stats matches a single file-named embedding to the projections' source

`protspace stats` with one HDF5 input whose name came from rule 3 or 4 SHALL reconcile that name
with the `source` recorded on the projections, ignoring the sequence-similarity source.

#### Scenario: The projections come from one embedding under another name

- **WHEN** the projections were built from embedding `esm2_650m` and `stats -i seqs.h5` names
  its only input `seqs` from the stem
- **THEN** the input is renamed `esm2_650m` and an info line says so
- **AND** faithfulness and the embedding-space statistics are computed for it

#### Scenario: The projections come from several embeddings and none matches

- **WHEN** the projections come from `prot_t5` and `esm2_650m`, and the only input's file-name
  name is neither
- **THEN** the command fails with a message naming both sources and the `-i file.h5:<source>`
  form, instead of scoring every projection against that one embedding

#### Scenario: An explicit name is left alone

- **WHEN** the only input is given as `-i seqs.h5:custom` and the projections' source is
  `esm2_650m`
- **THEN** the input keeps the name `custom`

### Requirement: transfer does not need an embedding name

`protspace transfer -e` SHALL accept an HDF5 file with no suffix, no attribute and no known key
in its name, since the transfer reads only the vectors.

#### Scenario: Unnamed embeddings file

- **WHEN** `protspace transfer -e emb.h5` is run on a file without `model_name`
- **THEN** the transfer runs as it would with `-e emb.h5:anything`
