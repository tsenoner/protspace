## MODIFIED Requirements

### Requirement: Example catalog

The app SHALL define a static catalog of example datasets in which every entry has a unique `id` made of lowercase letters and digits, starting with a letter, with words joined by single hyphens, a `label` that states the protein count and download size, a one-line `description`, a one-line `insight` naming what the curated view shows, a same-origin `url`, its decoded size in bytes, a `docsUrl` pointing at the entry's section of the Example datasets documentation page, and a required curated `defaultView` naming a projection, a colour-by annotation and optional tooltip annotations. The label's count and size and the entry's size in bytes SHALL be derived from the entry's record in the example bundle manifest. The catalog SHALL contain the startup demo, the ProtSpace manuscript's datasets and one curated annotation-transfer (EAT) showcase, and nothing else: `demo`, `three-finger-toxins`, `human-fly`, `beta-lactamase` and `swissprot`. The showcase, `three-finger-toxins`, is not a manuscript dataset, because the manuscript's EAT sets are benchmarks and test fixtures rather than showcases. These ids are permanent, because published links name them. The first entry SHALL be the startup demo, `id: 'demo'`, served from `./data.parquetbundle`; every other entry SHALL be served from `./examples/`. An entry MAY be marked large; `swissprot` SHALL be. Every `defaultView` name SHALL exist in the entry's bundle: the annotation and tooltip names among its annotation columns, the projection among its projections. The annotation SHALL be colourable, meaning neither tooltip-only nor an EAT prediction companion column, and the tooltip SHALL contain neither duplicates nor the annotation. Every entry's bundle SHALL carry a UMAP projection, which its `defaultView` names, and a PCA projection.

#### Scenario: Known id

- **WHEN** the catalog is queried for an id it contains
- **THEN** it returns that entry

#### Scenario: Unknown id lookup

- **WHEN** the catalog is queried for an id it does not contain
- **THEN** it returns nothing

#### Scenario: Catalog contents and order

- **WHEN** the catalog is listed
- **THEN** it holds exactly `demo`, `three-finger-toxins`, `human-fly`, `beta-lactamase` and `swissprot`, in that order, with `swissprot` marked large

#### Scenario: An id outside the format

- **WHEN** a catalog entry's id has an uppercase letter or an underscore, starts with a digit (as `3ftx-eat` does), or holds a doubled or trailing hyphen
- **THEN** the unit suite fails; `three-finger-toxins` passes

#### Scenario: Every example has a UMAP and a PCA

- **WHEN** an entry's manifest record is checked
- **THEN** its projections include a PCA, and its `defaultView` projection is a UMAP

#### Scenario: A default-view name drifts from its bundle

- **WHEN** a catalog entry's `defaultView` names an annotation, tooltip annotation or projection that its manifest record does not list
- **THEN** the unit suite fails in CI, without downloading any bundle

#### Scenario: Label agrees with the file

- **WHEN** an entry's manifest record changes its protein count or byte size
- **THEN** the entry's label and size in bytes change with it, with no hand edit

### Requirement: Choosing an example from the Import menu

The control bar's Import menu SHALL list every catalog entry under an "Examples" heading, below "Load your dataset": the demo first, then the rest by ascending protein count. The heading SHALL carry a link to the Example datasets documentation page and a hint that examples open in a curated view and that changes made to them are not kept. Each item SHALL show its label and an info control that reveals its description, its insight and a "Learn more" link to its documentation section; the info control SHALL NOT load the example. Entries marked large SHALL show a "Large" badge, and their info SHALL state the download size, the expected browser memory and the load time. When the current dataset is an example, the current-dataset name SHALL offer the same info control. The currently loaded example SHALL be disabled. Choosing an item SHALL load that example, replace the user's stored import, and open it on its curated default view.

#### Scenario: Choose an example

- **WHEN** the user chooses an example other than the one loaded
- **THEN** the example loads on its curated default view, the stored import is cleared, and the item for that example becomes disabled

#### Scenario: A user file is loaded

- **WHEN** the current dataset is a user import
- **THEN** no example item is disabled

#### Scenario: Learn about an example

- **WHEN** the user opens an example's info control in the Import menu
- **THEN** its description, its insight and a link to `/docs/explore/example-datasets#<id>` are shown, and the example is not loaded

#### Scenario: A large example

- **WHEN** the Import menu lists `swissprot`
- **THEN** its item shows a "Large" badge, and its info states the download size, the expected browser memory and the load time

#### Scenario: The menu says examples reopen curated

- **WHEN** the Import menu lists at least one example
- **THEN** the "Examples" heading shows the "About these examples" link and the hint that changes made to an example are not kept

### Requirement: Dataset deep link

The `dataset` query parameter SHALL name the example to show. At startup, a known id SHALL be loaded in place of restoring the stored import, and the stored import SHALL be left untouched. Choosing an example from the menu SHALL push a new history entry whose query is the previous one with `dataset=<id>` set and `annotation`, `projection`, `tooltip` and `density` removed; other parameters SHALL be kept. Importing a user file SHALL remove the parameter without adding a history entry. Loading the demo by default at startup SHALL NOT set the parameter. When Back or Forward changes the parameter, the app SHALL load the named example, or run the normal startup load when the parameter is gone. `annotation`, `projection` and `tooltip` parameters in the same URL SHALL apply to the loaded example. When the URL names none of them, the example SHALL open on its whole `defaultView`, tooltip included, and nothing SHALL be written to the URL. A parameter present with an empty value SHALL count as named. When the URL names some of them, a missing or invalid `annotation` or `projection` SHALL fall back to the example's `defaultView` value rather than to the bundle's first one, an invalid value SHALL be normalized in the URL, and an absent `tooltip` SHALL mean no tooltip annotations. A `defaultView` name missing from the loaded bundle SHALL fall back to the bundle's first annotation or projection, and to no tooltip annotation, with a development-mode warning.

#### Scenario: Open a deep link

- **WHEN** the app opens with `?dataset=<known id>` while a user import is stored
- **THEN** the example loads, and opening the app again without the parameter restores the stored import

#### Scenario: Bare deep link opens the curated view

- **WHEN** the app opens with `?dataset=<id>` and no view parameters
- **THEN** the example shows its `defaultView` projection, annotation and tooltip annotations, and the URL stays `?dataset=<id>`

#### Scenario: Deep link with view parameters

- **WHEN** the app opens with `?dataset=<id>&annotation=<a>` and the example has annotation `<a>`
- **THEN** the example loads with `<a>` selected, on its `defaultView` projection, with no tooltip annotations

#### Scenario: An empty view parameter

- **WHEN** the app opens with `?dataset=<id>&tooltip=`
- **THEN** the example shows its `defaultView` annotation and projection with no tooltip annotations, and the empty parameter is removed from the URL without a new history entry

#### Scenario: Invalid view parameter

- **WHEN** the app opens with `?dataset=<id>&annotation=<name the example lacks>`
- **THEN** the example shows its `defaultView` annotation, and the URL's `annotation` is normalized to it without a new history entry

#### Scenario: Unknown id

- **WHEN** the app opens with `?dataset=<unknown id>`
- **THEN** a warning is shown, the parameter is removed without a new history entry, and startup continues with the stored import or the demo

#### Scenario: Menu choice and Back

- **WHEN** the user, on a URL with `annotation=<a>&tooltip=<t>`, chooses an example from the menu and then presses Back
- **THEN** the pushed URL is the previous query with `dataset=<id>` set and no `annotation`, `projection`, `tooltip` or `density`, the example opens on its `defaultView`, and Back returns to the previous dataset with `<a>` and `<t>` restored, or to the normal startup load if the previous URL had no `dataset` parameter

#### Scenario: Back to a bare entry of the same example

- **WHEN** the user opens `?dataset=<id>`, picks another annotation, and presses Back
- **THEN** the example shows its `defaultView` again

#### Scenario: User import clears the parameter

- **WHEN** the user imports a file while `dataset=` is set
- **THEN** the parameter is removed and no history entry is added

### Requirement: Example load failure

If fetching or parsing an example fails, the app SHALL show an error notification and dismiss the loading overlay. When a dataset is already displayed, a failed load, whether started by a menu choice or by Back/Forward, SHALL leave the current plot, the current history entry and the URL unchanged and SHALL NOT run a fallback load. For a failed download, the notification SHALL offer Retry as its primary action and Report as its secondary action; for a bundle that downloads but fails to parse it SHALL offer Report only. After a failed Back/Forward, including a Back to an entry without `dataset=` whose startup demo fails to download, the app SHALL treat the displayed view as the current view request, so later loads do not inherit the failed entry's view parameters. Each failed download SHALL keep its own notification, whose Retry repeats that request, even when the same example failed moments before from another kind of request. Retry after a failed Back/Forward SHALL re-request the example with the view parameters of the history entry that names it; Retry after a failed menu choice SHALL repeat that menu choice. The next history entry the app writes for a user view change SHALL name the displayed dataset. Only when nothing is displayed yet SHALL a failed deep link remove the parameter without a new history entry and continue with the normal startup load.

#### Scenario: Menu choice fails

- **WHEN** the chosen example's fetch returns an HTTP error
- **THEN** an error notification with Retry and Report is shown, and the previous dataset stays on screen with the URL unchanged

#### Scenario: Back to an example that fails to download

- **WHEN** a dataset is displayed and Back or Forward lands on an entry whose example fails to download
- **THEN** an error notification with Retry and Report is shown, the displayed dataset stays on screen, no fallback load runs, and the history entry and URL are unchanged

#### Scenario: Retry recovers

- **WHEN** the user presses Retry after a failed Back or Forward, and the download now succeeds
- **THEN** the example named by the current history entry loads with that entry's view parameters

#### Scenario: A later action after a failed Back

- **WHEN** after a failed Back or Forward the user imports a file or changes the view instead of retrying
- **THEN** the failed entry's `annotation`, `projection` and `tooltip` are not applied, and any history entry the app writes names the displayed dataset

#### Scenario: A menu failure, then a Back failure of the same example

- **WHEN** choosing an example from the menu fails, and within seconds a Back to an entry naming the same example fails too
- **THEN** two notifications are shown, and the second one's Retry re-requests that entry's example without replacing the stored import

#### Scenario: A corrupt bundle

- **WHEN** an example downloads but its bundle fails to parse while a dataset is displayed
- **THEN** an error notification with Report and no Retry is shown, and the displayed dataset, history entry and URL are unchanged

#### Scenario: Deep link fails

- **WHEN** the app opens with `?dataset=<id>` and the fetch fails
- **THEN** an error notification is shown, the parameter is removed, and the stored import or demo loads

#### Scenario: A request is superseded

- **WHEN** a second load for a different example starts before an earlier one finishes
- **THEN** the earlier request is abandoned silently, without a fallback load, a notification, or any change to the plot or URL

## ADDED Requirements

### Requirement: Examples open in their curated state

Every load of an example, whether from the Import menu, a deep link, Back/Forward or a reload, SHALL discard the legend, tooltip and other per-dataset view settings saved for it in this browser, and SHALL apply the settings bundled with the example (its curated legend styles and its EAT reliability threshold) together with its curated default view. The Contours mode SHALL NOT carry over from the previous dataset: a menu choice SHALL open the example with contours Off, as its bare `?dataset=<id>` link does, while a link or history entry that names `density` SHALL apply it. A user import SHALL keep its saved settings as before. The Import menu, the Example datasets documentation page and the importing-data documentation SHALL state that examples reopen in their curated state, and that exporting an example with its settings and importing that copy is the way to keep changes.

#### Scenario: Reload restores the curated legend

- **WHEN** the user changes a legend colour or hides a category on `?dataset=<id>` and reloads the page
- **THEN** the example shows its bundled legend again

#### Scenario: A menu choice turns contours off

- **WHEN** contours are on (`density=on`) and the user chooses an example from the Import menu, then presses Back
- **THEN** the example opens with contours Off and stays so, its entry has no `density` parameter, and Back restores the previous dataset with contours on

#### Scenario: A user import keeps its changes

- **WHEN** the user changes a legend colour on an imported file and reloads the page
- **THEN** the stored import is restored with the changed colour

#### Scenario: Bundled EAT threshold

- **WHEN** an example whose bundle stores an EAT reliability threshold loads
- **THEN** the reliability filter starts at that threshold, and an example whose bundle stores none starts at 0 with every transfer shown

### Requirement: Request precedence

A user-initiated dataset request SHALL take precedence over any app-initiated load that began before it. User-initiated requests are a menu choice, a Back/Forward navigation (including one to an entry without `dataset=`), a file import, a recovery-banner button, a Retry and a Cancel. App-initiated loads are the startup restore of the stored import, the startup demo, the recovery load after a corrupt stored import, and the fallback after a failed deep link. An app-initiated load preempted by a user request SHALL stop before starting any load, and SHALL show no recovery banner and no notification. While a URL-driven switch to a dataset is pending, a history navigation that changes only the view parameters for that same dataset SHALL be recorded and applied by the pending load, not resolved against the dataset still on screen. A Back/Forward navigation while a menu-chosen example is loading SHALL cancel that load: its download is aborted, the loading overlay is dismissed if the navigation starts no load of its own, and no history entry is pushed for it. Once that example has decoded and begun replacing the stored import and the plot, a Back/Forward that changes only the view parameters SHALL NOT cancel it: the example finishes on its curated view and pushes its own entry, and the entry the navigation landed on is left unchanged. A load superseded by a newer user request, whether an example, the startup restore of the stored import or a user import, SHALL NOT render, save the import, or change the URL; a superseded restore that decoded SHALL still record that it loaded, so no recovery banner is offered for it. A startup load run by a user request while that restore is still in flight SHALL wait for it and restore the import, not offer recovery. A user request SHALL abort a FASTA preparation still running, and the loading overlay's Cancel SHALL act on the newest request. A restore preempted after it marked the stored import's load as pending SHALL put the previous status back.

#### Scenario: A menu choice during the startup restore

- **WHEN** the user chooses an example while the app is still reading the stored import at startup
- **THEN** the chosen example loads, the stored import is not loaded over it, and no recovery banner is shown

#### Scenario: A menu choice during the startup demo

- **WHEN** no import is stored and the user chooses an example before the startup demo has started loading
- **THEN** only the chosen example is fetched and shown

#### Scenario: A corrupt restore during a click

- **WHEN** the stored import turns out to be corrupt while a user-chosen example is loading
- **THEN** the corrupt import is cleared, the demo is not loaded, and the chosen example is shown

#### Scenario: Two quick Backs to the same dataset

- **WHEN** a Back starts loading dataset A, and a second Back lands on another entry for A with different view parameters before the load finishes
- **THEN** A is shown with the second entry's view parameters, and the URL keeps them

#### Scenario: Back during a pending menu load

- **WHEN** the user chooses an example and presses Back before it has loaded
- **THEN** the example's download is aborted, the entry the user went back to is shown, and no `dataset=` entry is pushed for the cancelled example

#### Scenario: Back once the menu example is rendering

- **WHEN** the user chooses an example and presses Back after its data has reached the plot but before its load has finished
- **THEN** the example finishes on its curated view with its `dataset=` entry pushed, and the entry the user went back to is not modified

#### Scenario: Forward during the startup restore

- **WHEN** the stored import is still being restored at startup and a Back/Forward lands on an entry naming an example
- **THEN** the example is shown, its entry keeps `dataset=`, and the stored import is left healthy for the next startup

#### Scenario: Forward during the startup restore to an example that fails

- **WHEN** the stored import is still being restored at startup and a Back/Forward lands on an entry naming an example whose download fails
- **THEN** an error notification is shown, the stored import is restored, and no recovery banner appears

#### Scenario: Back/Forward during a FASTA preparation

- **WHEN** a FASTA import is being prepared and a Back/Forward lands on an entry naming an example
- **THEN** the preparation is aborted, the example is shown on that entry, and the preparation never lands later

#### Scenario: Back to an entry without a dataset

- **WHEN** an example is loading and the user goes Back to an entry without `dataset=`
- **THEN** the pending example is abandoned and the normal startup load runs

### Requirement: Example download progress and cancel

While an example downloads, the loading overlay SHALL show progress as the number of bytes received divided by the entry's decoded size from the manifest, capped at 100 %, and SHALL NOT compute it from the response's `Content-Length`, which is the compressed size when the response is gzip-encoded. Until decoding starts the overlay SHALL offer a Cancel button, and pressing it SHALL count as a user request; the startup load's own demo download (at startup, or from a recovery-banner button) SHALL NOT offer one, since it is what a cancel falls back to. When a dataset is displayed, Cancel SHALL abort the download and leave the displayed dataset and the URL unchanged, without a notification and without a fallback load. When nothing is displayed yet, Cancel SHALL abort the download, remove the `dataset` parameter without a new history entry, and run the normal startup load, without a notification. The Cancel button SHALL be removed once decoding starts.

#### Scenario: Progress with a compressed response

- **WHEN** an example of decoded size S downloads through a gzip-encoded response whose `Content-Length` is smaller than S
- **THEN** the overlay's percentage rises with the decoded bytes received and never exceeds 100 %

#### Scenario: Cancel while another dataset is shown

- **WHEN** the user chooses `swissprot` from the menu and presses Cancel during the download
- **THEN** the download is aborted, the overlay disappears, the previous dataset stays on screen, the URL is unchanged, and no notification is shown

#### Scenario: Cancel on an empty screen

- **WHEN** the app opens with `?dataset=swissprot` and the user presses Cancel during the download
- **THEN** the download is aborted, the `dataset` parameter is removed without a new history entry, the stored import or demo loads, and no notification is shown

#### Scenario: Decoding has started

- **WHEN** the download has finished and the bundle is being decoded
- **THEN** the overlay no longer offers Cancel

#### Scenario: The startup demo

- **WHEN** the app opens without `?dataset=` and no stored import, and downloads the demo
- **THEN** the overlay shows the download's progress and offers no Cancel

### Requirement: Example datasets documentation

The documentation SHALL include an Example datasets page, at `/docs/explore/example-datasets`, generated from the catalog, the example bundle manifest and docs-only prose, with one section per catalog entry anchored at the entry's `id`. Each section SHALL state what the dataset is, what its curated view shows and what to try next, and how it was built: the source query or proteomes and the membership release, the annotation release for each column group, the protein count, the embedding model, the projection parameters, the annotation sources, the ProtSpace version, the build command, and the paper figure it reproduces or, for the EAT showcase, that it is not a paper dataset and why. A section whose bundle has no Biocentral predictions SHALL say so and why. The build command SHALL name no path of the machine that built the bundle. Each section SHALL link to open the example in ProtSpace and to download its bundle. The page intro SHALL state that examples reopen in their curated state, name the example that is not a paper dataset, and say why every example carries both a UMAP and a PCA. A check SHALL fail in CI when the page is stale, when a catalog id has no section or no prose, when prose or a section exists for an id outside the catalog, when a thumbnail it names is missing, or when the in-repository demo differs from its manifest record. Once the catalog holds only the final entries, the check SHALL also fail while any thumbnail is still pending, while a value still to come (`‹…›`) is left on the page or in the hand-written pages that quote example numbers, when a stated release is not a UniProt release name (`YYYY_MM`), and when a section's statement that its bundle has no Biocentral predictions disagrees with the bundle's columns. The app SHALL link to the page from the Import menu's "Examples" heading, and to each section from that example's info control.

#### Scenario: Every entry is documented

- **WHEN** the documentation is built
- **THEN** the Example datasets page has a section anchored `{#<id>}` for every catalog id, and a unit test asserts each anchor

#### Scenario: A stale page

- **WHEN** the catalog, the manifest or the prose changes without regenerating the page
- **THEN** `pnpm docs:examples:check` fails, in CI as well as in precommit

#### Scenario: The large sets without Biocentral predictions

- **WHEN** the page describes `human-fly`, `beta-lactamase` or `swissprot`
- **THEN** its section says that the bundle has no Biocentral predictions, because they need per-residue embeddings, and that the Phobius signal-peptide column still covers signal peptides

#### Scenario: A machine path in the build command

- **WHEN** a manifest record's build command names a path such as `/private/tmp/…` or `/Users/…`
- **THEN** `pnpm docs:examples:check` fails

#### Scenario: No orphan section

- **WHEN** the prose or the page names an id that is not in the catalog
- **THEN** the check fails

### Requirement: Example bundle manifest

The repository SHALL hold a generated example bundle manifest, `apps/web/src/explore/example-manifest.ts`, recording for every catalog entry its file name, whether it is hosted in the repository or in a release, its decoded byte count, its sha256, its protein count, its annotation columns, its projections, whether it carries a statistics part, and its provenance: the membership release, the annotation release per column group, the ProtSpace version, the build command, the build time and the Zenodo DOI. It SHALL also record the release the files come from and any files of the previous release still served. Only the startup demo SHALL be committed to the repository; every other example file SHALL be published as an asset of a versioned GitHub release. The deployment SHALL download every release-hosted file the manifest names, including the retained files of the previous release, into the site's `examples/` directory. The deployment SHALL fail when any file is missing or its byte count or sha256 differs from the manifest, or when two files it deploys have the same name and different bytes. The manifest writer SHALL refuse a retained file named like a current file with other bytes. The Zenodo DOI SHALL be recordable after the bundles are built, and SHALL be kept by later manifest runs while a file's bytes are unchanged. A development build SHALL fetch an example that is missing locally from `https://protspace.app/examples/`; a production build SHALL fetch examples only from its own origin.

#### Scenario: A tampered or truncated asset

- **WHEN** a release asset's sha256 differs from the manifest during a deploy
- **THEN** the deploy fails before anything is published

#### Scenario: A re-release under the same file name

- **WHEN** the manifest lists a retained file with the same name as a current file but other bytes
- **THEN** the manifest writer refuses it, and the deploy fails before downloading anything

#### Scenario: The previous release is still served

- **WHEN** the manifest moves to a new release and lists the previous release's files as retained
- **THEN** the deployed site serves both the new files and the retained ones, so an open tab or a published link to a retained file keeps working for one cycle

#### Scenario: Local development without fetched bundles

- **WHEN** a development build loads an example whose file is not in `apps/web/public/examples/`
- **THEN** the app fetches it from `https://protspace.app/examples/<file>`

#### Scenario: Local development with fetched bundles

- **WHEN** a developer runs `pnpm examples:fetch`
- **THEN** every release-hosted example file is downloaded into the gitignored `apps/web/public/examples/` and verified against the manifest
