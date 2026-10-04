## REMOVED Requirements

### Requirement: Readiness is gated on the interaction layer, not on host fields

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: Zoom and pan scenarios drive the real interaction path

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: A failing dataset SHALL NOT discard the run

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: Dataset loading waits SHALL be bounded by a shared budget

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: An abandoned load SHALL NOT contaminate the next dataset

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: An empty run SHALL NOT pass validation

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: The host-runner coupling SHALL be covered by a test

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: No overlay SHALL paint over the canvas during a measured window

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: The measured load window SHALL NOT carry reload-support persistence

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.

### Requirement: A run SHALL leave no server behind and SHALL NOT destroy earlier results

**Reason**: The WebGL render benchmark is removed; `perf-checks` replaces it.

**Migration**: Use `pnpm perf:counts` for the gate and `pnpm perf` for timings.
