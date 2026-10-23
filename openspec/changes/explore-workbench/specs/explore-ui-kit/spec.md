## ADDED Requirements

### Requirement: Menus, popovers and dialogs open in the top layer

Menus, popovers and tooltips SHALL open as popovers and dialogs as modal dialogs in the browser's
top layer, so no ancestor's overflow, transform or stacking can clip or cover them. A popover SHALL
sit next to its anchor and flip or shift to stay on screen, shrinking and scrolling when neither
side has room. A dialog SHALL be named by its heading, move focus inside on open, and return focus
to the control that opened it when it closes.

#### Scenario: A popover inside a clipping ancestor

- **WHEN** a popover opens from an anchor inside an ancestor with overflow hidden and a transform
- **THEN** the popover is fully visible

#### Scenario: A popover at the screen's corner

- **WHEN** a popover opens from an anchor at the bottom-right corner
- **THEN** it flips and shifts to stay on screen

#### Scenario: A dialog closes

- **WHEN** a modal dialog closes on Escape or its close button
- **THEN** focus returns to the control that opened it

### Requirement: Escape takes one step per press

Each Escape press SHALL do exactly one thing: close the topmost open layer (a menu, popover or dialog,
or an overlay such as a pinned tooltip or the projection details card); with no layer open, hide
the EAT connectors; then clear the selection; then return the selection tool to Move and zoom. A
control that uses the press itself, such as a tooltip hiding or the phone's open search closing,
SHALL keep it from these steps.

#### Scenario: Escape after an EAT click

- **WHEN** an EAT click shows connectors and a selection, and the user presses Escape three times
- **THEN** the first press hides the connectors and keeps the selection, the second clears the
  selection, and the third returns to Move and zoom

#### Scenario: A layer is open

- **WHEN** a popover is open over a selection and the user presses Escape
- **THEN** only the popover closes

### Requirement: A press outside closes the topmost layer

A press that starts and ends outside the topmost layer SHALL close it; a drag that starts inside
and ends outside, or a press that starts outside and ends inside, SHALL NOT. Content inside the
layer's shadow roots or slotted into it SHALL count as inside.

#### Scenario: Press outside

- **WHEN** the user presses and releases outside an open popover
- **THEN** it closes

#### Scenario: Drag out of a layer

- **WHEN** the user starts a drag inside an open popover and releases outside it
- **THEN** it stays open

### Requirement: An icon-only button is named by its label

An icon-only button SHALL take its label as its accessible name and SHALL show the same label as a
tooltip on keyboard focus or after 500 ms of mouse hover, hidden again by Escape, by leaving, or by
a press; a touch SHALL NOT show it. Its icon SHALL be a decorative Lucide SVG. A toggle SHALL
report its state through `aria-pressed`, and a menu button its menu through `aria-haspopup` and
`aria-expanded`.

#### Scenario: Name and tooltip

- **WHEN** an icon-only button with the label "Legend settings" gets keyboard focus
- **THEN** its accessible name is "Legend settings" and the tooltip shows that text

#### Scenario: Hover

- **WHEN** the mouse rests on the button for 500 ms
- **THEN** the tooltip shows, and it hides when the pointer leaves

#### Scenario: Icons

- **WHEN** a kit icon renders
- **THEN** it is an inline Lucide SVG hidden from assistive technology, at the size asked for

### Requirement: One focus ring for keyboard focus

Every control SHALL show one keyboard focus ring in the focus colour, on the control and not a
second one inside it, only on keyboard focus (not on hover); under forced colours the ring and
focused fields SHALL use system colours.

#### Scenario: A focused field

- **WHEN** a text field takes keyboard focus
- **THEN** one ring is drawn around the field

#### Scenario: Hover is not focus

- **WHEN** the mouse hovers a menu item that does not have keyboard focus
- **THEN** no focus ring is drawn on it

### Requirement: Motion follows the user's setting

When the user asks for reduced motion, kit and explore transitions and animations SHALL stop, and
the actions they accompany SHALL still complete.

#### Scenario: Reduced motion

- **WHEN** the OS asks for reduced motion
- **THEN** legend rows change without transitions and the tour does not animate

### Requirement: Counts read in the right plural

Every count the explore page shows in words SHALL be grouped in the browser's number format and
use the singular for one and the plural otherwise.

#### Scenario: One and many

- **WHEN** 1 protein and then 1,234 proteins are selected
- **THEN** the selection reads "1 protein selected" and then "1,234 proteins selected"

### Requirement: A disabled choice says why

An option of a segmented control MAY be disabled with a reason. A disabled option SHALL be
`aria-disabled` and stay focusable, SHALL look faint (`GrayText` under forced colours), SHALL be
skipped by the arrow keys, and a press or tap on it SHALL show its reason and select nothing.

#### Scenario: Pressing a disabled option

- **WHEN** the user presses a disabled option
- **THEN** its reason shows, the value does not change and no change event fires

#### Scenario: Arrow keys

- **WHEN** the user moves through the options with the arrow keys
- **THEN** focus skips the disabled option
