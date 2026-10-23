## MODIFIED Requirements

### Requirement: Structure viewer exposes protein resource links

When a protein is selected and the structure viewer header is shown, the system SHALL expose
AlphaFold, UniProt, InterPro, and TED as external resource links for that protein, presented as
one ordered row in which every entry carries the same label treatment, the same indication that
it leaves the application, and the same safe new-tab behavior.

The row SHALL sit under the viewer's header in a row of its own that wraps rather than clips, and
every link SHALL stay visible and usable in each placement of the viewer: docked in the sidebar at
its narrowest (240 px), in the floating card at its narrowest (280 px), and in the phone's structure
sheet once it is expanded; the folded sheet shows only the header. A protein tooltip pinned with a
mouse SHALL offer the same row above its actions; the compact card a tap pins on a touch screen
SHALL NOT, leaving the links to the structure sheet.

The row SHALL be rendered from a single ordered definition of those destinations rather than from
per-destination markup, and the header title SHALL NOT itself be a link.

#### Scenario: The row lists every resource in order

- **WHEN** the structure viewer renders a selected protein
- **THEN** its header shows AlphaFold, UniProt, InterPro, and TED in that order
- **AND** each opens in a new tab without granting the destination access to the opener

#### Scenario: Resource links are distinguishable from the accession beside them

- **WHEN** the structure viewer header renders its resource row
- **THEN** each entry is marked as leaving the application rather than presented in the same
  treatment as the protein identifier

#### Scenario: The title is not a hidden link

- **WHEN** the structure viewer header renders its title
- **THEN** the title carries no link target, and AlphaFold is reachable from the resource row

#### Scenario: The narrowest placements

- **WHEN** the structure is docked in a 240 px sidebar, or floating in a 280 px card
- **THEN** every resource link is visible inside the viewer and the TED link is the topmost element
  at its centre

#### Scenario: A pinned tooltip offers the row

- **WHEN** the sidebar is collapsed and the user clicks a protein, pinning its tooltip with "View
  structure"
- **THEN** the tooltip shows AlphaFold, UniProt, InterPro and TED links, in that order
- **AND** a tap on a touch screen pins a compact card without them
