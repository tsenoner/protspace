# Preparation panel harness

Renders the Colab Preparation notebook's control panel headlessly and checks it state by state, so
a layout or contrast change can be judged without a manual Colab pass.

```bash
# from the repo root, after `pnpm install` (Playwright) — about 2 minutes per ipywidgets version
uv run --directory apps/protspace python scripts/notebook_harness/harness.py
uv run --directory apps/protspace python scripts/notebook_harness/harness.py --widgets 7 --out /tmp/h
# the same sweep on another version of the notebook, e.g. main's, for a before/after
git show main:apps/protspace/notebooks/ProtSpace_Preparation.ipynb > /tmp/main.ipynb
uv run --directory apps/protspace python scripts/notebook_harness/harness.py --notebook /tmp/main.ipynb --no-progress
```

`harness.py` runs the notebook's own cells in Voila, with `google.colab` and `pip` stubbed and a
small demo dataset loaded (90 `TRINITY_` proteins, a custom CSV). It does this once for
ipywidgets 7.7.1, which Colab ships, and once for 8, which CI uses. `sweep.mjs` (headless
Playwright, no focus-stealing window) then goes through every combination of:

- viewport width: 1440, 1280, 1024 and 800 px (`--widths`);
- theme: Colab light, and Colab dark approximated;
- methods: none, one, all six;
- accordion section: all closed, or each one open.

That is 120 states per ipywidgets version, each with a screenshot and these checks:

- every visible slider track is at least 120 px wide;
- no control reaches past the panel, and the page never scrolls sideways;
- text contrast is at least 4.5:1 (3:1 for large text and placeholders). This covers the collapsed accordion
  titles, tab labels, buttons and hints;
- Generate is visible.

A second page slows every step down, clicks Generate on the demo data, then runs the EAT cell, and
screenshots each status the panel shows (`progress-*.png`). Every failure is listed in
`report.json` in the output directory (a temporary one unless `--out` is given), and the exit status is
1 when any check fails. `PROTSPACE_NOTEBOOK_HARNESS=1 uv run pytest tests/test_notebook_harness.py`
runs it from the test suite; normal CI does not, since it needs a browser and two Voila servers.

## What the local render cannot show

The dark theme is an approximation. Colab runs the widgets' light-theme CSS and bridges only
`--jp-ui-font-color1` and the layout colours to its own; the harness sets the same variables to
Colab's colours. Checking something that depends on more than that needs a real Colab session,
for example:

- the Colab frame's own fonts, form headers and output scroll box;
- the browser download that `files.download()` starts (stubbed here; it only prints);
- GPU embedding.
