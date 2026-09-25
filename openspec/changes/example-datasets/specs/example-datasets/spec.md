## ADDED Requirements

### Requirement: Example catalog

The app SHALL define a static catalog of example datasets. Each entry SHALL have a unique `id`, a `label` that states the protein count and download size, a one-line `description`, and a same-origin `url`. The first entry SHALL be the startup demo, `id: 'demo'`, served from `./data.parquetbundle`.

#### Scenario: Known id

- **WHEN** the catalog is queried for an id it contains
- **THEN** it returns that entry

#### Scenario: Unknown id lookup

- **WHEN** the catalog is queried for an id it does not contain
- **THEN** it returns nothing

### Requirement: Choosing an example from the Import menu

The control bar's Import menu SHALL list every catalog entry under an "Examples" heading, below "Load your dataset": the demo first, then the rest by ascending protein count. Each item SHALL show its label, with the description as its tooltip. The currently loaded example SHALL be disabled. Choosing an item SHALL load that example and replace the user's stored import, as choosing the demo does today.

#### Scenario: Choose an example

- **WHEN** the user chooses an example other than the one loaded
- **THEN** the example loads, the stored import is cleared, and the item for that example becomes disabled

#### Scenario: A user file is loaded

- **WHEN** the current dataset is a user import
- **THEN** no example item is disabled

### Requirement: Dataset deep link

The `dataset` query parameter SHALL name the example to show. At startup, a known id SHALL be loaded in place of restoring the stored import, and the stored import SHALL be left untouched. Choosing an example from the menu SHALL set `dataset=<id>` as a new history entry. Importing a user file SHALL remove the parameter without adding a history entry. Loading the demo by default at startup SHALL NOT set the parameter. When Back or Forward changes the parameter, the app SHALL load the named example, or run the normal startup load when the parameter is gone. `annotation`, `projection` and `tooltip` parameters in the same URL SHALL apply to the loaded example.

#### Scenario: Open a deep link

- **WHEN** the app opens with `?dataset=<known id>` while a user import is stored
- **THEN** the example loads, and opening the app again without the parameter restores the stored import

#### Scenario: Deep link with view parameters

- **WHEN** the app opens with `?dataset=<id>&annotation=<a>` and the example has annotation `<a>`
- **THEN** the example loads with `<a>` selected

#### Scenario: Unknown id

- **WHEN** the app opens with `?dataset=<unknown id>`
- **THEN** a warning is shown, the parameter is removed without a new history entry, and startup continues with the stored import or the demo

#### Scenario: Menu choice and Back

- **WHEN** the user chooses an example from the menu and then presses Back
- **THEN** the URL gains `dataset=<id>` and Back returns to the previously shown example, or to the normal startup load if the previous URL had no parameter

#### Scenario: User import clears the parameter

- **WHEN** the user imports a file while `dataset=` is set
- **THEN** the parameter is removed and no history entry is added

### Requirement: Example load failure

If fetching or parsing an example fails, the app SHALL show an error notification and dismiss the loading overlay. A failed menu choice SHALL leave the current plot and URL unchanged. A failed deep link SHALL remove the parameter without a new history entry and continue with the normal startup load.

#### Scenario: Menu choice fails

- **WHEN** the chosen example's fetch returns an HTTP error
- **THEN** an error notification is shown and the previous dataset stays on screen with the URL unchanged

#### Scenario: Deep link fails

- **WHEN** the app opens with `?dataset=<id>` and the fetch fails
- **THEN** an error notification is shown, the parameter is removed, and the stored import or demo loads
