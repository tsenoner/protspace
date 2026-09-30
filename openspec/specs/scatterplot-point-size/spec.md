# scatterplot-point-size Specification

## Purpose

How large the scatter plot draws each dot, and everything that has to agree with it. Covers the
radius formula and its growth with zoom and plot area, the hover hit radius, the legend's shape
size range and default, how a picked size is kept per dataset and carried in bundles as a top-level
`shapeSize`, and how exported images scale their dots against the live view. The EAT endpoint halo,
which is sized from the same drawn radius, is specified in `eat-provenance-connectors`.

## Requirements

### Requirement: A dot's radius SHALL follow its point size, the zoom and the plot area

The renderer SHALL draw a dot with radius `√pointSize / 3` CSS px, multiplied by a point scale of
`clamp(k, 1, 256)^¼ · clamp((w · h / (1000 · 700))^¼, 0.8, 1.5)`, where `k` is the zoom factor and
`w × h` the plot's size in CSS px. The device pixel ratio SHALL be applied on top in the shader, so
a dot has the same CSS size on every pixel density. The point scale SHALL reach the GPU as a
uniform, so a camera move uploads no vertex data.

#### Scenario: Zooming in

- **WHEN** the user zooms from 1× to 16×
- **THEN** every dot's radius doubles, and it grows by no more than 4× at any zoom

#### Scenario: Zooming out

- **WHEN** the user zooms out below 1×
- **THEN** dots keep their zoom-1 size

#### Scenario: A large plot

- **WHEN** the plot is 2000 × 1400 CSS px, four times the reference area
- **THEN** dots are about 1.41× the size they have on a 1000 × 700 plot, and no plot makes them
  more than 1.5×

#### Scenario: A zoom frame

- **WHEN** the user zooms and the point scale changes
- **THEN** zero bytes are uploaded to the GPU for that render pass

### Requirement: Hover hit-testing SHALL use the drawn dot radius

The scatter plot SHALL pick the point under the pointer within the dot's drawn radius, including
the zoom and plot-area scale, with a floor of 4 CSS px.

#### Scenario: A zoomed-in dot

- **WHEN** the user hovers a dot at 16× zoom, just inside its drawn edge
- **THEN** the dot is picked

#### Scenario: A small dot

- **WHEN** a dot's drawn radius is below 4 px
- **THEN** the pointer still picks it within 4 px of its centre

### Requirement: The legend shape size SHALL default to 10 and never exceed 64

The legend's shape size SHALL default to 10, which is point size 80. The settings dialog SHALL
accept whole sizes from 1 to 64 and SHALL cap a larger entry at 64, showing the capped value. A
larger size from a bundle, top-level or per-annotation, or from browser storage SHALL be capped at
64 as well, and a capped top-level bundle size SHALL be stored as 64. The point size SHALL be
`max(10, round(8 · shapeSize))`.

#### Scenario: Default

- **WHEN** a dataset loads with no stored or bundled shape size
- **THEN** the shape size is 10 and dots are drawn at point size 80

#### Scenario: Oversized entry

- **WHEN** the user types 640 into the shape size field
- **THEN** 64 is applied and the field shows 64

#### Scenario: Oversized bundle size

- **WHEN** a bundle with a top-level `"shapeSize": 200` is imported
- **THEN** dots are drawn at shape size 64 (point size 512) and 64 is stored for the dataset

#### Scenario: Oversized stored size

- **WHEN** the browser holds a shape size of 200 for the dataset or the annotation
- **THEN** the legend loads it as 64

### Requirement: A picked shape size SHALL hold for every annotation of the dataset

A shape size the user picks SHALL be stored once per dataset in the browser and SHALL apply to every
annotation of that dataset. Reset in the settings dialog SHALL return it to 10. Until the user picks
a size, an annotation's own stored or bundled size SHALL apply.

#### Scenario: Switching annotations

- **WHEN** the user picks shape size 20 and then switches to another annotation
- **THEN** the dots stay at shape size 20

#### Scenario: Reloading

- **WHEN** the user reloads the page on the same dataset
- **THEN** the picked size is restored

### Requirement: Bundles SHALL carry a picked shape size as a top-level `shapeSize`

A bundle exported with legend settings SHALL carry a top-level `shapeSize` only when a size was
picked or applied from a bundle, and SHALL then also write that value into each annotation's
`shapeSize` for older readers. On import, a top-level `shapeSize` SHALL override every
per-annotation `shapeSize`. A per-annotation `shapeSize` of exactly 30, the filler earlier writers
emitted, SHALL read as the default.

#### Scenario: Export after picking a size

- **WHEN** the user picks shape size 20 and exports a bundle with legend settings
- **THEN** the settings carry `"shapeSize": 20` at the top level and in every annotation's entry

#### Scenario: Export without picking a size

- **WHEN** the user exports a bundle with legend settings without ever picking a size
- **THEN** the settings carry no top-level `shapeSize`

#### Scenario: Import of a bundle with a top-level size

- **WHEN** a bundle with top-level `"shapeSize": 20` and a per-annotation `"shapeSize": 12` is
  imported
- **THEN** every annotation draws at shape size 20

#### Scenario: A bundle written before this change

- **WHEN** a bundle whose annotations store `"shapeSize": 30` is imported
- **THEN** the dots are drawn at the default shape size 10

### Requirement: Exported dots SHALL use the live point scale at the export's zoom

Quick Export PNG and PDF SHALL render dots with the point scale of the live view at its current
zoom, so the figure matches the screen. The Figure Editor SHALL render the full view at zoom 1, so
its dots are at the zoom-1 size, and its zoom insets SHALL use the same zoom-1 point scale, times
their own Dot size factor. Both SHALL use the live plot's CSS size for the plot-area factor.

#### Scenario: Quick Export while zoomed in

- **WHEN** the user is at 16× zoom and uses Quick Export PNG
- **THEN** the exported dots are twice their zoom-1 size, as on screen

#### Scenario: Figure Editor while zoomed in

- **WHEN** the user is at 16× zoom and opens the Figure Editor
- **THEN** the preview and the export show the full view with dots at their zoom-1 size
