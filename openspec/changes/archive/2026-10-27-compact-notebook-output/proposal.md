## Why

A Generate run on the Snake Toxin example in Colab left a screen of blank space under the panel,
and the panel, the EAT cell and the notebooks' introductions said more than people read. Colab
keeps an empty slot for every closed widget, and UniProt's "Resolving inactive entries" bar opens
and closes once per batch. Several package log lines (bundle saved, projections applied,
reference-file downloads) repeated what the status card and the progress bar already show.

## What Changes

- The Preparation notebook never draws a transient progress bar (`leave=False`); the bar around it
  stays.
- The panel leaves out the package lines its card or progress bar repeats, each pinned to the
  package's source, and no longer prints its own "Processed …" and "Bundle written …" lines.
- Shorter text throughout the three notebooks: introductions, form descriptions, tab hints, status
  cards and the EAT cell, with the same information.

## Capabilities

### Modified Capabilities

- `notebook-input-handling`: the panel's output stays compact.

## Impact

The three notebooks and `tests/test_notebooks.py` (`tests/test_custom_annotations.py` finds the
custom-CSV hint by its new opening). No package change.
