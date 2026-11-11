## ADDED Requirements

### Requirement: Every documentation image comes from one capture manifest

Every file under `docs/explore/images/` SHALL be made by exactly one entry of the capture manifest;
no image or video is added or edited by hand. Each entry SHALL carry a unique lowercase kebab-case
name, optionally under `examples/`, with no file extension and not ending in `-dark`, its kind (a
PNG screenshot or a video), its viewport (`desktop` 1280 × 720, `tablet` 800 × 1280, `phone`
412 × 839, or a custom size), its dataset and steps, what to crop (screenshots only), and the
documentation pages that show it. `pnpm docs:images` SHALL regenerate every file, and
`pnpm docs:screenshots -g "<name>"` and `pnpm docs:animations -g "<name>"` SHALL capture the
entries whose file names match. Every capture SHALL run in a headless browser, so a run takes no
window focus. Screenshots SHALL be taken at device scale 2 with reduced motion (a desktop entry may
set its own scale); videos SHALL be recorded at scale 1, over the whole viewport.

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
runner's hold, which paces a video recording. Every timer inside the shared helpers a scene imports SHALL be
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

### Requirement: Every documentation image and video has a dark twin

Every entry SHALL be captured twice, with the browser in light and in dark mode and the app's theme
on System, the dark files named as the light ones' twins with `-dark` before the extension; there is
no per-entry opt-out. The docs SHALL show the twin matching their own appearance, including after a
manual toggle, by hiding the other with a rule keyed on VitePress's `html.dark`, never with a
`prefers-color-scheme` media query. A page SHALL show a screenshot pair as two images on consecutive
lines, the light one first and marked `{.light-only}`, the dark one marked `{.dark-only}`; written
as raw HTML, the dark twin SHALL load lazily and neither image SHALL carry an inline `display`
style. A raw image with a width SHALL also give its height. The hand-made chart under
`docs/guide/images/` is outside the manifest and stays light only.

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

#### Scenario: An entry yields light and dark outputs

- **WHEN** the manifest holds a screenshot entry `shot` and a video entry `zoom`
- **THEN** its outputs are `shot.png`, `shot-dark.png`, and `zoom.webm`, `zoom.mp4` and `zoom.jpg`
  with their `-dark` twins

#### Scenario: A file without its dark twin

- **WHEN** a light file under `docs/explore/images/` has no `-dark` twin
- **THEN** `pnpm docs:images:check` fails naming the file

#### Scenario: The reader toggles the docs to dark

- **WHEN** a reader whose system is light switches the docs to dark
- **THEN** every screenshot and video shows its dark twin, and the light twins are hidden

### Requirement: Animations are looping videos within a size budget

Every docs animation SHALL be a muted, looping video: per theme a VP9 WebM, an H.264 MP4 for
browsers without VP9, and a JPEG poster of its first frame, cut where the scene starts.
`pnpm docs:videos` SHALL encode each recording at a fixed quality, and each WebM and MP4 SHALL fit
its entry's budget, 1.25 MiB (1,310,720 bytes) unless the entry sets its own; a file still over
budget SHALL fail the run, keep its recording and leave the previous files in place. A page SHALL
show an animation with `<DocsVideo name alt width height>`, which renders both themes' videos and
shows the one matching the docs' appearance. A video SHALL load nothing until it nears the viewport,
SHALL play only while on screen, and SHALL NOT autoplay under `prefers-reduced-motion`, where it
shows its poster with controls. No page SHALL show a GIF.

#### Scenario: The default budget

- **WHEN** a video entry sets no budget
- **THEN** its budget is 1.25 MiB for its WebM and for its MP4

#### Scenario: One byte over

- **WHEN** a WebM or MP4 on disk is one byte over its budget
- **THEN** `pnpm docs:images:check` fails naming it

#### Scenario: A light reader never fetches the dark video

- **WHEN** a reader in light mode scrolls to a `<DocsVideo>`
- **THEN** the light video and its poster load and play, and no file of the dark twin is fetched

#### Scenario: Reduced motion

- **WHEN** a reader who prefers reduced motion scrolls to a `<DocsVideo>`
- **THEN** its poster shows with controls and the video does not play until started

#### Scenario: A tag that states the wrong size

- **WHEN** a `<DocsVideo>` states a width and height other than its recording's viewport
- **THEN** `pnpm docs:images:check` fails naming the page and line

### Requirement: The example thumbnails come from the capture pipeline

The Example datasets page's thumbnails, `examples/<id>.png` and `examples/<id>-dark.png`, SHALL be
manifest entries like every other image: one per catalog example in menu order, each the workbench
body on the example's curated view, in both themes, at scale 1. No end-to-end project SHALL write
them.

#### Scenario: Every example has a thumbnail

- **WHEN** the docs lint reads the real docs
- **THEN** every catalog example's thumbnail and its dark twin exist, are made by an entry and are
  shown by the Example datasets page

### Requirement: The image check runs before every commit

`pnpm docs:images:check` SHALL run in `pnpm precommit`, reading only files and starting no browser.
It SHALL fail when a manifest output is missing or a file has no entry; when a file has no dark
twin; when a video is over its budget or its `<DocsVideo>` lacks a name, alt text or its size; when
a page shows a file that does not exist, a file is shown by no page, or a page an entry names does
not show it; when a pair is written wrongly or a page shows a GIF; when a link's `#anchor` matches
no heading on its page; and when the user guide names removed UI. The same rules SHALL run
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
