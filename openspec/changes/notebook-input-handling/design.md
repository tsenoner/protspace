## Context

Cell 2 of `ProtSpace_Preparation.ipynb` is one ipywidgets panel: an Accordion with Input (tabs
Example / Upload H5 / Upload FASTA / UniProt Query), Methods, Annotations and Quality statistics,
then Generate and an Output. Cell 1 installs the _released_ protspace, which lags the notebook
(served from `main`) by up to one release, so any package name the notebook uses that this
release adds must be imported under a guard with a fallback.

Colab today ships ipywidgets 7.7.1; local Jupyter and this repo's dev lock have 8.1.8, where
`FileUpload.value` is a tuple of dicts instead of a dict keyed by file name. Every widget
callback runs on the kernel's single shell queue, so a busy kernel freezes the whole panel.

## Goals / Non-Goals

**Goals:** a pre-generated HDF5 of realistic size gets from the user's computer or Drive into
Generate, named correctly; a missing input is said out loud; the panel never sits dead behind
network I/O or an invisible exception.

**Non-Goals:** 3-D projections (2-D only is the product decision; the panel keeps `+ "2"`);
running Generate in a background thread; chunked widget uploads (`ipyuploads`, a new
dependency); restructuring the panel into separate cells.

## Decisions

**1. Upload in a cell of its own, not from a button.** `google.colab.files.upload()` renders an
`<input type=file>` into the _current output_ and then blocks on `eval_js`, whose request is
routed by `kernel.shell.parent_header` (colabtools `files.py`, `output/_js.py`). Inside a widget
callback the parent is the comm message of the click, not a cell execution, and we found no
documentation or report that the picker renders and replies there; a picker that never answers
would block the kernel with no timeout, which is the very symptom being fixed. A top-level cell
is the documented use, and it is what the Embeddings notebook does. The cell sits above the
panel so the order reads "get the file in, then configure"; it runs `files.upload()` only when
its `upload_from_computer` checkbox is ticked, so _Run all_ passes straight through. Each run
uploads into a fresh `upload-…` folder (`files.upload(target_dir=...)`): colabtools saves a name
that already exists as `x (1).h5`, so a corrected file re-uploaded under the same name would
otherwise leave the panel on the old one, and the suffix would hide a model key at the end of the
name. The cell builds the path from that folder and the bare file name, which holds whether
Colab keys its result by the saved path (current colabtools) or by the original name. It puts
the path into the H5, FASTA or CSV path field by extension, and loads it, when the panel exists,
or into `uploaded_paths`, which the panel reads when it is built. _Load_, and Generate for the
CSV, gunzip a `.gz`, whichever route brought it.
_Alternative — a button calling `files.upload()`:_ rejected as unverified and, if wrong,
kernel-blocking. _Alternative — keep `FileUpload` with a size warning:_ rejected; the failure is
silent, so a warning would be the only signal and it cannot be shown at the moment it matters.

**2. Path fields are the single source for H5 and FASTA.** Files pane, Drive and the upload cell
all end as a path, so one _Load_ button validates it ("no file at …", "Ready: N proteins, D
dims, embedding name X (from …)"). The custom CSV keeps a `FileUpload` because CSVs are small,
but the upload only writes the file and fills the CSV path field; Generate reads the field.

**3. Auto-detect uses the package's resolver when it exists.** `resolve_input_names([(path,
None)], command="prepare")` gives the same name the CLI would. It is imported under
`except ImportError`; the fallback (protspace <= 4.16.5) uses the `model_name` attribute, then
the same file-name rule over the released `MODEL_DISPLAY_NAMES`, then the stem, and a test runs
the panel without the resolver and compares the names. The resolver's INFO line tells CLI users
to append `:<model>`, which the path field does not take, so Auto-detect silences that logger
while it runs; the Ready line and the Embedder dropdown carry the override instead. A chosen
embedder is always passed as the name.

**4. Each tab holds its own input; Generate reads the selected tab.** `input_args` becomes a
dict keyed by tab index. The Example tab's entry is set at build time without fetching; the
fetch happens in Generate, inside the output, with `urlopen(..., timeout=60)` into a `.part`
file. Before any work Generate prints the input it will use (source, file, protein count, and
for HDF5 the embedding name).

**5. Busy and error states.** Generate sets `gen_btn.disabled = True` and restores it in
`finally`. The observers that run outside an `Output` (`_toggle`, `_update_params`,
`_sync_backend_ui`, `_on_tab_change`) are wrapped with `gen_out.capture()`, as the ipywidgets
docs recommend for callbacks, so a raised exception appears in the panel. A handler on the
`protspace` logger prints INFO lines through `print`, so they land in whichever Output is
capturing, giving Generate visible progress and the name-inference line.

**6. Version-agnostic `FileUpload`.** One helper reads the first file as `(name, bytes)` from a
dict (7) or a tuple of dicts (8), with `bytes(...)` around the content (a `memoryview` in 8).

**7. Metric, `min_dist`, CSV-only.** The metric dropdown lists the CLI's `Metric` enum and sits in
a group shown for UMAP and t-SNE, the reducers that read it. `min_dist` was 0.1 in the panel
until the 2026-03-28 rewrite (78d5d16) set 0.4 with no stated reason, while the CLI stayed at 0.1;
it goes back to 0.1. The rewrite's commit says "Annotations: Default, All, Custom (no None
option)"; _CSV only_ keeps that intent (no bundle without annotations) by refusing to run
without a CSV.

**8. Tests run the real cells.** `test_notebooks.py` executes cells 1-3 (install, upload, panel) with the installed
ipywidgets, a mocked `google.colab`, a stubbed `pip`, and no network (the example is pre-seeded;
annotations are CSV only), then drives the panel: Load an unnamed ClickThrough-style file,
Generate, read the bundle. The `files.upload` mock renames an existing name as colabtools does.
Further tests cover the button being disabled during a run, CSV only without a CSV, a failed
example fetch, a gzipped CSV and a cosine UMAP. CI has ipywidgets 8; the same tests pass under 7.7.1 with
`uv run --with ipywidgets==7.7.1 pytest tests/test_notebooks.py`, and the upload helper is also
tested against both value shapes directly.

## Risks / Trade-offs

- [Two steps for a computer upload: tick, run] → stated in the cell and the docs; Files-pane
  drag-and-drop and Drive need neither.
- [A ticked checkbox makes the next Run all wait at the picker] → the cell says to untick it
  afterwards, and the picker can be cancelled; the panel is built once it returns.
- [INFO logging is chattier] → it is shown only inside the panel's outputs.
- [The panel stops `protspace` log records propagating to the root logger] → the notebook
  configures no other handler, so nothing is lost; the notebook tests restore the logger.
