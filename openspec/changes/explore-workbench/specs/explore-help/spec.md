## ADDED Requirements

### Requirement: A Help menu in the app bar

The app bar SHALL hold a Help button that opens a menu with Documentation, Keyboard shortcuts and
Take the tour, moved through with the arrow keys; Escape SHALL close it and return focus to Help.
Documentation SHALL open the docs in a new tab that cannot reach back into the explore page. The
plot SHALL carry no help button of its own.

#### Scenario: Keyboard

- **WHEN** the user opens Help and presses the arrow keys, then Escape
- **THEN** focus moves through the three items, the menu closes and focus is on Help

#### Scenario: Documentation

- **WHEN** the user picks Documentation
- **THEN** the docs open in a new tab with no access to the explore page

### Requirement: The keyboard shortcuts are listed in one place

Keyboard shortcuts SHALL open a dialog, with focus inside, listing every keyboard and pointer
shortcut of the explore page in titled groups, Mod written as ⌘ on Apple platforms and Ctrl
elsewhere. The list SHALL name the search shortcut, the legend's I, undo and redo under History,
the figure editor's Delete and its Escape that deselects before it closes, and the Escape steps in
the order one press at a time takes them. Escape SHALL close the dialog and return focus to Help
(to More on a phone).

#### Scenario: Opening the list

- **WHEN** the user picks Keyboard shortcuts
- **THEN** a dialog lists the shortcuts, the search shortcut among them
- **AND** Escape closes it and focus returns to Help

#### Scenario: The platform's modifier

- **WHEN** the list is shown on a Mac and elsewhere
- **THEN** Mod reads ⌘ on the Mac and Ctrl elsewhere

### Requirement: The tour runs once, in the version the visitor needs

On a visit with no tour recorded the full product tour SHALL start by itself; a visitor whose
browser holds the earlier tour's key `driver.overviewTour` set to `true` SHALL get the shorter
"What's new" tour instead, with a Full tour button that switches to the full tour. Starting a tour
SHALL record its kind under the localStorage key `protspace:tour:v2`, after which no tour starts by
itself; the earlier key SHALL be read, never written or removed. If storage is blocked, no tour
SHALL start by itself. Take the tour SHALL start the full tour at any time.

#### Scenario: First visit

- **WHEN** a visitor with no tour recorded opens /explore
- **THEN** the full tour starts

#### Scenario: Returning visitor

- **WHEN** a visitor who saw the earlier tour opens /explore
- **THEN** What's new runs once, each step on its control

#### Scenario: Tour recorded

- **WHEN** a tour is already recorded, with or without the earlier key
- **THEN** no tour starts

#### Scenario: From the Help menu

- **WHEN** the user picks Take the tour
- **THEN** the full tour starts again

### Requirement: Each step points at a control the layout shows

The tour SHALL pick its steps for the layout: every step SHALL point at a control on screen, a
step whose target is missing or has no box SHALL be dropped, and the steps SHALL speak of touch
under a coarse pointer and of the mouse under a fine one, writing the modifier as the keyboard
shows it. The first step SHALL spotlight Help (More on a phone). Starting the tour SHALL open a
collapsed sidebar on the legend, unfolded, and show the legend if the Filter panel was open.

#### Scenario: On a tablet

- **WHEN** the tour runs on a tablet
- **THEN** every step points at a control on screen and there is no Sidebar step

#### Scenario: A missing target

- **WHEN** a step's target is not on the page
- **THEN** the tour skips that step

#### Scenario: A collapsed sidebar

- **WHEN** the sidebar is collapsed and the user starts the tour
- **THEN** the sidebar opens on the legend

### Requirement: Ending the tour gives the page back

The tour SHALL end with Finish, Skip, its close button or Escape. When it ends, focus SHALL return
to the control that had it when the tour started (Help, or More on a phone; the tour's home control
if that one is gone); a tour that started by itself SHALL move focus nowhere. Every target SHALL
get its own state back, and the plot's selection SHALL be kept.

#### Scenario: Focus after the tour

- **WHEN** the user starts the tour from Help and it ends
- **THEN** focus is on Help

#### Scenario: Escape during the tour

- **WHEN** proteins are selected and the user ends a tour with Escape
- **THEN** the selection is kept
