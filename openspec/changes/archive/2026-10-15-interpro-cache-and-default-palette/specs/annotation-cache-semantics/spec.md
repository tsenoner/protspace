## ADDED Requirements

### Requirement: Caches written before InterPro's canonical-sequence lookup are refreshed

ProtSpace SHALL NOT reuse cached InterPro columns stamped version 3 or earlier. Those versions
looked InterPro up by the FASTA's sequence whenever one was given, where InterPro now takes
UniProt's canonical sequence first, so a cached match, or a cached absence of one, may belong to
a different sequence. A run that requests such a column SHALL refetch InterPro once and stamp the
rewritten cache as current.

#### Scenario: A version-3 cache is asked for pfam

- **WHEN** a run requests `pfam` and a UniProt column from a cache stamped version 3
- **THEN** ProtSpace refetches InterPro once, reuses the cached UniProt values, and stamps the
  cache current, so the next run fetches nothing
