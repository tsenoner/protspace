# Tasks

## 1. Capacity-condition the size rule (#448)

- [x] 1.1 Add a host-memory probe to the notebook panel, using stdlib only (no CUDA context)
- [x] 1.2 Apply `COLAB_OVERSIZED` only when host memory is below the threshold, so paid
      Colab tiers stop being blocked
- [x] 1.3 Treat an unavailable or failing probe as "small runtime" (block), preferring a
      false block over a terminated kernel
- [x] 1.4 Update the remedy so the newly-actionable option (attach a larger runtime) is
      offered, and so it does not depend on Biocentral being reachable

## 2. Disclose the auto fallback (#449)

- [x] 2.1 Show, when `auto` resolves to Biocentral for want of a GPU, that this happened
- [x] 2.2 Name the action that changes it (Runtime → Change runtime type → GPU)
- [x] 2.3 Add the same hint to the generation-failure troubleshooting list, which is where
      a user lands when a Biocentral call fails inside the notebook

## 3. Keep the package declarative

- [x] 3.1 Keep `COLAB_OVERSIZED` a bare set in `local.py`, asserting nothing about any
      runtime's capacity
- [x] 3.2 Keep the package warning advisory — the CLI still accepts the combination

## 4. Verification

- [x] 4.1 Assert every blocked name resolves to a real embedder shortcut
- [x] 4.2 Exercise the gating at both capacity outcomes and both backends
- [x] 4.3 Confirm the notebook still runs against a released protspace that predates any
      newly added package symbol
- [x] 4.4 `pnpm precommit`, `uv run pytest -m "not slow"`, `openspec validate --all --strict`

## 5. Archive

- [x] 5.1 Tick this list, reread proposal/design against the final diff, then
      `/opsx:archive` as the last commit on the branch
- [x] 5.2 Replace the `TBD` Purpose the archive writes with a real one
