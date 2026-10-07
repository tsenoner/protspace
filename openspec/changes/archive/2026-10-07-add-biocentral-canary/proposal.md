## Why

Biocentral's v2 server broke every released `biocentral-api` 1.x client at once, with no notice. The first anyone knew was a user's bug report while the hosted FASTA upload was down, and the fix (#516) only reports the next mismatch clearly; it does not find it. Every other test mocks the server, so nothing in CI can notice that the live server and the client protspace ships have stopped agreeing.

## What Changes

- A daily workflow, `biocentral-canary.yml`, runs `apps/protspace/tests/test_biocentral_live.py` against the live server with the client the lock pins (the one CI and the prep image use). It also runs on a pull request that edits either file, and on demand.
- The live tests check three things with small requests: the server's major is one the locked client accepts, one embedding returns finite 1024-d vectors for each of two proteins, and one annotation prediction returns a non-empty value for every Biocentral column (a renamed model leaves the columns empty without an error).
- The tests skip unless `PROTSPACE_LIVE_BIOCENTRAL=1`, which only the workflow sets, so the normal suite never touches the shared server. An unreachable server skips instead of failing.
- Only the locked runtime dependencies and pytest are installed: the dev group pulls in torch and Jupyter, which would make a daily check slower than the check itself.

## Capabilities

### Modified Capabilities

- `biocentral-connection`: adds a requirement that a scheduled live check compares the server with the shipped client.

## Impact

- New `.github/workflows/biocentral-canary.yml` and `apps/protspace/tests/test_biocentral_live.py`. No production code changes.
- Three requests a day to the shared Biocentral server (one embedding, one prediction, one health check), plus one run per edit to the two files.
- A failed scheduled run emails the workflow's last editor. Red means act: bump the `biocentral-api` cap deliberately and run the whole suite against the new client.
