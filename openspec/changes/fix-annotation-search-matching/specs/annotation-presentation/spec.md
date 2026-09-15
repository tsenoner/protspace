## ADDED Requirements

### Requirement: Annotation search matches displayed text or a column-name word

Every annotation picker SHALL match a search query against an annotation when the query is a
substring of that annotation's displayed label, or a prefix of one of the words in its column
name, and SHALL NOT match on an arbitrary substring of the column name. All annotation pickers
SHALL apply this same rule.

#### Scenario: A query does not match the middle of a column name

- **WHEN** the reader searches for `ted`
- **THEN** `ted_domains` is offered
- **AND** `predicted_membrane`, `predicted_signal_peptide`, `predicted_subcellular_location`
  and `predicted_transmembrane` are not offered, because `ted` appears only inside the word
  `predicted`

#### Scenario: A column name is still searchable by word

- **WHEN** the reader searches for `predicted`
- **THEN** every `predicted_*` annotation is offered

#### Scenario: A partial word of a label still matches

- **WHEN** the reader searches for `cellular`
- **THEN** the annotation labelled `Subcellular location` is offered

#### Scenario: Both pickers agree

- **WHEN** the same query is entered in the annotation dropdown and in the query builder's
  annotation picker
- **THEN** both offer the same annotations
