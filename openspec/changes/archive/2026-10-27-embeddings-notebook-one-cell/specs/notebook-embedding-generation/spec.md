## MODIFIED Requirements

### Requirement: The Embeddings notebook installs the esm SDK only for its models

`ClickThrough_GenerateEmbeddings.ipynb` SHALL install the `esm` package only when ESM3 is
selected, and before transformers is first imported, so that every other model, ESM C included,
runs on Colab's own transformers and huggingface_hub with nothing installed.

#### Scenario: ESM2 on stock Colab

- **WHEN** the user selects `facebook/esm2_t33_650M_UR50D` and runs the cell
- **THEN** nothing is installed, and Colab's transformers stays installed

#### Scenario: ESM C

- **WHEN** the user selects `biohub/ESMC-300M`
- **THEN** nothing is installed, and transformers' own `esmc` model loads the official weights
  without a login

#### Scenario: ESM3

- **WHEN** the user selects `biohub/esm3-sm-open-v1`
- **THEN** the `esm` package is installed first

### Requirement: The Embeddings notebook imports without other frameworks' start-up output

The Embeddings notebook SHALL switch off TensorFlow and JAX for transformers and transformers'
background safetensors conversion before its first transformers import, SHALL import only names
huggingface_hub 1.x still has, and SHALL keep Hugging Face's download bars and transformers'
report of checkpoint weights an encoder-only load leaves out from printing.

#### Scenario: Colab with transformers 4 after the esm package

- **WHEN** the esm package replaced transformers 5 with 4.x on a runtime that has TensorFlow and JAX
- **THEN** importing the libraries loads neither, and prints no warning

#### Scenario: A checkpoint published only as pytorch_model.bin

- **WHEN** the user embeds with ProtT5
- **THEN** its weights are downloaded once, with no converted `model.safetensors` fetched after

### Requirement: The Embeddings notebook says what each step did and why one stopped

The Embeddings notebook SHALL print one line per stage (model and device, proteins, IDs, weights
with the time taken, the saved file) and SHALL stop with a message naming the cause and the fix for
a cancelled upload, a missing path, an unreadable FASTA, a FASTA without records, duplicate IDs, a
gated or unreachable model, and a missing package. A '/' in an ID SHALL become '\_' instead of
stopping the run.

#### Scenario: A private model without a token

- **WHEN** loading a model fails with an authorization error
- **THEN** the message says it is gated or private and to put a token in the settings

### Requirement: The Embeddings notebook runs on an example FASTA by default

When the settings hold no FASTA path, the Embeddings notebook SHALL fetch an example FASTA of
snake-venom proteins from UniProt and embed it, unless the user ticked the box to upload their own
FASTA, in which case it SHALL ask for the upload. A path in the settings SHALL always be used, and
a `/content/drive/...` path SHALL mount Google Drive first.

#### Scenario: Running the cell on a fresh notebook

- **WHEN** the user runs the cell without changing the settings
- **THEN** it writes the example FASTA, embeds it and downloads the `.h5`

#### Scenario: The user's own file

- **WHEN** the settings hold a path, or the upload box is ticked
- **THEN** that file, or the uploaded one, is embedded and no example is fetched

## ADDED Requirements

### Requirement: The Embeddings notebook is one cell that keeps its model loaded

The Embeddings notebook SHALL run the whole job from one cell whose form holds every setting, and
re-running that cell SHALL reuse the loaded model and skip proteins the `.h5` already holds.
Per-residue output SHALL go to a file of its own (`_per_res`).

#### Scenario: A second FASTA with the same model

- **WHEN** the user changes the FASTA path and runs the cell again
- **THEN** the model is not loaded again

#### Scenario: Per residue after per protein

- **WHEN** the user switches to per residue and runs the cell again
- **THEN** the embeddings go to `<fasta>_<model>_per_res.h5`, and the per-protein file is unchanged
