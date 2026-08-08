## 1. Regression Coverage

- [x] 1.1 Add a focused test that requires the preparation notebook's parameter groups to reserve at least 300 px before wrapping
- [x] 1.2 Run the focused test against the current 220 px basis and record the expected failure

## 2. Responsive Fix

- [x] 2.1 Increase only the parameter-group flex basis to the specified responsive minimum
- [x] 2.2 Rerun the focused test and record the passing result

## 3. Verification

- [x] 3.1 Reproduce the three-card notebook layout at desktop and compressed viewports and confirm usable slider tracks after wrapping
- [x] 3.2 Validate the OpenSpec change and run the repository-mandated `pnpm precommit` gate

## 4. Review Follow-up

- [x] 4.1 Add a regression assertion that a lone parameter group cannot shrink below the responsive reserve
- [x] 4.2 Set each parameter group's minimum width to the 300 px flex basis
- [x] 4.3 Run focused Python checks, validate the amended OpenSpec change, and rerun `pnpm precommit`
