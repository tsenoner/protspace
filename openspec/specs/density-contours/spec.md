# density-contours Specification

## Purpose

The density contour layer the scatter plot can draw over its points, so a user can see where each
category concentrates, even where its points overlap. Covers the Off/Auto/Always control and its URL
parameter, one ring set per visible legend colour, how Auto fades with the visible point count, the
plot size and the zoom, the draw order against selected points, independence from the screen's
pixel density and size, when GPU resources are allocated, how a device that cannot draw the layer
says so, the exclusion from image exports, and the perf scenarios that measure the layer. It is
distinct from `scatterplot-point-size`, which governs the dots the layer is drawn between.

## Requirements

### Requirement: The Contours control SHALL offer Off, Auto and Always

The control bar SHALL offer a Contours menu with the modes Off, Auto and Always, in that order, with
Off as the default. Always SHALL be the `on` value of `densityLayer` and of the URL. Each mode SHALL
show a one-line hint: Off "No contours", Auto "Fades out as you zoom in; faint or hidden when few
points are shown", Always "Full strength at every zoom level". Choosing a mode SHALL set the scatter
plot's `densityLayer` configuration (when the control bar auto-syncs) and SHALL dispatch
`density-layer-change` with `{ densityLayer }`. The trigger SHALL read "Contours" while the mode is
Off, and "Contours: Auto" or "Contours: Always", styled as active, otherwise; its accessible name
SHALL name the mode, and its tooltip SHALL add that there is one ring set per legend colour and that
contours are not included in exports. The menu SHALL be operable from the keyboard: Enter or Space
opens it, the arrow keys and Home/End move the highlight, Enter or Space picks the highlighted mode,
and Escape closes it.

#### Scenario: Default mode

- **WHEN** a dataset loads with no `density` URL parameter
- **THEN** the Contours mode is Off, the trigger reads "Contours", and the plot draws points only

#### Scenario: Picking a mode

- **WHEN** the user picks Always from the Contours menu
- **THEN** the menu closes, the trigger reads "Contours: Always" and shows as active, the plot draws
  contours, and `density-layer-change` fires with `{ densityLayer: 'on' }`

#### Scenario: Keyboard use

- **WHEN** the trigger has focus and the user presses Enter, then the down arrow, then Enter
- **THEN** the menu opens on the current mode and the next mode is picked

### Requirement: The Contours mode SHALL persist in the URL as `density`

The web app SHALL mirror the Contours mode in the page URL as `density=auto` for Auto or
`density=on` for Always, and SHALL omit the parameter for Off when it writes the URL. A URL value
SHALL be applied on load and on back/forward navigation. An invalid or empty value SHALL be treated
as Off and removed from the URL; a repeated parameter SHALL be normalized to its first value.

#### Scenario: Shared link

- **WHEN** a user opens a link carrying `density=on`
- **THEN** the Contours mode is Always once the dataset has loaded

#### Scenario: Switching back to Off

- **WHEN** the user picks Off
- **THEN** the `density` parameter is removed from the URL

#### Scenario: Invalid value

- **WHEN** the URL carries `density=heatmap`
- **THEN** the mode is Off and the parameter is removed

### Requirement: Each visible legend colour SHALL get its own ring set

The density layer SHALL build one density field per distinct staged point colour, counting only
points drawn with non-zero opacity, and SHALL draw each field's contour rings in that colour. Rings
SHALL mark successive doublings of density above a floor equal to the density of 5 points in one
grid cell, with nothing drawn below the floor and at most five rings per colour, over a translucent
fill taken from the densest colour at each pixel. Up to 16 colours SHALL get their own rings;
beyond that, the 15 most populous colours SHALL keep theirs and every other colour SHALL share one
grey ring set.

#### Scenario: Two overlapping categories

- **WHEN** two categories with different colours overlap in the plot
- **THEN** both ring sets are drawn, each in its own colour

#### Scenario: A hidden category

- **WHEN** the user hides a category in the legend
- **THEN** that category contributes to no field and draws no rings

#### Scenario: Sparse points

- **WHEN** a colour has fewer than 5 points anywhere within one blur radius
- **THEN** no ring is drawn for it there

#### Scenario: More than 16 colours

- **WHEN** the selected annotation shows 20 distinct colours
- **THEN** the 15 most populous colours keep their own rings and the other 5 share one grey ring set

### Requirement: Auto SHALL fade by visible count, plot size and zoom; Always SHALL draw at full strength

In Auto, the layer's strength SHALL follow Embedding Atlas's crossfade with the visible point count
as its maximum density: with `T = √(1024 · N_visible) / D`, where `D` is the plot's longer side in
CSS px, the layer SHALL be at full strength while the zoom `k ≤ T·e^−½`, absent once `k ≥ T·e^½`,
and blended in between. The strength SHALL depend on nothing else; in particular Auto SHALL NOT
measure how much points overlap. In Always, the layer SHALL be at full strength at every zoom
whenever any point is visible. Auto and Always SHALL otherwise draw the same rings and fill.

#### Scenario: Small dataset on Auto

- **WHEN** fewer than about 360 points are visible on a 1000 px plot at zoom 1 with Auto
- **THEN** no contours are drawn

#### Scenario: Zooming in on Auto

- **WHEN** Swiss-Prot's 573K proteins are shown on a 1000 px plot with Auto and the user zooms past
  about 40×
- **THEN** the contours have faded out and only points remain

#### Scenario: Always

- **WHEN** the mode is Always
- **THEN** contours are drawn at full strength regardless of point count or zoom

### Requirement: The layer SHALL draw between the unselected and the selected points

The density layer SHALL be composited after the unselected points and before the selected points,
so a selection is never covered by rings or fill.

#### Scenario: Selection over contours

- **WHEN** contours are on and the user selects proteins inside a dense region
- **THEN** the selected points draw on top of the rings and fill

### Requirement: Contours SHALL NOT depend on the screen's pixel density or size

The density grid SHALL span the plot with 512 cells on its long side (fewer only when the canvas
itself is smaller), and the blur and ring levels SHALL be defined in grid cells, so ring positions
depend only on the data and the view. Contour line width SHALL be fixed in CSS px.

#### Scenario: Same view on two screens

- **WHEN** the same dataset and view are shown at device pixel ratio 1 and 2
- **THEN** the rings sit at the same places and the lines have the same CSS width

#### Scenario: Browser zoom

- **WHEN** the user changes the browser zoom and the plot keeps its aspect ratio
- **THEN** the rings keep their positions relative to the data

### Requirement: Density resources SHALL be allocated only when a frame draws the layer

The renderer SHALL NOT compile density programs or allocate density targets while the mode is Off
or Auto's strength is zero. It SHALL reallocate targets only when the grid size changes, and SHALL
reuse the blurred fields when none of their inputs (the staged points, the canvas size, the pixel
ratio, the camera) has changed. A camera move with contours on SHALL upload no vertex data. A
density shader or target failure SHALL disable only the density layer for that context, and a
context loss SHALL let the next context try again.

#### Scenario: Contours never turned on

- **WHEN** a session runs with the mode Off throughout
- **THEN** no density program or target is created

#### Scenario: Hover with contours on

- **WHEN** the pointer moves over the plot without moving the camera
- **THEN** the fields are composited from cache, not re-accumulated

#### Scenario: Pan with contours on

- **WHEN** the user pans or zooms with contours on
- **THEN** zero bytes are uploaded to the GPU for that render pass

#### Scenario: A density target cannot be allocated

- **WHEN** the density targets are incomplete on a device
- **THEN** the layer is disabled and the points keep rendering through the linear-light pipeline

### Requirement: An unavailable layer SHALL be reported to the user once

The renderer SHALL emit `renderer-degraded` with reason `density-unavailable` and the cause, at most
once per context, when the mode is Auto or Always, points are loaded, and the layer cannot draw
because the context lacks float render targets or float blending or a density shader or target
failed. The application SHALL show it as a notice whose message reads "Contours are unavailable on
this device, so the Contours setting has no effect. Points are drawn as usual.", followed by the
cause. The URL SHALL keep its `density` parameter.

#### Scenario: iPhone or iPad

- **WHEN** a link with `density=on` is opened in a browser without `EXT_float_blend`
- **THEN** once the dataset has loaded a single `density-unavailable` notice names the missing
  extension, the points render as usual, and the URL still carries `density=on`

#### Scenario: Contours off

- **WHEN** the same device renders with the mode Off
- **THEN** no density notice is shown

### Requirement: Image exports SHALL NOT include the density layer

Quick Export PNG and PDF, the Figure Editor and its zoom insets SHALL render the points without the
density layer until an export can match the screen's rings. The Figure Editor preview SHALL show
the same output as its export. The documentation SHALL state the limitation.

#### Scenario: Export with contours on

- **WHEN** the user exports a PNG with Contours set to Always
- **THEN** the image shows the points and legend without rings or fill

### Requirement: The perf harness SHALL measure the density layer

The WebGL perf harness SHALL include `densityZoom` (the zoom cycle) and `contourDrag` (the
continuous drag) scenarios that force the mode to `on` (Always) for their duration, drive the camera
through the same path as the other camera scenarios, and restore the plot's previous `densityLayer`
afterwards. Both SHALL count as camera scenarios, whose passes upload zero bytes.

#### Scenario: Restoring the mode

- **WHEN** the harness runs `densityZoom` on a plot whose mode was Off
- **THEN** the mode is Off again when the scenario ends

#### Scenario: Upload check

- **WHEN** `contourDrag` records its passes
- **THEN** every pass reports zero uploaded bytes
