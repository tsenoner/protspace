## Context

`protspace style` reads a styles file keyed by display values, resolves each key against the
column's values (`resolve_style_key`), writes the result into the reader's visualization state
keyed by the resolved value, and converts that state into the settings part
(`visualization_state_to_settings`). The converter renames an N/A value to `__NA__` as it
writes each category. Both steps use an exact-match `_NA_LABELS` set, so a spelling outside it
stays a category of its own, and several N/A entries reaching the converter overwrite one
another in sorted order.

## Goals / Non-Goals

**Goals:**

- Every value the web shows as N/A is one category in the settings, `__NA__`, whatever spelling
  the data or the styles file uses.
- A new N/A style replaces a stored one.
- One N/A rule in the style path, built on `is_missing_value`.

**Non-Goals:**

- Missing spellings inside a multi-hit cell (`A;none`): `_to_display_value` splits hits and keeps
  them, the web drops missing hits. Styles key hits, so `none` there now resolves as N/A, which
  is what the web shows; no further change.
- The Dash plot's own N/A colour (`<N/A>` in `plotting.py`).

## Decisions

**`is_na_label(value) = value == "<NA>" or is_missing_value(value)`, in `settings_converter.py`,
imported by `add_annotation_style.py`.** `<NA>` is not a web token: it is what pandas prints for
a missing value, and styles files written from earlier templates carry it. It stays a style-path
alias instead of going into the shared token set, which the contract pins to the web.

**Canonicalise when writing, fold when converting.** `_styled_settings` writes an N/A style under
`__NA__` directly, the key the stored settings already use, so a restyle overwrites the stored
style in the visualization state and no precedence question arises. The converter then folds
whatever N/A spellings remain (older flat settings keyed `""` or `<NA>`, frequencies keyed by data
spellings, a stray `N/A` category from an older run) into `__NA__`, with `__NA__` first and the
rest in sorted order. Folding only in the converter would have to guess which of two colours is
the new one.

Alternative considered: make `resolve_style_key` return `__NA__`. It is also the showcase build's
"would `style` accept this key" check and documents returning a key the data holds; keeping that
contract and canonicalising one step later changes fewer callers.

**The `none` exclusion goes.** It kept TMbed's negative category styleable apart from N/A, but the
web has always drawn `none` as N/A, so a style on that "category" never applied. With the label
renamed, `none` is N/A everywhere.

**Template lists N/A once, as `__NA__`.** The styles file round-trips through `resolve_style_key`,
which accepts `__NA__` whenever the column has a missing cell; several N/A rows with separate
colours could only ever produce one.

**Remove the dead default-grey loop.** The converter's "N/A gets light grey" loop looks for `""`,
`<NA>` and `NaN` keys that the renaming has already turned into `__NA__`, so it never ran. The
web's default N/A colour applies, as it already did.

## Risks / Trade-offs

- [A styles file used a non-N/A spelling such as `none` as a real category] → The web never
  showed it as one; the style now reaches N/A, which is what that cell displays.
- [Folding changes the zOrder of an annotation whose stored settings held a stray `N/A`
  category] → Only for settings an older `protspace style` wrote, where that category was
  already invisible to the web.
