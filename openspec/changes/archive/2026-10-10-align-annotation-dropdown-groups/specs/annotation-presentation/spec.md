## REMOVED Requirements

### Requirement: Dedicated "Predicted" group in the annotation dropdown

**Reason**: Since 8e5d0df7 the dropdown groups annotations only by source and marks predicted annotations with a per-row badge. Predictions come from several sources, and the source section says where a value comes from.

**Migration**: Replaced by "The annotation dropdown groups annotations by source".

## ADDED Requirements

### Requirement: The annotation dropdown groups annotations by source

The annotation selection dropdown SHALL group annotations into source sections, in the order Biocentral, InterPro, TED, Taxonomy, UniProt, Other, and SHALL leave out sections that have no annotations. Within a section, annotations SHALL be sorted alphabetically, except Taxonomy, which SHALL be ordered by rank from general to specific. A predicted annotation, as derived from the annotation-metadata registry, SHALL stay in its source section, SHALL NOT be duplicated in another section, and SHALL carry the predicted badge on its row. Search and keyboard navigation SHALL work across all sections.

#### Scenario: Predicted annotations stay in their source sections

- **WHEN** the dropdown is opened for a bundle containing Biocentral predictions, InterPro de-novo predictors and UniProt annotations
- **THEN** each annotation is listed once, under its source section, the sections appear in the defined order, and every predicted annotation's row carries the predicted badge

#### Scenario: Search and keyboard navigation span every section

- **WHEN** the user filters or arrow-key-navigates the dropdown
- **THEN** items in every section are included in the filtered results and navigation order, and sections left without a match are hidden
