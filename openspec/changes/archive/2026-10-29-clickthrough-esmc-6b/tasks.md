## 1. Notebook

- [x] 1.1 Offer and link `biohub/ESMC-6B` (`esmc_6b`); load it in native bf16, else fp16, on a GPU and fp32 on a CPU
- [x] 1.2 Stop before the download below 16 GB host RAM (32 GB on a CPU); warn on a GPU below 24 GB
- [x] 1.3 Tests: dtype per device, the RAM gate, the VRAM warning; notebook tests on ipywidgets 8 and 7.7.1
- [x] 1.4 ESM C 300M through the notebook equals the package's ubiquitin reference (`tests/esmc_reference.py`)

## 2. Docs

- [x] 2.1 `apps/protspace/CLAUDE.md`: the notebook row names 6B and its limits
- [x] 2.2 `docs/guide`: data preparation and the CLI guide say 6B needs a High-RAM runtime
