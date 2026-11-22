## MODIFIED Requirements

### Requirement: The Embeddings notebook runs ESM C 6B only where it fits

The Embeddings notebook SHALL offer `biohub/ESMC-6B` as `esmc_6b`, SHALL load it in bf16 on a
GPU with native bf16, in fp16 on any other GPU and in fp32 on a CPU, and SHALL load every model on
a GPU by placing each weight on the device as it is read, when the runtime has the library for it.
It SHALL stop before downloading ESM C 6B only where the model would be built in host RAM, on a
runtime with less than 16 GB of host RAM (32 GB without a GPU), naming the fix. On a GPU with less
than 16 GB of memory it SHALL warn and continue.

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
