## 1. The spec

- [x] 1.1 Narrow "The live view has no atlas" to the device-limit case it was written for, so the
      scenario's condition again determines its outcome
- [x] 1.2 State the two cases `defer-label-atlas-allocation` created: a single-value annotation
      exports no atlas even when one is still allocated, and a multi-value annotation exports one
      even when none has been staged yet
- [x] 1.3 State the sourcing rule normatively — the WANT question comes from the styling authority
      the export stages its colours through, not from the last completed render's allocation

## 2. Confirm the code already matches

- [x] 2.1 `exportLabelStride` asks the gate before reading `this.atlas`, so both windows resolve
      correctly and a live plan still caps the stride (shipped in the same PR)
- [x] 2.2 Both directions are pinned by tests in `webgl-renderer.export-transform.test.ts`: a
      multi-label view with no live plan forwards `MAX_LABELS`, a single-label view forwards `null`
- [x] 2.3 No code change in this change — verify by diff that only `openspec/` is touched

## 3. Ship

- [x] 3.1 `openspec validate --strict`
- [x] 3.2 `pnpm precommit`, `pnpm format:check`, `pnpm test:ci`
- [x] 3.3 Archive on the branch, so the living spec stops describing the pre-#457 world
