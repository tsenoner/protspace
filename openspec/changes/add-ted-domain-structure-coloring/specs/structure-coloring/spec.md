## ADDED Requirements

### Requirement: pLDDT remains the default structure color mode

The structure viewer SHALL display each newly loaded AlphaFold structure with the existing pLDDT confidence color theme selected.

#### Scenario: Structure loads successfully

- **WHEN** an AlphaFold structure finishes loading
- **THEN** the color control identifies pLDDT as the active mode
- **AND** the viewer uses Mol\*'s pLDDT confidence theme

#### Scenario: A prior structure finishes after its viewer is replaced

- **WHEN** a structure load finishes after its Mol\* viewer has been closed or replaced
- **THEN** the stale completion does not report a structure error
- **AND** the stale completion does not change the current viewer's color theme

### Requirement: TED domain annotations are optional

The system SHALL request TED domain annotations for the displayed accession and SHALL NOT fail or indefinitely delay structure loading when the TED request fails, stalls, returns no domains, or contains no valid residue segments.

#### Scenario: TED annotations are available

- **WHEN** the TED endpoint returns domains with valid inclusive residue segments
- **THEN** the structure data exposes those domains and segments to the viewer
- **AND** the TED domain color option is enabled

#### Scenario: TED annotations are unavailable

- **WHEN** the TED request fails or produces no valid domain segments
- **THEN** the AlphaFold structure still loads normally
- **AND** the TED domain color option is disabled

#### Scenario: TED annotation request stalls

- **WHEN** the TED request does not settle within five seconds
- **THEN** the system aborts the optional request
- **AND** the AlphaFold structure still loads normally with no TED domains

### Requirement: User can switch structure color modes

The structure viewer SHALL provide pLDDT and TED domains color options after a structure loads and SHALL update the existing Mol\* representations without reloading the structure.

#### Scenario: User selects TED domain coloring

- **WHEN** valid TED domains exist and the user activates the TED domains option
- **THEN** the viewer applies TED domain colors to the loaded representations
- **AND** the control and explanatory text identify TED domains as active

#### Scenario: User returns to pLDDT coloring

- **WHEN** the user activates pLDDT after viewing TED domain colors
- **THEN** the viewer reapplies Mol\*'s built-in pLDDT confidence theme
- **AND** the control and explanatory text identify pLDDT as active

#### Scenario: User changes mode while a theme update is in progress

- **WHEN** a TED domain theme update is still in progress and the user activates pLDDT
- **THEN** the viewer applies pLDDT after the in-progress update finishes
- **AND** the control and explanatory text identify pLDDT as the final active mode

#### Scenario: Structure changes while a theme update is in progress

- **WHEN** a new protein replaces the viewer before the prior viewer's theme update finishes
- **THEN** the prior update completion does not change the new structure's color mode
- **AND** the new structure retains the default pLDDT control state

### Requirement: TED residue colors are consistent by domain

The TED color theme SHALL assign one deterministic categorical color per TED domain number across every valid inclusive segment and SHALL color residues outside TED assignments with a neutral color.

#### Scenario: Domain contains discontinuous segments

- **WHEN** one TED domain contains multiple non-contiguous residue intervals
- **THEN** residues in every interval receive the same domain color

#### Scenario: Residue is not assigned to a domain

- **WHEN** a rendered residue sequence number falls outside every TED interval
- **THEN** the residue receives the neutral unassigned color

#### Scenario: Mol\* supplies different location kinds

- **WHEN** Mol\* requests a TED color for an atomic element or bond location
- **THEN** the theme resolves the location to its `label_seq_id` residue number
- **AND** a coarse or unmappable location receives the neutral unassigned color
