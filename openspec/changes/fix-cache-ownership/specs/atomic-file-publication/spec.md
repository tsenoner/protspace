## ADDED Requirements

### Requirement: A file this package publishes appears complete or not at all

A file written for a user or a later run to read SHALL be staged beside its
destination and renamed into place, so an interrupted write leaves either the
previous content or nothing. This covers the bundle, the statistics and
annotation tables `stats` rewrites in place, and a retained query FASTA. A
half-written file at the final path is indistinguishable from a complete one:
the bundle overwrite workflow documents `-b results.parquetbundle -o
results.parquetbundle`, and a retained FASTA's existence is what the next run
reads as a cache hit.

#### Scenario: A write is interrupted

- **WHEN** an interruption or error occurs while writing a published file
- **THEN** the destination keeps its previous content, or stays absent if there was none
- **AND** the staged temporary file is removed

#### Scenario: A download is truncated

- **WHEN** a query download ends before its compressed stream is complete
- **THEN** decompression fails and nothing is published at the retained path
- **AND** a previously retained complete FASTA is left in place

#### Scenario: A write completes

- **WHEN** the staged file is written in full
- **THEN** it replaces the destination in one rename

### Requirement: A published file carries ordinary new-file permissions

A file published by staging and rename SHALL carry the permissions a normal new
file would receive under the process umask. Private temporary files are created
owner-only, so publishing one by rename hands the user a file their own group
and other tooling cannot read, which a direct write would never have done.

#### Scenario: A bundle is written under a permissive umask

- **WHEN** a bundle is written by a process whose umask allows group or other read
- **THEN** the published bundle is readable accordingly rather than owner-only

#### Scenario: A retained FASTA is published under a restrictive umask

- **WHEN** a retained query FASTA is published by a process with a restrictive umask
- **THEN** the published file respects that umask
