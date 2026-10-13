# biocentral-connection Specification

## Purpose

How the package connects to the Biocentral server that embedding and annotation both use, and
what it reports when no usable server is found. The `biocentral-api` client only talks to servers
whose major version lies inside a window it hard-codes, and it reports a server outside that window
exactly as it reports a dead one, so a client and server on different majors looked like an outage.
This capability exists to say which it was — in words the prep service still routes to its
"service unavailable" path — and to keep one address and one wait for every Biocentral call site.

## Requirements

### Requirement: A failed connection to Biocentral says why no server was usable

When no healthy Biocentral server becomes available within the wait, the package SHALL
raise `BiocentralUnavailableError` whose message begins `No healthy Biocentral service
became available in time` and then gives the reason, found by one direct request to the
server's `/health`. That request is made only after the wait has failed, so a successful
connection costs nothing extra.

#### Scenario: The server does not answer

- **WHEN** the health request fails with a connection error or a timeout, or the server
  answers with an error status (4xx or 5xx)
- **THEN** the message says the server did not answer its health check
- **AND** it carries the underlying error text, so `connection refused`, a name-resolution
  failure or a `503` stays visible

#### Scenario: The server runs a major version the client does not support

- **WHEN** `/health` answers 200 with a version whose major is outside the window the
  installed `biocentral-api` accepts (`MIN_API_VERSION` up to, not including,
  `MAX_API_VERSION`)
- **THEN** the message names the server's version, the installed client's version and the
  window the client supports
- **AND** when the server is newer than the window it tells the user to run
  `pip install -U protspace`
- **AND** when the server is older than the window it says so and does not advise upgrading

#### Scenario: Majors are compared as numbers

- **WHEN** the server reports a two-digit major such as `10.0.0` and the client's window is
  `2.0.0` up to `3.0.0`
- **THEN** the server is reported as newer than the window, not inside it

#### Scenario: The server is in the supported window but did not pass the health check

- **WHEN** `/health` answers 200 with a version inside the client's window
- **THEN** the message says the server reports that version but did not pass the client's
  health check in time
- **AND** it does not blame the client version

#### Scenario: The health request cannot be read

- **WHEN** `/health` answers 200 with a body that has no readable version
- **THEN** the message says the server answered without a version, and the failure is still
  raised as `BiocentralUnavailableError`

### Requirement: A Biocentral connection failure SHALL be a stage failure, not a traceback

`BiocentralUnavailableError` SHALL be a `ValueError`, so the handlers that already render
stage failures print `ERROR: <message>` and exit 1 instead of a raw traceback.

#### Scenario: protspace embed meets an unusable server

- **WHEN** `protspace embed` cannot find a usable Biocentral server
- **THEN** it prints `ERROR:` followed by the message and exits 1
- **AND** no Python traceback is printed
- **AND** the message is on stderr, where the prep service reads it

#### Scenario: Annotation predictions meet an unusable server

- **WHEN** the Biocentral annotation retriever cannot find a usable server
- **THEN** it logs the message as a warning and returns no predictions
- **AND** it marks the source as failed, so the empty columns are not cached as negative
  predictions

#### Scenario: A multi-model embed meets an unusable server

- **WHEN** `protspace embed` is given several models and no usable server is found
- **THEN** it waits for the server once, reports the failure once and exits 1
- **AND** it does not try the remaining models, which go to the same server

### Requirement: Every Biocentral call site SHALL connect through one address and one helper

Embedding, the embedder probe and the annotation predictor SHALL take the server address
from one constant and wait for the server through one helper, so a connection failure reads
the same wherever it happens.

#### Scenario: The three call sites report the same failure

- **WHEN** no usable server is found while embedding, while probing an embedder, and while
  predicting annotations
- **THEN** each reports the same `BiocentralUnavailableError` message for the same server state

#### Scenario: The helper does not depend on the client at import

- **WHEN** the helper is imported while the client library is absent or has been replaced
  by a test double
- **THEN** the import succeeds, and a failure message reads the versions the client
  supports off the client it was handed

### Requirement: Embedder shortcuts SHALL resolve without the client's enum member names

Every shortcut in `MODEL_SHORT_KEYS` SHALL resolve to a model id that protspace holds
itself, so that a renamed or removed member of the client's `CommonEmbedder` does not break
importing the embedding package, the offline backend included, and a test SHALL fail when an
id is no longer one the client lists.

#### Scenario: A client release renames a member

- **WHEN** the client's `CommonEmbedder` has no member under the name protspace once used
- **THEN** every shortcut still resolves to the same model id, and the package still imports

#### Scenario: The client stops listing an id

- **WHEN** an id in `MODEL_SHORT_KEYS` is not among the ids the client's `CommonEmbedder` lists
- **THEN** the shortcut test fails and names the missing ids

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
