## Why

Biocentral's public server now runs v2.0.1. The `biocentral-api` 1.2.1 client we pin only
accepts v1 servers (it checks `1.0.0 <= major < 2.0.0`), so it never calls the server
healthy, waits 30 seconds, and raises `TimeoutError: No healthy biocentral service became
available in time` — the same words as a real outage. Every Biocentral embedding and every
Biocentral annotation prediction fails, the hosted prep service tells users the embedding
service is down, and a user hit it as a bare traceback. The next server major bump would
fail the same way, and just as misleadingly.

## What Changes

- Require `biocentral-api>=2.0.0,<3` (the client for v2 servers) and relock. The cap holds
  `pip` users on the major we tested: the client's major tracks the server's, and a major is
  where its API changes. This one renames `CommonEmbedder.ESM_8M` to `ESM2_8M`, which would
  crash `import protspace.data.embedding.biocentral` and with it the offline backend that
  imports the package. The shortcut table now holds the model ids themselves instead of enum
  member names, so no later rename can.
- Add one shared wait-for-server helper, in a module of its own, for the three places that
  connect (embedding, the embedder probe, annotation predictions). When no healthy server
  turns up it looks at the server's `/health` once and says why: unreachable, or reachable
  but running a major version this client does not support — naming both versions and the
  upgrade to run.
- Keep the words `No healthy Biocentral service` in every such message, so the prep
  service keeps routing the failure to `BIOCENTRAL_UNAVAILABLE` and the Colab hint.
- Raise the failure as a `ValueError` subclass, so `protspace embed` and `protspace prepare`
  print `ERROR: <message>` and exit 1 instead of a Rich traceback, and make a multi-model
  `embed` stop at the first such failure instead of waiting 30 s per model.
- Run the prep CI on `apps/protspace/**` and the root `pyproject.toml` too, so the test that
  pins the routing words runs on edits to either side.
- Document the failure, its fix, and the Python 3.14 + `pip` caveat in the CLI guide, and
  correct the stale Python badge (it says 3.10+; the package has required 3.12 for a while).

Unchanged, and re-verified against the live v2.0.1 server: embedding output (1024-d for
ProtT5), the prediction model names and value shapes, and the 7–5000 residue length limits
with their 422 wording. `requires-python` also stays `>=3.12`; see the design for why.

**BREAKING**: the package no longer talks to v1 Biocentral servers. That is the point, but
it means a self-hosted v1 server is out of reach of the pinned client.

## Capabilities

### New Capabilities

- `biocentral-connection`: how the package connects to the Biocentral server and what it
  reports when no usable server is found.

### Modified Capabilities

- `prep-failure-routing`: a Biocentral server the installed client cannot use (a
  major-version mismatch) is classified `BIOCENTRAL_UNAVAILABLE`, like an unreachable one.

## Impact

- Code: new `apps/protspace/src/protspace/data/biocentral_connection.py` (address, error
  class, helper); `.../data/embedding/biocentral.py` (use it, shortcut rename);
  `.../annotations/retrievers/biocentral_retriever.py` (use it).
  `cli/embed.py` stops at the first connection failure; `cli/prepare.py` already catches
  `ValueError`. `.github/workflows/prep-ci.yml` (path filter).
- Dependencies: `biocentral-api>=2.0.0,<3` pulls in `biotrainer-core` (numpy `>=2.4.1`, which the
  lock already satisfies at 2.4.6) and `ruamel.yaml`; the root `uv.lock` is regenerated.
- Release: a `fix:` under `apps/protspace/` makes semantic-release cut a patch version for
  `pip` users. The hosted `protspace-prep` image does not come from PyPI: it is built from
  the workspace source and the root lock, so `publish-images.yml` rebuilds it on merge.
- Docs: `docs/guide/python-cli.md`; `apps/protspace/README.md` (Python badge).
  The Colab notebooks import from the package and restate nothing that changes.
