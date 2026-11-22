## 1. Notebook

- [x] 1.1 `_gpu_placement`: `device_map=<the GPU>` for every model when `accelerate` is importable
- [x] 1.2 `_check_fits`: RAM stop only where the load goes through host RAM, with the fix for each
      case; GPU warning below 16 GB
- [x] 1.3 Form text: the free T4 runs ESM C 6B

## 2. Tests

- [x] 2.1 `device_map` per family × {GPU + accelerate, GPU without, CPU}; 6B dtype test with it
- [x] 2.2 Free T4: no stop, no warning; RAM stop without a GPU and without accelerate

## 3. Docs

- [x] 3.1 `docs/guide/data-preparation.md`, `docs/guide/python-cli.md`, `apps/protspace/CLAUDE.md`
