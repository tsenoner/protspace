## 1. Live checks

- [x] 1.1 Add `apps/protspace/tests/test_biocentral_live.py`, skipped unless `PROTSPACE_LIVE_BIOCENTRAL=1`: usable server, embedding through the package, annotation predictions through the package
- [x] 1.2 Confirm the file is collected and skipped in a normal run, and passes against the live server with the flag set

## 2. Workflow

- [x] 2.1 Add `.github/workflows/biocentral-canary.yml`: daily schedule, `workflow_dispatch`, and a pull request path filter on the workflow and the test file
- [x] 2.2 Run it once on this PR and read the result

## 3. Docs

- [x] 3.1 Note the canary in `apps/protspace/CLAUDE.md` (connection bullet and test table)
