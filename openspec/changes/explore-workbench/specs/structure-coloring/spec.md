## ADDED Requirements

### Requirement: A disabled structure colour option says why

The structure viewer's colour control SHALL keep the TED domains option on screen when it cannot be
used, disabled, with a tooltip that gives the reason: "Available once the structure has loaded"
while the structure is loading, and "TED domain annotations are unavailable for this protein" once
it has loaded without TED domains. The pLDDT option SHALL be disabled while the structure is
loading. A disabled option SHALL change nothing when it is pressed, and its reason SHALL come from
the tooltip, not from a native `title`. When TED domains are available, the option's tooltip SHALL
read "Color residues by TED domain".

#### Scenario: Still loading

- **WHEN** a structure is still loading
- **THEN** the TED domains option is disabled and hovering it shows "Available once the structure
  has loaded"

#### Scenario: No TED domains

- **WHEN** the structure has loaded and the protein has no TED domains
- **THEN** the TED domains option is disabled with the reason "TED domain annotations are
  unavailable for this protein"
- **AND** pressing it leaves the structure coloured by pLDDT
