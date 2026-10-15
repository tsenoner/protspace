## 1. Failing tests

- [x] 1.1 Style end to end: `N/A` cells styled as `N/A` land under `__NA__`; restyling a stored `__NA__` colour takes the new one; `hiddenValues` / `pinnedValues` spelled `N/A` land as `__NA__`
- [x] 1.2 Converter: N/A spellings in the visualization state, stored categories and frequencies fold into one `__NA__`, `__NA__` winning
- [x] 1.3 Resolver: `__NA__` resolves to `none`; an N/A key resolves to the data's first N/A spelling in sorted order; the template lists N/A once

## 2. One N/A rule in the style path

- [x] 2.1 Add `is_na_label` to `settings_converter.py` and remove both `_NA_LABELS` sets
- [x] 2.2 Fold N/A in `visualization_state_to_settings` (colours, shapes, categories, frequencies, pinned, hidden) and drop the dead default-grey loop
- [x] 2.3 Write N/A styles under `__NA__` in `_styled_settings`; make `_resolve_na` deterministic; list N/A once in `generate_template`

## 3. Docs and verification

- [x] 3.1 Update `docs/guide/styling.md` (N/A values, pinned N/A) and `apps/protspace/CLAUDE.md`
- [x] 3.2 Run ruff, `uv run pytest -m "not slow"`, `pnpm test:contract`, `pnpm precommit`
