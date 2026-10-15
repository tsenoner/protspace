## 1. Spec

- [x] 1.1 Modify "A capability reduction SHALL reach the user, not only the console" so that a runtime gamma loss is reported and a context that never had the float extensions is not.

## 2. Tests

- [x] 2.1 Reword the missing-extensions gamma test as intended behaviour: no `gamma-pipeline-unavailable` at init, `density-unavailable` only when contours are requested.
- [x] 2.2 A runtime loss (incomplete framebuffer at init, gamma shader init failure) reports `gamma-pipeline-unavailable` exactly once. Verified by temporarily removing `reportDegraded` from `handleGammaFallback`: the test fails, then passes once restored.
- [x] 2.3 `pnpm test:ci`, `pnpm format:check` and `openspec validate --specs --strict` are clean.
