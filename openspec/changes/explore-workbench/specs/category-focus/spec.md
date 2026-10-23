## RENAMED Requirements

- FROM: `### Requirement: The Tips popover lists Shift + Hover`
- TO: `### Requirement: The keyboard shortcut list names Shift + Hover`

## MODIFIED Requirements

### Requirement: The keyboard shortcut list names Shift + Hover

The Keyboard shortcuts dialog SHALL list `Shift` in its Plot section with the action "Hold over a
point to focus its category"; it opens from the Help menu, and on a phone from Help & shortcuts in
the More sheet. The key SHALL read `⇧` on Apple platforms and `Shift` elsewhere. The plot SHALL
offer no tips button of its own.

#### Scenario: Opening the keyboard shortcut list

- **WHEN** the user opens Help, then Keyboard shortcuts
- **THEN** the dialog's Plot section shows `Shift` (`⇧` on Apple platforms) with "Hold over a point
  to focus its category"
- **AND** the plot shows no tips button
