## Context

`packages/utils/src/visualization/missing-values.ts` calls itself the single source of truth
for missing values, and on the TypeScript side it is: every reader path goes through
`normalizeMissingValue`. The Python side has two lists. `MISSING_VALUE_TOKENS` feeds
`standardize_missing` (the Dash plot), `stats/annotation_select.py` and `cli/transfer.py`,
each of which wraps it differently (exact match; exact match plus display forms; stripped
exact match). `BROWSER_MISSING_TOKENS` was added for the v3 encoder as a copy of the web's
set, pinned by a Python test that pulls the set out of the `.ts` source with a regex.

## Goals / Non-Goals

**Goals:**

- One Python definition of "missing", identical to the web's in tokens and in matching rule.
- Every Python consumer of it reads a cell the way the web reader does.
- A test that fails when either side changes alone, run on every pull request.
- A test that fails when a producer starts writing a category spelled like a missing value.

**Non-Goals:**

- Folding tokens in the bundle writer. The v3 encoder keeps the token it was given (the
  docstring of `_missing_mask` gives the reasons); only the reader folds.
- The style-key N/A aliases (`_NA_LABELS`), which map one N/A spelling to another between a
  styles file and the data, and deliberately keep `none` apart from `None`.
- Per-hit missing values in multi-hit cells. The web drops a missing spelling inside
  `A;none`; Python consumers judge the whole cell. No producer writes such a cell.

## Decisions

**Mirror `normalizeMissingValue`, not just its set.** `is_missing_value(value)` returns true
for `None`, a non-finite real number, or a string that is blank or a token after `strip()`
and `lower()`, and false for anything else, as the TypeScript function does. A shared set
with per-consumer matching is what drifted; a shared predicate cannot.

**Store the tokens lower-case and without the blank string.** The web lower-cases the cell and
handles blank separately, so an upper-case entry in either set could never match. Python
keeps the same shape, so the two sets compare equal directly.

**Pin it in the contract suite, not with a regex over the `.ts` file.** The contract job runs
on every pull request without a path filter and imports the real `MISSING_VALUE_TOKENS` and
`normalizeMissingValue`. The generator writes Python's set and Python's verdict on a list of
probe spellings (each token in several cases, padded, blank, near misses such as
`non-transmembrane`) to the manifest, following the suite's rule that the producer publishes
its expectations instead of the reader copying them. The set check catches a token added on
one side; the verdict check catches a change in matching (case, trimming, blank). The regex
test is removed: it ran only on Python-side changes and checked the source text, not the
running set.

Alternative considered: a bundle variant whose cells are the probes, read through the full
conversion path. It would cover the same rule at the cost of another CLI run and fixture
variant; the reader already applies `normalizeMissingValue` at every ingestion point.

**Each consumer, decided:**

- `standardize_missing` (Dash plot): judge the raw value before `astype(str)`, so `None` and
  NaN are caught as values rather than as the strings `"None"`/`"nan"`, then replace with
  `<N/A>`. This also fixes null cells showing as a `None` category.
- `stats`: `is_missing_value`, plus the display forms pandas and `standardize_missing` leave
  behind (`<N/A>`, `<NA>`, `<NaN>`, `NaT`). Those are not producer spellings, so they stay
  local to `stats`.
- `transfer`: `is_missing_value` as is. A cell the web shows as N/A is a query, never a
  reference label.

**Vocabulary guard in two parts.** A behavioural test runs each fixed producer (TMbed
transmembrane and signal peptide, InterPro signal peptide, PDB cross-reference, fragment,
UniProt `reviewed`, the canonical and Arrow boolean labels) and checks no output, nor any
hit of a multi-hit output, is missing. A literal scan walks the AST of
`data/annotations/` and `data/parsers/` and fails on any string constant spelled like a
token, which catches a vocabulary the first part does not list yet.

## Risks / Trade-offs

- [A user CSV with a real category spelled `None` or `N/A` now reads as missing in Python
  too] → It already read as missing in the web app, which is where users look; Python now
  agrees instead of quietly differing.
- [The literal scan flags a legitimate string that is not a cell value] → Today it finds
  none in the scanned packages; a future false positive is fixed by narrowing the scan or an
  explicit allow-list in the test, with the reason next to it.
- [The probe table can miss a matching difference it does not probe] → The set check covers
  tokens; the probes cover each rule `normalizeMissingValue` applies.
