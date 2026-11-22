## ADDED Requirements

### Requirement: The Embeddings notebook runs ESM C 6B only where it fits

The Embeddings notebook SHALL offer `biohub/ESMC-6B` as `esmc_6b`, SHALL load it in bf16 on a
GPU with native bf16, in fp16 on any other GPU and in fp32 on a CPU, and SHALL stop before
downloading it on a runtime with less than 16 GB of host RAM (32 GB without a GPU), naming a
larger runtime as the fix. On a GPU with less than 24 GB of memory it SHALL warn and continue.

#### Scenario: Free Colab

- **WHEN** the user selects `biohub/ESMC-6B` on a runtime with 12.7 GB of host RAM
- **THEN** the cell stops before the download and says to pick a High-RAM runtime or a larger GPU

#### Scenario: A T4

- **WHEN** the user selects `biohub/ESMC-6B` on a high-RAM runtime with a T4 GPU
- **THEN** it loads in fp16 with a warning that long sequences may not fit

#### Scenario: An A100

- **WHEN** the user selects `biohub/ESMC-6B` on an A100 runtime
- **THEN** it loads in bf16, and each protein's vector has 2560 dimensions
