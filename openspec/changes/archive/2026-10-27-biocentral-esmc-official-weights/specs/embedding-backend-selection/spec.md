## REMOVED Requirements

### Requirement: ESM-C is blocked on the Biocentral backend

**Reason**: Biocentral now serves the official ESM-C checkpoints with a dedicated embedder, and its
vectors match the local backend's. The Synthyra ids that triggered the wrong-model answer are
refused by the server.

**Migration**: None. Released packages that still send the Synthyra ids keep exporting the blocked
set, so the notebook keeps blocking ESM-C for them until the release that switches the ids.

## ADDED Requirements

### Requirement: Biocentral serves ESM-C from the official checkpoints

The Biocentral backend SHALL request `esmc_300m` and `esmc_600m` under the official ESM-C
checkpoint ids, the same checkpoints the local backend loads, so either backend yields the same
vectors for the same sequence. A scheduled check against the live server SHALL compare an ESM-C
embedding with a reference computed from the official weights, so a server that answers with
another model fails the check instead of passing it.

#### Scenario: ESM-C requested through Biocentral

- **WHEN** the effective backend is the Biocentral API and an `esmc_*` shortcut is selected
- **THEN** it is available, and the request names the official checkpoint

#### Scenario: Both backends agree

- **WHEN** the same sequence is embedded with `esmc_300m` on each backend
- **THEN** the two vectors agree to within float32 precision

#### Scenario: The server answers with another model

- **WHEN** the live check's ESM-C vector does not match the reference
- **THEN** the check fails
