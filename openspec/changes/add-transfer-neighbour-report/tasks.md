## 1. Engine

- [ ] 1.1 `protlabel.transfer`: `Neighbor` dataclass and `Prediction.neighbors` (defaulted empty tuple), exported from `protlabel`
- [ ] 1.2 `eat(keep_neighbors=True)` fills them, sorted by `(distance, reference_id)`; the default output stays identical
- [ ] 1.3 Tests in `packages/protlabel/tests/test_protlabel_transfer.py`: neighbours ranked by distance, ties by id, `k` capped to the references, default carries none

## 2. CLI

- [ ] 2.1 `data/io/predictions.py`: report rows from predictions (decoded labels) and an atomic TSV writer
- [ ] 2.2 `run_transfer(report=...)` collects rows; `protspace transfer --report PATH` writes them
- [ ] 2.3 Tests in `tests/test_transfer_cli.py`: `--k 1` one row per query matching the source, `--k 3` ranked rows, raw distance (not reliability), bundle identical with and without `--report`

## 3. Docs and notebook

- [ ] 3.1 `docs/guide/python-cli.md`: `--report` flag and its columns
- [ ] 3.2 `docs/explore/eat.md`: point to the report from the reliability section
- [ ] 3.3 `ProtSpace_Transfer.ipynb`: write the report and offer it as a download; `tests/test_notebooks.py` runs the new cell
- [ ] 3.4 `apps/protspace/CLAUDE.md`: transfer row, test-file rows

## 4. Verification

- [ ] 4.1 `uv run --directory apps/protspace pytest -m "not slow"`, ruff, `pnpm precommit`, `pnpm format:check`
- [ ] 4.2 `openspec validate add-transfer-neighbour-report --strict`
