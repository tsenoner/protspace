## MODIFIED Requirements

### Requirement: The install cell stops when pip changed a loaded package

The install cell of each Colab notebook SHALL install without replacing a distribution this
session has already imported, holding each such distribution at its loaded version, and SHALL use
a plain install only when that cannot be resolved. As a safety net, it SHALL stop with a message
naming every loaded distribution whose installed version changed anyway, and telling the user to
restart the session and run the cell again. Once it has stopped, it SHALL stop again on every
re-run in the same session, and SHALL pass after a restart when nothing changes.

#### Scenario: Colab had numpy loaded and protspace's dependencies ask for a newer one

- **WHEN** numpy 2.1.3 is imported before the install, and a dependency of protspace declares
  numpy >= 2.4.1
- **THEN** the install keeps numpy 2.1.3, and the cell completes without asking for a restart

#### Scenario: A loaded package changed all the same

- **WHEN** the installed version of a loaded distribution changed during the install
- **THEN** the cell stops, naming it with both versions and _Runtime → Restart session_

#### Scenario: Re-running without a restart

- **WHEN** the cell stopped once and the user runs it again in the same session
- **THEN** it stops again with the same names

### Requirement: The Methods sliders stay within the accepted ranges

Every Methods slider SHALL offer only values the installed protspace accepts for its parameter,
with its default on the slider's step grid. Perplexity SHALL be an integer slider from 5 up to the
installed protspace's ceiling (500 when it has none). Before Generate does any work, the panel
SHALL check the selected methods' parameters against the input's protein count. It SHALL say so
under the sliders while they change, and refuse at Generate. Every visible slider SHALL keep a
track at least 120 px wide at any panel width, the parameter groups wrapping to new rows.

#### Scenario: Perplexity 30 on 20 proteins

- **WHEN** t-SNE is selected with perplexity 30 for an `.h5` of 20 proteins
- **THEN** the Methods section says the perplexity is not below 20 proteins, and Generate stops
  before loading anything

#### Scenario: Every method at 1440 px

- **WHEN** all six methods are selected and the panel is 1,440 px wide
- **THEN** every slider track is at least 120 px wide

## ADDED Requirements

### Requirement: Generate shows where the run stands until the download starts

Generate SHALL show the step it is on as "Step k of n" with the step's name, a progress bar, and
the time since the click, refreshed while a step runs. The reduction step SHALL count its
projections. The last step SHALL show the bundle's size while the download is prepared. The final
state SHALL say that the download started and that the browser saves the file when the transfer
ends, and the panel SHALL offer every bundle in the runtime's `output/` folder for download by a
button.

#### Scenario: A run on an .h5 with PCA and UMAP

- **WHEN** Generate runs on an `.h5` with PCA and UMAP selected
- **THEN** the panel shows steps 1 to 5, including "Reducing dimensions (UMAP 2, 2 of 2)" and
  "Preparing the download", and ends with a full bar and "Download started"
- **AND** the bundle is listed for a Download bundle click

### Requirement: The panel is checked by a rendering harness

The repository SHALL contain a harness that renders the Preparation panel with ipywidgets 7.7.1
and 8 in a headless browser. It SHALL go through panel widths, light and dark themes, method
selections and accordion sections. In each state it SHALL check slider track widths, horizontal
overflow, text contrast and the visibility of Generate, and it SHALL fail when a check fails.

#### Scenario: A regression in the dark-mode headers

- **WHEN** the harness runs on a notebook whose collapsed section titles are near-black in Colab's
  dark mode
- **THEN** it reports their contrast for each state and exits with failure
