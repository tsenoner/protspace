## ADDED Requirements

### Requirement: Measured runs pin the layout and the theme

The WebGL benchmark and the scale benchmark SHALL open the explore page in a browser context whose
stored state holds the default layout (the sidebar open at its default width) and the light theme,
and whose colour scheme is light. The sidebar's width sets the plot's size, which feeds the point
scale and the Auto contour strength, and a dark plot draws other colours, so an unpinned layout or
theme would make runs incomparable. The pinning SHALL live in the harness's context, beside the
tour suppression, not in a branch of application code.

#### Scenario: A benchmark run opens the application

- **WHEN** the benchmark or the scale run opens the explore page
- **THEN** the sidebar is open at its default width, the theme is Light, and the browser reports a
  light colour scheme, whatever layout or theme the developer's own browser has stored

#### Scenario: A normal visit

- **WHEN** a user opens the explore page outside the benchmark
- **THEN** their stored layout and theme apply
