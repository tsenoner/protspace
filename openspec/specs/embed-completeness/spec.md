# embed-completeness Specification

## Purpose

When an embedding run is considered complete, which sequences may be skipped
rather than failed, how coverage against the source FASTA is verified, and what
each run reports. The rule is `expected = requested - skipped`, shared by both
the Biocentral and local backends so neither can drift from the other: a
documented capability limit is skipped and named, anything else absent from the
HDF5 fails the run. This exists because a truncated `.h5` projects, bundles and
scores completely normally, so a silently incomplete embedding yields plausible
numbers computed on a dataset missing part of its proteins.

## Requirements

### Requirement: An incomplete embedding exits non-zero

Embedding SHALL exit non-zero when a sequence it attempted is absent from the
output HDF5, on every backend. The rule is `expected = requested − skipped`, and
the check reads the HDF5 rather than a running total, because the writer skips
identifiers already present and h5py turns an identifier containing `/` into a
group — so a counter can claim sequences the file does not hold.

#### Scenario: The embedder returns fewer sequences than requested

- **WHEN** a batch response omits sequences that were requested
- **THEN** the run raises `ValueError` naming the output path, how many of the
  outstanding sequences were embedded, and how many are still missing
- **AND** the partial HDF5 is kept, so a rerun embeds only what is missing
- **AND** no `model_name` attribute is written and no affirmative save line is printed

#### Scenario: Nothing at all was embedded

- **WHEN** no sequence reached the HDF5
- **THEN** the run raises `ValueError` distinguishing this from a partial run
- **AND** no HDF5 is fabricated by the caller writing the `model_name` attribute

#### Scenario: A complete run succeeds

- **WHEN** every requested sequence is present in the HDF5
- **THEN** the run returns the path and exits zero

#### Scenario: The failure type is catchable by the CLI

- **WHEN** any completeness failure is raised
- **THEN** it is a `ValueError`, which `cli/embed.py` and `cli/prepare.py` already
  catch to render `ERROR: <message>` and exit 1, rather than a `RuntimeError`,
  which would escape those handlers as a raw traceback

### Requirement: A documented capability limit is skipped, not failed

Embedding SHALL treat a sequence excluded by a documented capability limit as
skipped rather than failed, and SHALL exit zero when every remaining sequence
embedded. A capability limit is a sequence longer than the configured maximum
length, or one that exhausts GPU memory at batch size 1.

#### Scenario: A sequence longer than the maximum is skipped

- **WHEN** the local backend is asked to embed a sequence longer than `--max-length`
- **THEN** that sequence is excluded from the attempt and named as skipped
- **AND** the run exits zero provided the remaining sequences all embedded

#### Scenario: A sequence that exhausts GPU memory is skipped

- **WHEN** the local backend exhausts GPU memory for a single sequence at batch size 1
- **THEN** that sequence is recorded as skipped with that reason and named in the summary
- **AND** the run exits zero provided the remaining sequences all embedded

#### Scenario: Skipping everything is still a failure

- **WHEN** every requested sequence was skipped, so the HDF5 gained nothing
- **THEN** the run raises `ValueError` rather than reporting success

#### Scenario: The progress bar counts only what was written

- **WHEN** a batch fails or a sequence is skipped
- **THEN** the progress bar does not advance for it, so a run that embedded
  nothing cannot render identically to one that embedded everything

### Requirement: Every run reports what it embedded and skipped

Embedding SHALL report every skipped sequence on stderr at warning level or above,
grouped by reason and naming the identifiers, and SHALL report the embedded and
skipped counts once per run. Skips go to stderr because a skipped sequence means
the dataset is incomplete even though the run succeeded, and the hosted prep
service discards the subprocess's stdout while keeping stderr; warning level or
above because the default verbosity shows nothing below it.

#### Scenario: A run with skips names them

- **WHEN** a run completes with one or more skipped sequences
- **THEN** each reason is reported on stderr with the identifiers it applies to,
  previewing the first few when there are many
- **AND** the end-of-run line states how many sequences were embedded and how many
  were skipped

#### Scenario: A clean run is not made noisy

- **WHEN** a run completes with nothing skipped
- **THEN** no skip warning is emitted, and the end-of-run line reports the
  embedded count alone

#### Scenario: The summary cannot be mistaken for a service outage

- **WHEN** the summary or a completeness failure message is emitted
- **THEN** it contains none of the substrings the prep service matches to classify
  a failure as `BIOCENTRAL_UNAVAILABLE`, so a coverage problem is never reported
  to the user as an embedding-service outage

### Requirement: Identifiers invalid for HDF5 are rejected before any work begins

Embedding SHALL reject an identifier containing `/` on every backend, before
contacting the embedding service or loading a model. HDF5 treats `/` as a group
separator, so such an identifier silently becomes a group rather than a dataset
and the run cannot produce the requested key.

#### Scenario: The remote backend rejects the identifier up front

- **WHEN** the Biocentral backend is given an identifier containing `/`
- **THEN** it raises `ValueError` naming the offending identifiers before
  submitting any batch, rather than embedding everything and then reporting an
  unexplained shortfall

#### Scenario: Both backends reject identically

- **WHEN** either backend is given the same invalid identifier
- **THEN** the same error is raised, from the shared HDF5 layer

### Requirement: The maximum sequence length is user-controllable

The CLI SHALL expose the local backend's maximum sequence length as `--max-length`
on both `embed` and `prepare`, so that a skipped sequence is actionable. Without
it a user who is told a sequence was skipped has no way to embed it.

#### Scenario: Raising the limit embeds a previously skipped sequence

- **WHEN** a run skipped a sequence for exceeding the maximum length, and the user
  reruns with a `--max-length` above that sequence's length
- **THEN** the sequence is attempted and, on success, written to the HDF5

#### Scenario: The option is rejected when not positive

- **WHEN** `--max-length` is given a value below 1
- **THEN** the CLI rejects it before loading a model

### Requirement: Embeddings are checked against the supplied FASTA

The pipeline SHALL compare embedding identifiers against the FASTA supplied with
`-f/--fasta`, normalising both sides through `parse_identifier`, and SHALL fail
when similarity is requested and any embedded protein is absent from that FASTA.
An uncovered protein leaves its similarity-matrix diagonal at zero, which defeats
the all-or-nothing diagonal test that triggers the similarity-to-distance
conversion, so a single uncovered protein inverts the entire MDS projection.

#### Scenario: Uncovered embeddings block a similarity run

- **WHEN** similarity is requested and one or more embedded proteins are absent
  from the FASTA
- **THEN** the run fails with a message naming how many proteins are uncovered,
  rather than producing an inverted projection

#### Scenario: Uncovered embeddings warn without similarity

- **WHEN** one or more embedded proteins are absent from the FASTA and similarity
  is not requested
- **THEN** the run warns, naming the uncovered count, and continues

#### Scenario: A FASTA covering more than the embeddings is not reported

- **WHEN** the FASTA contains proteins that are absent from the embeddings
- **THEN** nothing is reported, because a resumed embedding cache legitimately
  covers fewer proteins than the FASTA it was built from

### Requirement: A supplied FASTA must exist and reaches every HDF5 input

The CLI SHALL reject a `-f/--fasta` path that does not exist, and SHALL attach the
supplied FASTA to every HDF5 input it loads, a directory of them as much as a
single file. A path read only behind an existence guard turns a typo into silence,
and attaching the FASTA to one input shape but not the other makes both the
coverage check and the sequences carried into the bundle depend on how the input
happened to be spelled.

#### Scenario: A FASTA path that does not exist is a usage error

- **WHEN** `-f/--fasta` names a path that is not on disk
- **THEN** the command rejects it as a bad argument, on both `prepare` and
  `project`, rather than continuing with the FASTA silently unused

#### Scenario: A directory of embeddings receives the FASTA

- **WHEN** the input is a directory of HDF5 files and `-f/--fasta` is supplied
- **THEN** the FASTA is attached to the loaded embeddings, so its sequences reach
  the bundle exactly as they do for a single HDF5 input

#### Scenario: Identifier styles are reconciled before comparing

- **WHEN** the HDF5 keys and the FASTA headers use different identifier styles,
  such as `sp|P12345|NAME` against `P12345`
- **THEN** both sides are normalised through `parse_identifier` before comparison,
  so no protein is reported uncovered merely because of its key style
