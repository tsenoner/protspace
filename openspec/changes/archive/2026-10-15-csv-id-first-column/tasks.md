## 1. Tests first

- [x] 1.1 Replace the precedence cases in `tests/test_custom_annotations.py` with first-column
      cases: `family,protein_id,group`, `seq,identifier,group`, `accession,id,family`,
      `ProteinID,family` and a first column named `protein_id` all key on the first column
- [x] 1.2 Collision cases: a later `identifier`, `protein_id` or `id` column reaches the output as
      `<name>_annotation` with a warning naming the rename; a taken `<name>_annotation` gets a
      number; `Protein_ID` is not renamed
- [x] 1.3 Commands: `prepare` and `annotate` with a later `protein_id`/`identifier` column succeed
      and carry the renamed column; `stats -a` on such a CSV writes an `identifier` id column that
      `bundle -a` accepts
- [x] 1.4 Parquet rule: `protein_id`/`identifier` by name, else the first column; both is an error
- [x] 1.5 Pin `RESERVED_COLUMNS` against the viewer's `ID_COLUMNS` in `conversion.ts`, and the
      guide's reserved-name list and first-column rule and the notebook hint against the code

## 2. Implementation

- [x] 2.1 `custom_annotations.py`: positional id column in `_read_file`, `RESERVED_COLUMNS` and the
      rename with its warning; `resolve_id_column` reduced to the parquet rule; module docstring
- [x] 2.2 `cli/stats.py`, `cli/bundle.py`: comments and docstrings name the parquet rule;
      `cli/prepare.py` `-a` help names the first column

## 3. Docs

- [x] 3.1 `docs/guide/python-cli.md`: "Custom annotation files" id-column rule and reserved names,
      the `bundle` section's parquet rule, "Upgrading from v4.4" without the id-column item
- [x] 3.2 `docs/guide/data-preparation.md`, `docs/guide/faq.md`
- [x] 3.3 Preparation notebook CSV hint
- [x] 3.4 `apps/protspace/CLAUDE.md`
- [x] 3.5 The `serve` app's help FAQ, which asked for an `identifier` column

## 4. Verify

- [x] 4.1 `uv run pytest` for `apps/protspace`, `ruff check`, `ruff format --check`
- [x] 4.2 `openspec validate csv-id-first-column --strict`
