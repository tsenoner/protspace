## Why

The web app draws every missing cell as one N/A legend entry and looks its style up under the
key `__NA__`. `protspace style` decides which values are N/A with its own list (`""`, `<NA>`,
`NaN`, `__NA__`, `None`, compared exactly), kept twice, in `settings_converter.py` and
`add_annotation_style.py`. Anything else the web reads as N/A keeps its own spelling:

- Styling a column whose missing cells say `N/A` (or `null`, `none`, `NA`) stores the colour
  under the key `N/A`. The web never looks there, so the style is silently lost. `hiddenValues`
  and `pinnedValues` spelled that way are lost the same way.
- Restyling N/A on a bundle that already has an `__NA__` colour keeps the old colour. The new
  one is written under the data's spelling (`""` for a v3 missing cell), and when both reach
  the settings, `__NA__` overwrites it.

The styling guide promises any N/A spelling works and lands under `__NA__`. Both cases break
that promise without an error.

## What Changes

- One rule for N/A in the style path: a value is N/A when the web reads it as missing
  (`is_missing_value`), or is `<NA>`, the `str()` of a pandas missing value that older styles
  files carry. Both `_NA_LABELS` sets are removed.
- `protspace style` writes a style for any N/A spelling under `__NA__`, so a restyle replaces
  the stored N/A style instead of losing to it.
- The settings converter folds every N/A spelling into the one `__NA__` category: colours,
  shapes, stored categories, frequencies, `pinnedValues` and `hiddenValues`. `__NA__` itself
  wins over a spelling of it.
- `resolve_style_key` resolves an N/A key to the first N/A spelling the data holds in sorted
  order, rather than in set order. It also resolves to `none` now, which the web has always
  shown as N/A (TMbed's negative, the reason it was excluded, is now `non-transmembrane`).
- `--generate-template` lists N/A once, under `__NA__`, instead of once per spelling.
- The styling guide lists the spellings by reference to the web's rule.

## Capabilities

### New Capabilities

### Modified Capabilities

- `bundle-format-contract`: adds a requirement that a style naming N/A by any spelling reaches
  the web's N/A category.

## Impact

- `apps/protspace/src/protspace/data/io/settings_converter.py`,
  `apps/protspace/src/protspace/utils/add_annotation_style.py`.
- Tests: `test_missing_values.py` (style end to end), `test_settings_converter.py`,
  `test_style_warnings.py` (the `none` assertion flips).
- Docs: `docs/guide/styling.md` (N/A values).
- Behaviour: N/A styles that were silently dropped now apply. A settings part from an older
  `protspace style` that holds a stray `N/A` (or similar) category is folded into `__NA__` on
  the next restyle. The web reader is unchanged.
