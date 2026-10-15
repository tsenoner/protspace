## 1. Regression Coverage

- [x] 1.1 Cover the reported case: `ted` matches `ted_domains` and none of `predicted_*`.
- [x] 1.2 Cover that `predicted`, `membrane`, `cellular` and `loc` still match.
- [x] 1.3 Make both pickers filter through one shared function, and test that function.

## 2. Implementation

- [x] 2.1 Add `annotationMatchesQuery` beside the other per-column helpers in `packages/utils`.
- [x] 2.2 Call it from the annotation dropdown.
- [x] 2.3 Call it from the query builder's annotation picker, which matched no labels before.

## 3. Verification

- [x] 3.1 Run the affected package tests and the `pnpm precommit` gate.
- [x] 3.2 Confirm the reported case in the running app.
- [x] 3.3 Archive this change before the merge.
