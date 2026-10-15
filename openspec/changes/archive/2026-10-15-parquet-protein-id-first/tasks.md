## 1. Implementation

- [x] 1.1 `resolve_id_column`: `protein_id`, else `identifier`, else the first column
- [x] 1.2 Tests: a parquet with both keys on `protein_id` in the rule, and `bundle -a` keeps
      `identifier` as an annotation

## 2. Docs

- [x] 2.1 `docs/guide/python-cli.md` `bundle` section; `apps/protspace/CLAUDE.md`

## 3. Verify

- [x] 3.1 `pnpm test:contract`, the Python suite
- [x] 3.2 `openspec validate parquet-protein-id-first --strict`
