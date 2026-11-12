## MODIFIED Requirements

### Requirement: The Contours control SHALL offer Off, Auto and Always

The view bar SHALL offer a Contours menu with the modes Off, Auto and Always, in that order, with
Off as the default. Where the view bar has moved Contours into its More menu, and on a phone in the
More sheet, the same three modes SHALL be offered there and SHALL act as a pick in the menu does.
Always SHALL be the `on` value of `densityLayer` and of the URL. Each mode SHALL show a one-line
hint: Off "No contours", Auto "Fades out as you zoom in; faint or hidden when few points are shown",
Always "Full strength at every zoom level". A pick SHALL show on the trigger at once and, after the
next paint, SHALL dispatch `density-layer-change` with `{ densityLayer }`, which sets the scatter
plot's `densityLayer` configuration; picking the mode already in use SHALL dispatch nothing. The
trigger SHALL show the word "Contours" followed by the mode's name, "Off", "Auto" or "Always", which
together are its accessible name, and its tooltip SHALL say that there is one ring set per legend
colour and that contours are not included in exports. The menu SHALL be operable from the keyboard:
Enter or Space opens it on the current mode, the arrow keys and Home/End move the highlight, Enter
or Space picks the highlighted mode, and Escape closes it.

#### Scenario: Default mode

- **WHEN** a dataset loads with no `density` URL parameter
- **THEN** the Contours mode is Off, the trigger reads "Contours Off", and the plot draws points
  only

#### Scenario: Picking a mode

- **WHEN** the user picks Always from the Contours menu
- **THEN** the menu closes, the trigger reads "Contours Always", the plot draws contours, and
  `density-layer-change` fires with `{ densityLayer: 'on' }` after the next paint

#### Scenario: Keyboard use

- **WHEN** the trigger has focus and the user presses Enter, then the down arrow, then Enter
- **THEN** the menu opens on the current mode and the next mode is picked
