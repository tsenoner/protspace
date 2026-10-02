## ADDED Requirements

### Requirement: An imported file's bytes SHALL be in OPFS before its render starts

When a user imports a bundle, the web app SHALL finish writing both the file's bytes and its
pending-load record to OPFS before it starts rendering the dataset, so the load-recovery banner can
offer the same file again after a crash during that render. A failure to persist SHALL be reported
as a warning notice and SHALL NOT stop the render.

#### Scenario: The tab dies during the first render

- **WHEN** a user imports a bundle and the tab is closed or crashes before the render finishes
- **THEN** on the next visit the recovery banner offers that bundle, and retrying loads it from OPFS

#### Scenario: The render begins

- **WHEN** the dataset controller starts rendering an imported dataset
- **THEN** the OPFS write of that file's bytes has already completed or failed

#### Scenario: OPFS is unavailable

- **WHEN** writing the imported file to OPFS fails
- **THEN** a persistence-failure warning is shown and the dataset still renders
