## ADDED Requirements

### Requirement: Annotation search matches a label substring or a column-name word

Every annotation picker SHALL match a search query against an annotation when the query is a
substring of that annotation's label, or begins at a word boundary of its column name, and
SHALL NOT match on an arbitrary substring of the column name. A column SHALL remain findable
by its own full name, separators included. All annotation pickers SHALL apply this same rule,
through one shared implementation.

#### Scenario: A query does not match the middle of a column name

- **WHEN** the reader searches for `ted`
- **THEN** `ted_domains` is offered
- **AND** `predicted_membrane`, `predicted_signal_peptide`, `predicted_subcellular_location`
  and `predicted_transmembrane` are not offered, because `ted` appears only inside the word
  `predicted`

#### Scenario: A column name is still searchable by word

- **WHEN** the reader searches for `predicted`
- **THEN** every `predicted_*` annotation is offered

#### Scenario: A column is findable by its own full name

- **WHEN** the reader types a complete column name such as `predicted_membrane`
- **THEN** that annotation is offered, the separator notwithstanding

#### Scenario: A partial word of a label still matches

- **WHEN** the reader searches for `cellular`
- **THEN** the annotation labelled `Subcellular location` is offered

#### Scenario: Both pickers agree

- **WHEN** the same query is entered in the annotation dropdown and in the query builder's
  annotation picker
- **THEN** both offer the same annotations
