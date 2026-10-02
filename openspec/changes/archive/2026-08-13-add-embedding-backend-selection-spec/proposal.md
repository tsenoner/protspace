# Spec the embedding-backend selection surface

## Why

The local embedding backend shipped through issue #320 without an OpenSpec change, so
nothing in `openspec/specs/` describes it. Grepping the whole spec corpus for `esm`,
`embedder`, `colab` or `notebook` hits only `prep-failure-routing`, and only in its
Colab-routing copy.

That gap stopped being theoretical while reviewing #446. Two rules govern which embedders
a backend may serve, and until this change they lived only as literals in a notebook cell:

- `esmc_*` is unusable through Biocentral, whose API returns embeddings orthogonal to the
  real model (a biotrainer architecture mis-load).
- `esm2_3b` cannot load on a free Colab runtime.

Both were enforced by the notebook alone, in two places that had already drifted apart —
the checkbox gating knew one rule, the drop-at-Generate backstop knew both. Nothing
recorded that the constraints are Colab-scoped by _intent_: the CLI deliberately does not
enforce either, because `protspace prepare --backend local -e esm2_3b` is correct on real
hardware.

Reconciling #446 surfaced two more defects that a written contract would have caught:

- **The gate blocked hardware that works.** `esm2_3b` was refused on every Colab runtime,
  including the paid L4/A100 tiers where it fits, because the rule keyed on model identity
  and never asked what the runtime had (#448). Before #446 that path worked.
- **The remedy named a service that was down.** `prep-failure-routing` guarantees a
  Biocentral outage routes users into this notebook, where `auto` resolves to `local` on a
  GPU runtime — and the panel answered by telling them to use Biocentral (#449). The same
  flow strands users more broadly: a free Colab runtime is CPU-only unless a GPU is
  attached, so `auto` falls back to the very service that just failed.

## What Changes

- **Adds** the `embedding-backend-selection` capability, covering backend resolution, the
  two compatibility rules, the runtime-capacity condition on the size rule, the Colab-only
  scope of the gating, and the fallback disclosure.
- **Makes the size rule capacity-conditional** rather than absolute — it applies only when
  the runtime cannot hold the model, so paid Colab tiers stop being blocked (#448).
- **Discloses the `auto` fallback** when it resolves away from a GPU, so a user routed to
  Colab by a Biocentral outage is told how to become independent of Biocentral rather than
  being silently handed back to it (#449).

## Impact

- Affected specs: `embedding-backend-selection` (new). No existing capability changes;
  `prep-failure-routing` keeps its requirements, and this capability makes the notebook end
  of that route coherent with them.
- Affected code: `apps/protspace/notebooks/ProtSpace_Preparation.ipynb` (panel gating,
  capacity probe, fallback disclosure, troubleshooting),
  `apps/protspace/src/protspace/data/embedding/local.py` (`COLAB_OVERSIZED` and its
  warning), `apps/protspace/src/protspace/data/embedding/biocentral.py`
  (`BIOCENTRAL_INVALID`, which was a bare notebook literal that nothing pinned),
  `apps/protspace/tests/test_local_embedder.py` (each blocked set pinned to the registry
  it constrains), `apps/protspace/tests/test_notebooks.py` (the notebook's
  `except ImportError` fallback pinned to the package constants, read structurally off
  the guarded import so a missing or emptied fallback fails rather than matching
  nothing), and `apps/protspace/CLAUDE.md`.
- A cleanup pass after the first review collapsed the gating duplication into one
  `_embedders_and_backend()` helper — the select/resolve/drop/bail block had been written
  out in both the query and fasta branches, with only the query copy moved ahead of the
  fetch — and reduced the per-backend table's values from `(blocked, why, remedy)` to
  `(blocked, note)`. The requirements below are unchanged by it, and the "one declaration
  drives both" requirement is more literally true after it.
- No CLI behaviour changes. The constraints stay advisory outside the notebook by design.
- The notebook imports both declarations behind a tolerant fallback: it is served from
  `main` but installs the _released_ package, so a name added alongside a notebook change
  is not there on first run — and its `ImportError` handler otherwise stops the whole panel.
