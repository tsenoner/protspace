## 1. Python

- [x] 1.1 `deprecations.py`: the 3-D reading warning says the X/Y view equals the 2-D projection
      only for PCA and recommends recomputing with the 2-D method, `--flatten-3d` beside it
- [x] 1.2 `cli/convert.py`: `--flatten-3d` help, the flattened line and the kept-as-3-D warning
      say the same
- [x] 1.3 Tests pin the new wording (`test_flatten_3d.py`, `test_export_cli.py`)

## 2. Web

- [x] 2.1 `getThreeDProjectionNotification` says the same, without "To keep this view"
- [x] 2.2 `notifications.test.ts` pins it

## 3. Docs

- [x] 3.1 `python-cli.md`, `control-bar.md`, `exporting.md`, `data-format.md`
