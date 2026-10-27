## Context

`EXTRA_SHORT_KEYS` maps a shortcut to the id the Biocentral server is sent. Biotrainer resolves an
embedder by class detection. Its `ESMC` class matches only the exact ids `biohub/ESMC-300M`,
`-600M` and `-6B` and loads them with `AutoModel` / `AutoTokenizer`, refusing to run if they
resolve to anything but an ESM-C model and tokenizer. Any other id containing "esm" falls through
to the generic `EsmTokenizer` / `EsmModel` path, which is how Synthyra ids were silently loaded as
ESM-2. The server now validates ids and rejects Synthyra outright.

The Preparation notebook is served from `main` but installs the released package, and reads
`BIOCENTRAL_INVALID` from it under `try`/`except`, with a literal fallback that
`test_notebook_fallback_sets_match_the_package` pins to the package's value.

## Goals / Non-Goals

**Goals:** ESM-C works on Biocentral with the official weights; the notebook stops blocking it only
once the installed package sends those ids; the canary would catch a wrong-model answer.

**Non-Goals:** removing the per-backend blocking mechanism (the local `COLAB_OVERSIZED` rule uses
the same table); `esmc_6b`.

## Decisions

**Empty the set, keep the name.** Deleting `BIOCENTRAL_INVALID` would make the notebook's import
fail and fall back to its literal, so it would block ESM-C on every release. Emptying it lets each
release decide: 4.17.1 and earlier export `{esmc_300m, esmc_600m}` (and send Synthyra, which the
server now refuses), the next release exports `frozenset()`. The blocking table stays, ready for the
next rule. `test_blocked_sets_name_real_short_keys` drops its non-empty assertion for this set.

**Fallback literal becomes empty too.** It runs only when the import fails (protspace ≤ 4.11.1 or a
broken embedding stack). There, ESM-C on Biocentral now fails loudly with the server's 422 instead
of returning wrong vectors, so the gate no longer protects data. The existing test contract
(fallback equals the package) is kept rather than special-cased.

**A reference-vector canary, not a dimension check.** The old failure returned 960-d vectors of the
wrong model, so shape and finiteness checks would have passed. The canary embeds ubiquitin through
the package with `esmc_300m` and requires cosine ≥ 0.999 against a committed float32 vector from
the local backend on the official weights (measured agreement is ~1e-7 in cosine; the margin
absorbs precision changes on the server, and the wrong model scored about 0.02).

## Risks / Trade-offs

- [Biocentral changes ESM-C handling again] → The daily canary fails on a wrong answer, and the
  shortcut can go back into `BIOCENTRAL_INVALID`.
- [Biocentral ESM-C caches older than producer stamps] → An unstamped file is adopted on resume.
  They are rare (ESM-C on Biocentral was blocked in the notebook), and `--refetch embed` rebuilds
  them; the guide says so.
