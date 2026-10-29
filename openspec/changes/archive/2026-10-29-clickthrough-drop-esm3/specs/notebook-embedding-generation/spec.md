## REMOVED Requirements

### Requirement: The Embeddings notebook installs the esm SDK only for its models

**Reason**: ESM3 is no longer offered, and it was the only model that needed the `esm` package.

**Migration**: Replaced by "The Embeddings notebook installs nothing". `.h5` files written with
ESM3 still load in ProtSpace as `esm3_open`.

## ADDED Requirements

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

## MODIFIED Requirements

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
