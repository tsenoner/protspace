## Decisions

1. **Skip on unreachable, fail on unusable.** The canary is about version drift, and an outage has its own status page (status.biocentral.cloud). A monitor that fails on every outage gets ignored. `wait_for_server` already tells the two apart; the test skips when its message says the server did not answer its health check and re-raises otherwise, so the failure carries both versions.
2. **Through the package, not around it.** The embedding and prediction checks call `embed_sequences` and `BiocentralPredictionRetriever`, so a server answer the package no longer reads fails the canary, not just a server the client refuses.
3. **Real proteins, real expectations.** Ubiquitin must predict `Soluble` and bacteriorhodopsin `Membrane` with an alpha-helical transmembrane call. These are textbook cases, so a model change that flips them is worth a look; the assertion on every column being non-empty is the one that catches a renamed model.
4. **Locked client, minimal install.** `uv sync --locked --no-dev`, then `uv run --no-sync --with pytest`. The workflow tests the client that ships, and does not resolve a newer one.
5. **Daily, off the hour.** `17 6 * * *` avoids the queue at :00. Two requests to a shared research server a day is well inside any limit; #518 asks Biocentral for their numbers.
