## MODIFIED Requirements

### Requirement: Browser compatibility coverage is explicit

The default E2E suite SHALL execute all retained critical application journeys in Chromium. Firefox and WebKit SHALL execute only explicit compatibility scenarios. Both SHALL cover a deep-link refresh journey, consolidated duplicate/empty/partial-invalid URL normalization, a History API back/forward journey, and the dropped-file journey, in which a `file-dropped` event on the data loader (`#myDataLoader`), as the page's drop target sends it, loads a bundle through the runtime. Firefox SHALL additionally cover OPFS persistence through `@opfs-browser`; WebKit SHALL omit that scenario while the pinned Playwright build does not provide a usable OPFS implementation.

#### Scenario: Listing the default URL projects

- **WHEN** Playwright lists the Chromium, Firefox, and WebKit URL-state projects
- **THEN** Chromium includes the complete retained URL-state suite
- **AND** Firefox and WebKit each include only the tagged compatibility journeys
- **AND** unusable WebKit OPFS coverage is excluded rather than reported as a permanent skip

#### Scenario: A bundle crosses browser-owned import boundaries

- **WHEN** the compatibility projects are listed
- **THEN** Chromium, Firefox, and WebKit include the dropped-file journey through the data loader
- **AND** Chromium and Firefox include the OPFS persist/reload journey

#### Scenario: WebKit exercises History API compatibility

- **WHEN** the WebKit compatibility project runs its navigation journeys
- **THEN** the History API journey awaits browser-native `popstate` for back and forward traversal
- **AND** it verifies both the exact traversed URL and the applied application view
- **AND** a first-attempt WebKit failure retains its trace diagnostics

### Requirement: Heavyweight and live suites are explicit

An E2E project that requires a local heavyweight fixture, a downloaded example bundle or a live service not present in a normal checkout SHALL be excluded from the default project list and SHALL require its environment opt-in to equal `1` exactly. The large-bundle project SHALL read the Swiss-Prot bundle from the `perf-datasets` copy fetched by `pnpm perf:fetch`. The `examples-live` project SHALL open every catalog example from the files fetched by `pnpm examples:fetch` and assert that each opens on its `defaultView` with no URL write and no drift warning. It SHALL write no image: the documentation thumbnails come from the docs image pipeline (`docs-media-generation`).

#### Scenario: The default suite is listed without the large fixture

- **WHEN** `RUN_LARGE_BUNDLE_E2E` is unset
- **THEN** the large-bundle project is absent rather than reported as a skipped default test

#### Scenario: A developer opts into the large fixture suite

- **WHEN** `RUN_LARGE_BUNDLE_E2E=1` and `pnpm perf:fetch` has downloaded the Swiss-Prot bundle
- **THEN** Playwright includes the large-bundle project

#### Scenario: The default suite is listed without the live examples

- **WHEN** `RUN_EXAMPLES_E2E` is unset
- **THEN** the `examples-live` project is absent

#### Scenario: A developer opts into the live examples suite

- **WHEN** `RUN_EXAMPLES_E2E=1` after `pnpm examples:fetch`
- **THEN** Playwright includes the `examples-live` project, which opens each catalog example on its `defaultView` and writes no image

#### Scenario: A false-like value is supplied for the live suite

- **WHEN** `RUN_LIVE_E2E=0`
- **THEN** Playwright excludes the live FASTA project

#### Scenario: A developer opts into the live suite

- **WHEN** `RUN_LIVE_E2E=1`
- **THEN** Playwright includes the live FASTA project
