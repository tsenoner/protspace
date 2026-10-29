# notebook-embedding-generation Specification

## Purpose

How the Embeddings notebook (`ClickThrough_GenerateEmbeddings.ipynb`) runs every model it offers on Colab's own packages, imports quietly, and says what each step did or why it stopped.

## Requirements

### Requirement: The Embeddings notebook imports without other frameworks' start-up output

The Embeddings notebook SHALL switch off transformers' background safetensors conversion before
its first transformers import, SHALL import only names huggingface_hub 1.x still has, and SHALL
keep Hugging Face's download bars and transformers' report of checkpoint weights an encoder-only
load leaves out from printing.

#### Scenario: A checkpoint published only as pytorch_model.bin

- **WHEN** the user embeds with ProtT5
- **THEN** its weights are downloaded once, with no converted `model.safetensors` fetched after

### Requirement: The Embeddings notebook says what each step did and why one stopped

The Embeddings notebook SHALL print one line per stage (model and device, proteins, IDs, weights
with the time taken, the saved file) and SHALL stop with a message naming the cause and the fix for
a cancelled upload, a missing path, an unreadable FASTA, a FASTA without records, duplicate IDs, a
gated or unreachable model, a missing package, and a transformers too old for ESM C. A '/' in an
ID SHALL become '\_' instead of stopping the run.

#### Scenario: A private model without a token

- **WHEN** loading a model fails with an authorization error
- **THEN** the message says it is gated or private and to add the token as the Colab secret
  `HF_TOKEN`

#### Scenario: ESM C on transformers before 5.16

- **WHEN** loading ESM C fails because transformers has no `esmc` model and asks for remote code
- **THEN** the message says ESM C needs transformers 5.16 or newer

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

### Requirement: The Embeddings notebook runs ESM C 6B only where it fits

The Embeddings notebook SHALL offer `biohub/ESMC-6B` as `esmc_6b`, SHALL load it in bf16 on a
GPU with native bf16, in fp16 on any other GPU and in fp32 on a CPU, and SHALL load every model on
a GPU by placing each weight on the device as it is read, when the runtime has the library for it.
It SHALL stop before downloading ESM C 6B only where the model would be built in host RAM, on a
runtime with less than 16 GB of host RAM (32 GB without a GPU), naming the fix. On a GPU that
reports less than 90% of 16 GB (14.4 GB, smaller than a T4, which reports about 15.6) it SHALL warn
and continue.

#### Scenario: Free Colab with a T4

- **WHEN** the user selects `biohub/ESMC-6B` on a free Colab runtime with a T4 GPU (12.7 GB of host
  RAM)
- **THEN** it loads in fp16 straight onto the GPU, with no stop and no warning

#### Scenario: Free Colab without a GPU

- **WHEN** the user selects `biohub/ESMC-6B` on a runtime with 12.7 GB of host RAM and no GPU
- **THEN** the cell stops before the download and says to attach a GPU

#### Scenario: A GPU without the placement library

- **WHEN** the user selects `biohub/ESMC-6B` on a GPU runtime with less than 16 GB of host RAM and
  without `accelerate`
- **THEN** the cell stops before the download and says to install `accelerate`

#### Scenario: An A100

- **WHEN** the user selects `biohub/ESMC-6B` on an A100 runtime
- **THEN** it loads in bf16, and each protein's vector has 2560 dimensions

### Requirement: The Embeddings notebook installs nothing

`ClickThrough_GenerateEmbeddings.ipynb` SHALL run every model it offers on the runtime's own
torch, transformers and huggingface_hub, and SHALL install no package. It SHALL NOT offer ESM3,
whose `esm` package pins transformers < 5.

#### Scenario: ESM2 on stock Colab

- **WHEN** the user selects `facebook/esm2_t33_650M_UR50D` and runs the cell
- **THEN** nothing is installed, and Colab's transformers stays installed

#### Scenario: ESM C

- **WHEN** the user selects `biohub/ESMC-300M`
- **THEN** nothing is installed, and transformers' own `esmc` model loads the official weights
  without a login
