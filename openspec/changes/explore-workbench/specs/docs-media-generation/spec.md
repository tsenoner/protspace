## ADDED Requirements

### Requirement: Every documentation image comes from one capture manifest

Every file under `docs/explore/images/` SHALL be made by exactly one entry of the capture manifest;
no image is added or edited by hand. Each entry SHALL carry a unique lowercase kebab-case name,
optionally under `examples/`, with no file extension and not ending in `-dark`, its kind (PNG or
GIF), its viewport (`desktop` 1280 × 720, `tablet` 800 × 1280, `phone` 412 × 839, or a custom
size), its themes, its dataset and steps, what to crop, and the documentation pages that show it.
`pnpm docs:images` SHALL regenerate every image, and `pnpm docs:screenshots -g "<name>"` and
`pnpm docs:animations -g "<name>"` SHALL capture the entries whose file names match. Screenshots
SHALL be taken at device scale 2 with reduced motion (a desktop entry may set its own scale); GIFs
SHALL be recorded at scale 1.

#### Scenario: A name used twice

- **WHEN** two manifest entries share a name
- **THEN** the manifest's validation reports that the name is used twice, once

#### Scenario: A file no entry makes

- **WHEN** a file sits under `docs/explore/images/` that no manifest entry produces
- **THEN** `pnpm docs:images:check` fails naming the file

#### Scenario: An output missing on disk

- **WHEN** a manifest entry's output file does not exist
- **THEN** `pnpm docs:images:check` fails naming the missing output

### Requirement: Captures drive the app the way the end-to-end suite does

The capture scenes SHALL reach the app through the same helpers as the end-to-end suite, which find
controls by role, accessible name or tag and never reach into a shadow root, and SHALL wait for
signals (a dialog visible, a structure loaded, the plot settled) rather than for time. A scene SHALL
hold no timer and SHALL NOT evaluate code in the page; the only pause in capture code SHALL be the
runner's hold, which paces a GIF. Every timer inside the shared helpers a scene imports SHALL be
counted by a test, so a new one shows in review. Before taking a picture the runner SHALL wait for
the data and for the plot to settle, park the pointer and check that no tooltip is open.

#### Scenario: A scene reaches into a shadow root

- **WHEN** capture code reads an element's `shadowRoot`
- **THEN** the docs image tests fail naming the file

#### Scenario: A timer in a scene

- **WHEN** a scene waits on a timeout or evaluates code in the page
- **THEN** the docs image tests fail naming the scene

#### Scenario: A new timer in a shared helper

- **WHEN** a helper a scene imports gains a timer
- **THEN** the docs image tests fail until the counted timers are updated

### Requirement: A screenshot's dark twin is shown as a pair

Only a screenshot entry SHALL have a dark variant, and only when it asks for one: captured with the
browser in dark mode and the app's theme on System, and saved as the light file's twin
`<name>-dark.png`. GIFs and the example thumbnails SHALL be light only. A page SHALL show a pair as
two images on consecutive lines, the light one first and marked `{.light-only}`, the dark one marked
`{.dark-only}`; written as raw HTML, the dark twin SHALL load lazily and neither image SHALL carry
an inline `display` style. A raw image with a width SHALL also give its height.

#### Scenario: A pair written as the docs expect

- **WHEN** a page shows a light image followed on the next line by its dark twin
- **THEN** the docs lint passes it

#### Scenario: A dark image without its light twin

- **WHEN** a page shows a `-dark` image without its light twin before it, or a `-dark` file has no
  light twin on disk
- **THEN** the docs lint fails

#### Scenario: A raw pair with an inline display

- **WHEN** a raw HTML pair gives an image an inline `display` style
- **THEN** the docs lint fails, because both twins would show

#### Scenario: A dark GIF entry

- **WHEN** a GIF entry asks for the dark theme
- **THEN** the manifest's validation reports that a GIF is light only

### Requirement: GIFs fit a size budget

Each GIF SHALL fit its entry's budget, 3 MiB (3,145,728 bytes) unless the entry sets its own.
`pnpm docs:gifs` SHALL convert each recording with a two-pass palette and step down a fixed ladder
until the file fits: 25 fps at 1000 px wide, then 20 and 15 fps, then 800 and 640 px at 15 fps. A
GIF still over budget at the last step SHALL fail the run, keep its recording and leave the
previous GIF in place.

#### Scenario: The default budget

- **WHEN** a GIF entry sets no budget
- **THEN** its budget is 3 MiB

#### Scenario: The ladder

- **WHEN** a recording converts over its budget
- **THEN** the converter tries a lower frame rate first, then a narrower width at 15 fps

#### Scenario: One byte over

- **WHEN** a GIF on disk is one byte over its budget
- **THEN** `pnpm docs:images:check` fails naming it

### Requirement: The example thumbnails come from the capture pipeline

The Example datasets page's thumbnails, `examples/<id>.png`, SHALL be manifest entries like every
other image: one per catalog example in menu order, each the workbench body on the example's curated
view, light only, at scale 1. No end-to-end project SHALL write them.

#### Scenario: Every example has a thumbnail

- **WHEN** the docs lint reads the real docs
- **THEN** every catalog example's thumbnail exists, is made by an entry and is shown by the Example
  datasets page

### Requirement: The image check runs before every commit

`pnpm docs:images:check` SHALL run in `pnpm precommit`, reading only files and starting no browser.
It SHALL fail when a manifest output is missing or a file has no entry; when a GIF is over its
budget; when a page shows a file that does not exist, a file is shown by no page, or a page an entry
names does not show it; when a dark twin is written or stored wrongly; when a link's `#anchor`
matches no heading on its page; and when the user guide names removed UI. The same rules SHALL run
as unit tests on small cases and on the real docs.

#### Scenario: An anchor no heading has

- **WHEN** a docs link points at `page#anchor` and that page has no heading with that anchor
- **THEN** the docs lint fails naming the link

#### Scenario: Removed UI in the user guide

- **WHEN** a user-guide page names removed UI outside code and front matter
- **THEN** the docs lint fails, reporting each line, and the developer docs are not checked

#### Scenario: The real docs pass

- **WHEN** the docs lint runs on the repository's docs
- **THEN** every page and image passes
