## ADDED Requirements

### Requirement: Caches written before the TMbed payload validation are refreshed

ProtSpace SHALL NOT reuse cached `predicted_signal_peptide` or `predicted_transmembrane`
values stamped version 3 or earlier. Those versions wrote signal peptide `False` for a
TMbed prediction with an empty topology and read a malformed payload as a topology. A run
that requests such a column SHALL refetch Biocentral once and stamp the rewritten cache as
current. A stale column of a source the refresh refetches anyway SHALL be refreshed with it
rather than dropped.

#### Scenario: A version-3 cache is asked for the signal peptide

- **WHEN** a run requests `predicted_signal_peptide` and columns from other sources from a
  cache stamped version 3
- **THEN** ProtSpace refetches Biocentral once and fetches no other source
- **AND** the rewritten cache is stamped current, so the next run fetches nothing

#### Scenario: Only one TMbed column is requested

- **WHEN** a run requests `predicted_transmembrane` but not `predicted_signal_peptide` from
  a cache that holds both under superseded semantics
- **THEN** the one Biocentral refetch also refreshes `predicted_signal_peptide`, which stays
  in the cache and out of the run's result
