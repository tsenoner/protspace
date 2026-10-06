## ADDED Requirements

### Requirement: A Biocentral server the installed client cannot use SHALL be classified as unavailable

The prep pipeline SHALL classify a failure as `BIOCENTRAL_UNAVAILABLE` whenever the subprocess
output reports that no healthy Biocentral service was found, whatever reason follows —
including a server whose major version the installed client does not support — and SHALL log
the step's full output, reason included, server-side before the failure is re-tagged.

#### Scenario: Server and client disagree on the major version

- **WHEN** the `embed` step exits non-zero with stderr that begins
  `No healthy Biocentral service became available in time` and goes on to name the server's
  version and the versions the installed client supports
- **THEN** the pipeline raises a failure tagged `BIOCENTRAL_UNAVAILABLE`
- **AND** the user-facing message states the embedding service is unavailable and references
  Google Colab
- **AND** the versions appear in the server-side log line for the failed step, not in the
  message the user sees
