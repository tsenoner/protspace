## MODIFIED Requirements

### Requirement: Choosing an example from the Import menu

The Import panel SHALL be one dialog in the app bar, opened by Import, by the dataset name, and on a
phone by the More sheet's Import data. It SHALL offer "Open a file…" first, with the formats it
reads; then, while an imported file is stored and is not the dataset on screen, a "Last file" row
that reopens it; then every catalog entry under an "Examples" heading: the demo first, then the rest
by ascending protein count. The heading SHALL carry an "About these examples" link to the Example
datasets documentation page, opening in a new tab, and the hint "Examples open in a curated view;
your changes aren't kept." Each item SHALL show its label and an info control that reveals its
description, its insight and a "Learn more" link to its documentation section; the info control
SHALL NOT load the example. Entries marked large SHALL show a "Large" badge, and their info SHALL
state the download size, the expected browser memory and the load time. The currently loaded
example SHALL be disabled and checked, and SHALL keep its info control in the list; the dataset
name in the app bar has none. Choosing an item SHALL load that example and open it on its curated
default view, and SHALL keep the user's stored import, which "Last file" then reopens.

#### Scenario: Choose an example

- **WHEN** the user chooses an example other than the one loaded
- **THEN** the example loads on its curated default view, the stored import is kept, and the item for that example becomes disabled

#### Scenario: A user file is loaded

- **WHEN** the current dataset is a user import
- **THEN** no example item is disabled

#### Scenario: Learn about an example

- **WHEN** the user opens an example's info control in the Import panel
- **THEN** its description, its insight and a link to `/docs/explore/example-datasets#<id>` are shown, and the example is not loaded

#### Scenario: A large example

- **WHEN** the Import panel lists `swissprot`
- **THEN** its item shows a "Large" badge, and its info states the download size, the expected browser memory and the load time

#### Scenario: The menu says examples reopen curated

- **WHEN** the Import panel lists at least one example
- **THEN** the "Examples" heading shows the "About these examples" link and the hint that changes made to an example are not kept

#### Scenario: Last file after an example

- **WHEN** the user imports a file and then chooses an example
- **THEN** the Import panel offers the imported file under "Last file", and choosing it reopens that
  file
- **AND** while the imported file is on screen, no "Last file" row is offered

### Requirement: Request precedence

A user-initiated dataset request SHALL take precedence over any app-initiated load that began before it. User-initiated requests are a menu choice, a Back/Forward navigation (including one to an entry without `dataset=`), a file import, a recovery-banner button, a Retry and a Cancel. App-initiated loads are the startup restore of the stored import, the startup demo, the recovery load after a corrupt stored import, and the fallback after a failed deep link. An app-initiated load preempted by a user request SHALL stop before starting any load, and SHALL show no recovery banner and no notification. While a URL-driven switch to a dataset is pending, a history navigation that changes only the view parameters for that same dataset SHALL be recorded and applied by the pending load, not resolved against the dataset still on screen. A Back/Forward navigation while a menu-chosen example is loading SHALL cancel that load: its download is aborted, the loading overlay is dismissed if the navigation starts no load of its own, and no history entry is pushed for it. Once that example has decoded and begun replacing the plot (a menu choice keeps the stored import), a Back/Forward that changes only the view parameters SHALL NOT cancel it: the example finishes on its curated view and pushes its own entry, and the entry the navigation landed on is left unchanged. A load superseded by a newer user request before it has begun replacing the plot, whether an example, the startup restore of the stored import or a user import, SHALL NOT render, save the import, or change the URL; a superseded restore that decoded SHALL still record that it loaded, so no recovery banner is offered for it. A load superseded after that point SHALL finish what it began (saving a user import, clearing the stored import for the recovery banner's Load default, and replacing the plot), and SHALL be named as the dataset on screen until the newer request's own load replaces it, but SHALL NOT change the URL, the view the newer request asked for, or the loading overlay that request shows. A startup load run by a user request while that restore is still in flight SHALL wait for it and restore the import, not offer recovery. A user request SHALL abort a FASTA preparation still running, and the loading overlay's Cancel SHALL act on the newest request. A restore preempted after it marked the stored import's load as pending SHALL put the previous status back.

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

#### Scenario: A Back/Forward lands while a menu example replaces the plot

- **WHEN** the user chooses an example, and a Back/Forward to an entry naming another dataset lands after the example has begun replacing the plot
- **THEN** the example finishes replacing it and is named in the app bar, no history entry is pushed for it, and the dataset the navigation named then loads over it

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
