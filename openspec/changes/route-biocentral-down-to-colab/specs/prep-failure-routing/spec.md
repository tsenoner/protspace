## ADDED Requirements

### Requirement: Biocentral-unavailable failures are classified

The prep pipeline SHALL classify an embedding failure as
`BIOCENTRAL_UNAVAILABLE` when the subprocess output indicates the Biocentral
embedding service is unreachable, including the case where no healthy Biocentral
service becomes available before the embedder times out.

#### Scenario: Embedder times out waiting for a healthy service

- **WHEN** the `embed` step exits non-zero with stderr containing
  `No healthy biocentral service became available in time`
- **THEN** the pipeline raises a failure tagged `BIOCENTRAL_UNAVAILABLE`
- **AND** the user-facing message states the embedding service is unavailable and
  references Google Colab

#### Scenario: Connection-level outage still classified

- **WHEN** the `embed` step fails with a connection-refused, DNS, or 503 error
- **THEN** the pipeline raises a failure tagged `BIOCENTRAL_UNAVAILABLE`

#### Scenario: Unrelated embed failure passes through

- **WHEN** the `embed` step fails with an error unrelated to Biocentral
  availability
- **THEN** the failure is NOT tagged `BIOCENTRAL_UNAVAILABLE`
- **AND** the raw error detail is preserved for server-side logging while the
  user sees the generic retry-with-reference message

### Requirement: Biocentral-unavailable failures route the user to Colab

The frontend SHALL, when a FASTA preparation fails with code
`BIOCENTRAL_UNAVAILABLE`, show copy directing the user to the Google Colab
notebook and present a single clickable action that opens that notebook.

#### Scenario: Failure toast offers the Colab action

- **WHEN** the prep backend reports a failure with code `BIOCENTRAL_UNAVAILABLE`
- **THEN** the failure notification description names the embedding-service outage
  and points to Google Colab
- **AND** the notification carries an action labelled "Open in Colab ↗" whose
  target is the shared Colab notebook URL

#### Scenario: Colab takes the single action slot

- **WHEN** a `BIOCENTRAL_UNAVAILABLE` failure notification is shown
- **THEN** the Colab action occupies the toast's single action slot
- **AND** no bug-report action is attached for this code

#### Scenario: Activating the action opens the notebook

- **WHEN** the user activates the "Open in Colab ↗" action
- **THEN** the Colab notebook URL is opened in a new browser tab

### Requirement: Notifications support an optional action

The notification primitive SHALL accept an optional action consisting of a label
and an href, and SHALL render it as the toast's action control.

#### Scenario: Action forwarded to the toast

- **WHEN** a notification is emitted with an `action` of `{ label, href }`
- **THEN** the toast is created with an action control bearing that label
- **AND** activating it navigates to the href — `mailto:` links via the current
  window, `http(s)` links in a new tab with `noopener`

#### Scenario: No action when omitted

- **WHEN** a notification is emitted without an `action`
- **THEN** the toast is created without an action control
