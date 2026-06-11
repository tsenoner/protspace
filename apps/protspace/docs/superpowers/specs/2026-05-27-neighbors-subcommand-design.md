# Design: `protspace neighbors` — reproducible proximity mining

> **⚠️ Superseded (2026-06-11).** This early draft scoped a single `protspace neighbors`
> subcommand and defaulted to cosine distance. It has been replaced by
> [`2026-06-11-eat-annotation-transfer-design.md`](./2026-06-11-eat-annotation-transfer-design.md),
> which:
> - splits the work into a **`protlabel`** engine (the EAT lookup, per GitHub issue #54) +
>   a thin **`protspace transfer`** subcommand;
> - flips the default metric to **Euclidean** (canonical EAT) with cosine opt-in;
> - adopts the goPredSim **reliability index** as the confidence column;
> - specifies **storage** (reference lookup as a rebuildable sidecar, prediction overlay in the bundle),
>   **compute feasibility**, and the **frontend representation** (extending PR #272).
>
> Kept for history only. Read the 2026-06-11 spec instead.
