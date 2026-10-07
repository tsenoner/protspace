## ADDED Requirements

### Requirement: A scheduled check compares the live server with the shipped client

A scheduled workflow SHALL run live checks against the Biocentral server, using the `biocentral-api` version the lock pins, at least once a day, so that a server major the client refuses, or a server whose answers the package no longer reads, is noticed before a user reports it. The checks SHALL skip when the server cannot be reached and SHALL fail when it answers but cannot be used. They SHALL NOT run as part of the ordinary test suite.

#### Scenario: The server moves to a major the client does not accept

- **WHEN** the live server reports a major outside the locked client's window
- **THEN** the scheduled run fails with the message that names both versions

#### Scenario: The server is down

- **WHEN** the live server does not answer its health check
- **THEN** the checks are skipped and the run does not fail

#### Scenario: A prediction model is renamed on the server

- **WHEN** the server answers a prediction request but a Biocentral annotation column comes back empty
- **THEN** the scheduled run fails, naming the protein and its annotations

#### Scenario: An ordinary test run

- **WHEN** the test suite runs without `PROTSPACE_LIVE_BIOCENTRAL=1`
- **THEN** no request is made to the Biocentral server by the live checks
