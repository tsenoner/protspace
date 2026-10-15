## 1. Implementation

- [x] 1.1 Drop the both-columns refusal in `transfer`; the bundle is keyed on `protein_id`

## 2. Tests

- [x] 2.1 A bundle holding `protein_id` and an `identifier` annotation transfers, keeps the
      annotation, and filters on it

## 3. Docs

- [x] 3.1 `apps/protspace/CLAUDE.md` test table

## 4. Verify

- [x] 4.1 `tests/test_transfer_cli.py`, `openspec validate transfer-protein-id-first --strict`
