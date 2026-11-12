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

### Requirement: The user switches between Light and Dark

The app bar SHALL offer a Theme button that switches between light and dark, starting from the
operating system's colour scheme. With nothing valid stored, or a storage that throws, the page
SHALL follow the OS, live. A press SHALL show the other mode at once: when that mode differs from
the OS's it SHALL be stored as an override that later OS changes do not undo, and when it equals
the OS's the stored override SHALL be removed, so the page follows the OS again. Its icon SHALL
show the mode on screen (a sun for light, a moon for dark), and its accessible name and tooltip
SHALL name that mode and the other ("Theme: Light. Switch to Dark"). The choice SHALL be stored
under VitePress's key `vitepress-theme-appearance` with the raw value `dark` or `light` (`auto`
or nothing meaning the OS), and a value stored by earlier versions under `protspace:theme` SHALL
move to it once. The stored choice SHALL paint before any page code runs, so a cold load never
flashes the other theme, and a choice made in another tab SHALL apply without a reload.

#### Scenario: A press flips the mode

- **WHEN** nothing is stored, the OS is light, and the user presses Theme
- **THEN** the page turns dark, `vitepress-theme-appearance` holds `dark`, and the button reads
  "Theme: Dark. Switch to Light"

#### Scenario: Back to the system

- **WHEN** the user presses Theme again
- **THEN** the page is light, nothing is stored, and when the OS turns dark the page follows it

#### Scenario: Choosing Dark survives a reload

- **WHEN** the user picks Dark on a light OS and reloads
- **THEN** the page is dark

#### Scenario: First paint

- **WHEN** a page loads cold with Dark stored, or with nothing stored on a dark OS
- **THEN** the dark surface is painted before the page's code runs

#### Scenario: The old key

- **WHEN** `protspace:theme` holds `"dark"` and the user opens any page
- **THEN** the page is dark, `vitepress-theme-appearance` holds `dark`, and `protspace:theme` is
  gone

### Requirement: Home, Explore and the docs share one theme

Every page of the site SHALL follow the one stored theme choice: the landing page, the privacy
page, the not-found page, /explore (also when reached through the GitHub Pages deep link
`/?/explore`) and the docs. Each SHALL offer the Theme button in its top bar (on a phone, Home's
and the docs' menus and the explore page's More sheet as a Light | Dark pair with the mode on
screen selected), and moving between them SHALL keep the mode.

#### Scenario: Dark everywhere

- **WHEN** Dark is stored and the user opens the landing page, the privacy page or a missing page
- **THEN** that page is dark from its first paint, and its wordmark is inverted

#### Scenario: Home and Explore share the choice

- **WHEN** the user picks Dark with Home's Theme button and opens /explore
- **THEN** /explore is dark, and picking Light there makes Home light again

### Requirement: One palette for the app, the landing page and the docs

The landing page and the docs SHALL take their colours from the same `--ps-*` tokens as the
explore page, defined once in a plain CSS file that core's sheet, the landing page and the docs
all import. On the landing page, the background, text, borders, cards, buttons and links SHALL be
the tokens' (the accent `#007ab5` in light and `#38bdf8` in dark), and its illustration panels and
canvases SHALL follow the mode. In the docs, the background, text, borders, links, buttons, code
and custom blocks SHALL be the tokens', so their dark background is the app's slate `#0f172a` and
a filled button in dark is the accent with dark text.

#### Scenario: The docs in dark

- **WHEN** a docs page is shown in dark
- **THEN** its background is `#0f172a` and its links are `#38bdf8`

#### Scenario: Home in light

- **WHEN** the landing page is shown in light
- **THEN** its primary button is filled with `#007ab5`

### Requirement: Everything on screen follows the theme

Everything the explore page draws SHALL follow the theme: the plot's background and its neutral
colours (Other, N/A, connectors), the structure viewer's frame and Mol\*'s background,
notifications, the product tour's popover and overlay, the legend's swatches, the wordmark, and
the browser's own scrollbars and form controls (the root's `color-scheme`). A
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

#### Scenario: The browser's own controls

- **WHEN** the theme is Dark, and then Light
- **THEN** the root's `color-scheme` is dark, and then light

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
of Okabe-Ito, Tol Bright, Set2, Dark2 and Tableau 10 at least 3 to 1, except Kelly's #2B3D26 and
#222222 and Okabe-Ito's #000000.

#### Scenario: Text on surfaces

- **WHEN** the token values are checked in light and in dark
- **THEN** text, muted text and accent text reach 4.5 to 1 on each surface

#### Scenario: Palette on the dark plot

- **WHEN** Kelly's palette is drawn on the dark plot background
- **THEN** every colour but #2B3D26 and #222222 reaches 2 to 1
