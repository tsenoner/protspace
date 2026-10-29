## ADDED Requirements

### Requirement: An Example-tab run takes its annotations from the example's bundle

When Generate runs on the Example tab, the Preparation panel SHALL take every annotation column the
request names from the example's `<name>_v3.parquetbundle` in the `examples` release, when that
bundle holds it, and SHALL fetch only the requested columns it lacks, together with a custom CSV
when one is given. Those bundles hold the annotations fetched for exactly the example's proteins,
so fetching them again on each run only costs time: about 20 minutes for the Snake Toxin example
on Colab before tsenoner/protspace#557. With "Fetch annotations again" ticked, or when the bundle
cannot be fetched or read, the panel SHALL fetch every requested column as for any other input.
The run SHALL say how many columns came from the bundle.

#### Scenario: The default annotations of an example

- **WHEN** the user generates from an example with the default annotations
- **THEN** every default column comes from the example's bundle and no annotation is fetched
- **AND** the run says how many columns came from the bundle

#### Scenario: A column the bundle lacks

- **WHEN** the request names a column the example's bundle does not hold
- **THEN** that column is fetched, and the columns the bundle holds still come from it

#### Scenario: A custom CSV with an example

- **WHEN** the user generates from an example with the default annotations and a custom CSV
- **THEN** the default columns come from the bundle and the CSV's columns are added to them

#### Scenario: Fetch annotations again

- **WHEN** "Fetch annotations again" is ticked
- **THEN** the bundle is not read and every requested column is fetched

#### Scenario: The bundle cannot be fetched

- **WHEN** the example's bundle cannot be downloaded or read
- **THEN** the run says so and fetches every requested column instead
