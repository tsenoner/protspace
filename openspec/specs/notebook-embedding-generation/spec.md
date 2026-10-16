# notebook-embedding-generation Specification

## Purpose

How the Embeddings notebook (`ClickThrough_GenerateEmbeddings.ipynb`) installs what a chosen model needs without replacing Colab's own packages, imports quietly, and says what each step did or why it stopped.

## Requirements

### Requirement: The Embeddings notebook installs the esm SDK only for its models

`ClickThrough_GenerateEmbeddings.ipynb` SHALL install the EvolutionaryScale `esm` SDK only when an
EvolutionaryScale model is selected, choosing the model before the install step, so that the other
models run on Colab's own transformers and huggingface_hub.

#### Scenario: ESM2 on stock Colab

- **WHEN** the user selects `facebook/esm2_t33_650M_UR50D` and runs all
- **THEN** pip is not asked for `esm`, and Colab's transformers stays installed

#### Scenario: ESM C

- **WHEN** the user selects `EvolutionaryScale/esmc-300m-2024-12`
- **THEN** pip is asked for `esm`

### Requirement: The Embeddings notebook imports without other frameworks' start-up output

The Embeddings notebook SHALL switch off TensorFlow and JAX for transformers before its first
transformers import, SHALL import only names huggingface_hub 1.x still has, and SHALL keep
transformers' report of checkpoint weights an encoder-only load leaves out from printing.

#### Scenario: Colab with transformers 4 after the esm SDK

- **WHEN** the esm SDK replaced transformers 5 with 4.x on a runtime that has TensorFlow and JAX
- **THEN** importing the libraries loads neither, and prints no warning

### Requirement: The Embeddings notebook says what each step did and why one stopped

Each step of the Embeddings notebook SHALL print what it did, and SHALL stop with a message
naming the cause and the fix for a cancelled upload, a missing path, a FASTA without records,
duplicate IDs, IDs an HDF5 file cannot name, a gated or unreachable model, and a missing package.

#### Scenario: A gated model without a login

- **WHEN** loading ESM3 fails with an authorization error
- **THEN** the step says the model is gated and to log in with the Hugging Face step
