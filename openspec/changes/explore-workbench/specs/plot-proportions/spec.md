## ADDED Requirements

### Requirement: Both axes share one scale

The scatterplot SHALL draw a projection with one pixels-per-unit for x and y, so distances read
the same in every direction whatever the plot's shape. The data's extent, padded by 5 % of its
span on each side, SHALL be fitted inside the plot's margins and centred along the axis that has
room to spare; an axis whose span is zero SHALL take the full range of its side and stay finite.

#### Scenario: A wide plot

- **WHEN** the plot is wider than the padded data's aspect
- **THEN** y uses its full range, x is narrowed to the same pixels-per-unit and centred

#### Scenario: A tall plot

- **WHEN** the plot is taller than the padded data's aspect
- **THEN** x uses its full range, y is narrowed to the same pixels-per-unit and centred

#### Scenario: A flat projection

- **WHEN** every point has the same x
- **THEN** x takes its full range and every position stays finite

### Requirement: An export keeps the plot's proportions

A quick export or a figure SHALL fit the same padded extent with one scale for both axes, centred,
inside margins scaled from a fixed reference, so the exported figure has the live plot's shape at
the same aspect.

#### Scenario: Exporting at another size

- **WHEN** the plot is exported at a size other than the screen's
- **THEN** the export fits the padded extent with one scale, centred, at the live plot's aspect

### Requirement: A panel change resizes the plot once

Collapsing or expanding the sidebar, or committing a new sidebar width, SHALL resize the plot once
and render it once, with or without reduced motion. Moving the legend/structure divider, popping
the structure out or docking it, and switching the theme SHALL NOT resize the plot.

#### Scenario: Collapse and expand

- **WHEN** the user collapses the sidebar and expands it again
- **THEN** the plot widens by the sidebar's width with one render, and narrows back with one

#### Scenario: Reduced motion

- **WHEN** the OS asks for reduced motion and the user collapses and expands the sidebar
- **THEN** the plot still resizes once each time

#### Scenario: Floating the structure

- **WHEN** the user pops the structure out over the plot
- **THEN** the plot keeps its size

### Requirement: A resize keeps the viewed centre

When the plot changes size, the data point under the centre of the view SHALL stay under the
centre at the same zoom; a view that was not zoomed SHALL stay fitted.

#### Scenario: Zoomed in across a collapse

- **WHEN** the user zooms in on a protein at the view's centre, then collapses and expands the
  sidebar
- **THEN** the same protein stays at the centre

#### Scenario: Not zoomed

- **WHEN** the view is fitted and the plot resizes
- **THEN** the view stays fitted to the new size

### Requirement: A zoom inset shows exactly its region

A figure's zoom inset that names an explicit data region SHALL map that region to the inset's full
area, with no padding and no margins, and SHALL draw only the points inside it.

#### Scenario: An inset from a source rectangle

- **WHEN** the user adds a zoom inset for a rectangle of the plot in the figure editor
- **THEN** the inset shows that rectangle's points filling its area
