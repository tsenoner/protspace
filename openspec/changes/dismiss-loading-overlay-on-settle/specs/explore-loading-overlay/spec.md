## ADDED Requirements

### Requirement: The loading overlay is dismissed once a load has settled

The Explore loading overlay SHALL be dismissed once the load that showed it has settled: after a successful load has finished rendering and its post-load work (file settings, dataset name, view restore and the persisted load status), and immediately when a load fails or is cancelled. The overlay SHALL be dismissed before the next queued load is allowed to start. A load result that a newer load has superseded SHALL NOT dismiss the overlay of the load that is running.

#### Scenario: A load succeeds

- **WHEN** a dataset load finishes rendering and its post-load work completes
- **THEN** the overlay is dismissed
- **AND** it is dismissed before the next queued load starts

#### Scenario: A small dataset loads

- **WHEN** a dataset of 1000 proteins or fewer is loading
- **THEN** the overlay stays up until rendering and the post-load work have finished

#### Scenario: A load fails

- **WHEN** an imported bundle cannot be read or its post-load work throws
- **THEN** the overlay is dismissed and the application is usable without a page reload

#### Scenario: A load is cancelled

- **WHEN** a load is aborted
- **THEN** the overlay is dismissed, unless a newer load has shown it again

#### Scenario: A superseded result arrives

- **WHEN** a load result arrives after a newer load has started
- **THEN** the newer load's overlay stays up

### Requirement: A completed load is not held behind a fixed delay

The Explore loading flow SHALL NOT hold the overlay for a fixed time after a load completes, whatever the dataset size.

#### Scenario: A large dataset finishes rendering

- **WHEN** a dataset of more than 1000 proteins finishes rendering and its post-load work
- **THEN** the overlay is dismissed without a timed "Ready to explore!" hold

### Requirement: Dismissal removes the overlay synchronously

Dismissing the loading overlay SHALL remove its element from the document synchronously, with no fade and no deferred removal timer.

#### Scenario: The overlay is dismissed

- **WHEN** the overlay controller is told to hide the overlay
- **THEN** `#progressive-loading` is no longer in the document when the call returns
