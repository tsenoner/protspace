## ADDED Requirements

### Requirement: One token sheet styles the explore page

Every colour, font, size and radius the explore page's components use SHALL come from one set of
`--ps-*` custom properties declared on the document's root, with light values by default and dark
values under `data-theme="dark"` (and under `data-theme="system"` when the OS prefers dark). Core
SHALL add this sheet to a document exactly once, before the explore runtime loads, and component
shadow roots SHALL read the tokens without declaring them, so a plain page rule overriding a token
reaches every component in light and in dark. Component stylesheets SHALL NOT hold raw colours,
literal font sizes or reads of undefined tokens; the style lint enforces this.

#### Scenario: Tokens reach inside components

- **WHEN** a page rule sets a `--ps-*` token on the root
- **THEN** components inside shadow roots use the new value, in light and in dark

#### Scenario: The sheet is added once

- **WHEN** core's token sheet is adopted into a document twice
- **THEN** the document holds it once

#### Scenario: The lint rejects a raw colour

- **WHEN** a component stylesheet holds a raw colour, a literal font size, or reads a `--ps-*`
  token the sheet does not define
- **THEN** the style lint fails naming it

### Requirement: The explore page sets its own type

The explore page SHALL keep a 16 px root font size and set its text in Inter served from the app's
own origin; no font SHALL be loaded from a third-party font service.

#### Scenario: Fonts on /explore

- **WHEN** /explore loads
- **THEN** the root font size is 16 px, Inter is available, and every font request goes to the
  app's own origin

### Requirement: The user chooses System, Light or Dark

The app bar SHALL offer a Theme menu with System, Light and Dark that marks the current choice,
opens on it, and shows the choice in its button's icon. The choice SHALL be stored as JSON under
the localStorage key `protspace:theme`; with nothing valid stored, or a storage that throws, it
SHALL be System. System SHALL follow the operating system's colour scheme, live; Light and Dark
SHALL ignore it. The choice SHALL apply only to /explore (also when reached through the GitHub
Pages deep link `/?/explore`), and the stored choice SHALL paint before the explore code runs, so
a cold load never flashes the other theme.

#### Scenario: Choosing Dark

- **WHEN** the user picks Dark and reloads
- **THEN** the page is dark, and `protspace:theme` holds `"dark"`

#### Scenario: First paint

- **WHEN** /explore loads cold with Dark stored, or with System stored on a dark OS
- **THEN** the dark surface is painted before the explore code runs

#### Scenario: System follows the OS

- **WHEN** System is chosen and the OS switches between light and dark
- **THEN** the page follows without a reload

#### Scenario: Other pages stay light

- **WHEN** Dark is stored and the user opens a page other than /explore
- **THEN** that page is not themed

### Requirement: Everything on screen follows the theme

Everything the explore page draws SHALL follow the theme: the plot's background and its neutral
colours (Other, N/A, connectors), the structure viewer's frame and Mol\*'s background,
notifications, the product tour's popover and overlay, the legend's swatches and the wordmark. A
theme change SHALL restyle the plot's colours with one render and SHALL NOT change the plot's size
or the view.

#### Scenario: Dark plot

- **WHEN** the theme is Dark
- **THEN** the plot's background and an Other point use the dark values

#### Scenario: Switching theme

- **WHEN** the theme switches from Dark to Light
- **THEN** the plot renders once with the light colours and its view is unchanged

#### Scenario: Dark surfaces around the plot

- **WHEN** the theme is Dark
- **THEN** a notification, the tour's popover and the structure viewer's background are dark

### Requirement: Exports stay light

Exported images SHALL NOT depend on the theme: a quick PNG exported in Dark SHALL equal the one
exported in Light, and the figure editor SHALL preview a figure on light paper in either theme.

#### Scenario: Quick PNG in Dark

- **WHEN** the user exports a Quick PNG in Dark and again in Light
- **THEN** the two images are equal

#### Scenario: Figure editor preview in Dark

- **WHEN** the figure editor is open in Dark
- **THEN** its preview shows the figure on light paper

### Requirement: Both themes meet contrast minimums

In light and in dark, body text, muted text and accent text SHALL reach a contrast ratio of at
least 4.5 to 1 on every surface they sit on, as SHALL tooltip text and danger text; control
boundaries, the selected-segment ring and the focus ring SHALL reach at least 3 to 1; the plot's
Other colour, connectors and EAT endpoints SHALL reach at least 3 to 1 on the plot background.
On the dark plot background the colours of Kelly's palette SHALL reach at least 2 to 1, and those
of Okabe-Ito, Tol Bright, Set2, Dark2 and Tableau 10 at least 3 to 1, except for an explicit
allow-list.

#### Scenario: Text on surfaces

- **WHEN** the token values are checked in light and in dark
- **THEN** text, muted text and accent text reach 4.5 to 1 on each surface

#### Scenario: Palette on the dark plot

- **WHEN** Kelly's palette is drawn on the dark plot background
- **THEN** every colour outside the allow-list reaches 2 to 1
