## Context

`handleGammaFallback(reason)` is the only path that reports `gamma-pipeline-unavailable`. It returns early when `gammaPipelineAvailable` is already false. `ensureGL` clears that flag before it calls `handleGammaFallback('required extensions missing')`, so the missing-extensions path never warns and never reports. Every other caller (gamma shader init failure, incomplete framebuffer at init, resize failure, loss during render) reaches it with the flag still true and reports once.

## Decisions

- **Amend the spec, not the code.** The behaviour is already the right one. The early return also stops a second fallback from deleting resources twice, so the guard stays. The missing-extensions call does nothing. It is left in place because it names the reason at the call site.
- **Report the consequence, not the capability.** On a context without float extensions, nothing visible changes unless the user asks for contours, and `density-unavailable` already covers that request with the name of the missing extension (`density-contours`, "An unavailable layer SHALL be reported to the user once").
- **Pin both halves.** One test asserts that an init without the extensions emits no gamma notice and emits `density-unavailable` only when contours are on. Another asserts that a runtime loss reports `gamma-pipeline-unavailable` exactly once. The second test fails if `reportDegraded` is removed from `handleGammaFallback`.

## Alternatives rejected

- **Report the gamma notice on missing extensions too.** Every iOS visitor would see a warning they cannot act on, and with contours on they would see two notices for one cause.
