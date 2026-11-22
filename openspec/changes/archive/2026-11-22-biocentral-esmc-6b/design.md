## Context

`esmc_6b` shipped local-only (archived change `add-esmc-6b-local`) because Biocentral v2.0.1
failed it: fp32 loading moved 25.4 GB onto the shared GPU, and half precision lost results past
about 50 sequences. #561 planned to re-test after the fix shipped and, if only half precision
worked, to send `use_half_precision=True` for that key.

## Decisions

**No client-side precision flag.** Default precision on v2.1.0 embedded 60/60 and matches local
fp32, so the client sends what it sends for every other model.

**Remove `LOCAL_ONLY_EMBEDDERS` and its refusal path.** With `esmc_6b` served, the set is empty,
and no other model is expected to need it: an empty set kept for a hypothetical model is code and
tests (a patched-in key) that guard nothing. Every CLI shortcut is now served by both backends, and
the registry test pins that. If a future model again runs only locally, the refusal comes back with
it.

**Remove `BIOCENTRAL_INVALID` now.** #559 waited for the first release with the official ESM-C ids
(4.18.0). The notebook installs the latest release (4.19.0), where the set is already empty, so
dropping its import changes nothing a user sees. The canary (`test_esmc_is_the_official_model`) is
the guard that replaces it.

**The notebook drops its Biocentral gate too.** It installs the latest release, and merging this
change cuts one (a `feat:` commit on `main` triggers the release), so the 4.19.0 window in which
the panel would offer `esmc_6b` on Biocentral while the CLI still refuses it is the few minutes
between the merge and the PyPI upload. Even then the CLI's refusal is a clear usage error, not a
failed run.

**A 6B reference vector for the canary.** Ubiquitin from the local backend, fp32 on CPU, as the
300M/600M references were made. One more embedding request a day (~30 s, the model is loaded on
demand), which is the only way a wrong-model answer for 6B would be noticed.

## Risks

- The canary now loads a 25 GB model on a shared server daily. If the Biocentral team objects, drop
  the 6B parameter; the shortcut does not depend on it.
