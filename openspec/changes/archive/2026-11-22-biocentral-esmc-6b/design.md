## Context

`esmc_6b` shipped local-only (archived change `add-esmc-6b-local`) because Biocentral v2.0.1
failed it: fp32 loading moved 25.4 GB onto the shared GPU, and half precision lost results past
about 50 sequences. #561 planned to re-test after the fix shipped and, if only half precision
worked, to send `use_half_precision=True` for that key.

## Decisions

**No client-side precision flag.** Default precision on v2.1.0 embedded 60/60 and matches local
fp32, so the client sends what it sends for every other model.

**Keep `LOCAL_ONLY_EMBEDDERS`, empty.** Unlike `BIOCENTRAL_INVALID`, nothing else would catch a
future model that Biocentral accepts but cannot compute: the CLI would accept it and the user would
learn mid-embed. The refusal path stays, and its tests patch a local-only key in instead of relying
on a real one. The help suffix is printed only when the set is non-empty.

**Remove `BIOCENTRAL_INVALID` now.** #559 waited for the first release with the official ESM-C ids
(4.18.0). The notebook installs the latest release (4.19.0), where the set is already empty, so
dropping its import changes nothing a user sees. The canary (`test_esmc_is_the_official_model`) is
the guard that replaces it.

**The notebook keeps its `getattr(..., "LOCAL_ONLY_EMBEDDERS", frozenset())`.** Released 4.19.0
still lists `esmc_6b` there and still refuses it on Biocentral, so the panel must keep disabling it
until the next release; after that the set comes back empty and the gate disables nothing.

**A 6B reference vector for the canary.** Ubiquitin from the local backend, fp32 on CPU, as the
300M/600M references were made. One more embedding request a day (~30 s, the model is loaded on
demand), which is the only way a wrong-model answer for 6B would be noticed.

## Risks

- The canary now loads a 25 GB model on a shared server daily. If the Biocentral team objects, drop
  the 6B parameter; the shortcut does not depend on it.
