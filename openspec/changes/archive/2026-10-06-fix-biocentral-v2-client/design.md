## Context

`biocentral-api` is the client for Biocentral's public server, and its major version tracks
the server's: 1.x speaks to v1 servers, 2.x to v2. Each release hard-codes the window it
accepts (`MIN_API_VERSION` / `MAX_API_VERSION`, 1.2.1: `1.0.0`–`2.0.0`; 2.0.0: `2.0.0`–`3.0.0`),
so the two are mutually exclusive. The server moved to v2.0.1 while we pinned `>=1.2.1`.

The client reports a server outside its window exactly as it reports a dead one: its
`wait_until_healthy` polls for 30 seconds and raises `TimeoutError("No healthy biocentral
service became available in time")`. Three places connect this way — `embed_sequences`,
`probe_embedder` and the annotation retriever — and each lets that error through. The CLI
catches only `FileNotFoundError` and `ValueError`, so the user gets a Rich traceback; the
prep service matches `no healthy biocentral` and tells the user the service is down.

Checked against the live v2.0.1 server with a scratch install of `biocentral-api` 2.0.0:
embedding (ProtT5, 1024-d float32), prediction (model names `LightAttentionSubcellularLocalization`,
`LightAttentionMembrane`, `TMbed`; string values; topology letters `H h B b S i o`), the 7–5000
residue limits and the `X is too short` 422 wording are all as before. The only API break we
hit is `CommonEmbedder.ESM_8M` → `ESM2_8M`. Two facts that shaped the design: the server
rate-limits (a fourth request inside a minute waited 40 s and was retried by the client), and
the client's own major-version check compares the numbers as strings.

## Goals / Non-Goals

**Goals:**

- Embedding and annotation work against the v2 server again.
- When no usable server is found, say which of "unreachable" and "version mismatch" it is, with
  both versions and the remedy, so the next major bump costs one read of the error.
- Keep the failure routed as `BIOCENTRAL_UNAVAILABLE` in the prep service, and out of
  traceback territory in the CLI.
- Keep a future client release from reaching users untested (the `<3` cap), and a renamed
  client enum member from breaking an import.

**Non-Goals:**

- Detecting a server major bump before a user does (a scheduled canary). Worth having; a
  separate change, since it needs a workflow and an owner for its alerts.
- Handling the v2 server's rate limit, or batching differently. Not changed by v2 as far as
  we measured, and not what broke.
- Replacing `biocentral-api` with our own HTTP client.

## Decisions

**1. Bump the client and cap it at the next major.** `biocentral-api>=2.0.0,<3`. The lock
only governs CI and the prep image; a `pip` user gets whatever client resolves on the day
they install. The client's major tracks the server's, and a major is where its API changes —
`ESM_8M` → `ESM2_8M` is the proof — so the cap keeps users on the major we tested, and moving
it is a deliberate bump that CI runs against the new client. When the server moves on, the
2.x client refuses it anyway, and decision 3 makes that refusal legible.
_Alternative — no cap:_ rejected. A new client release would reach users with no CI run in
between, and an API change like the rename crashes every Biocentral run at import.
_Alternative — patch the 1.2.1 client's `MIN/MAX_API_VERSION` at runtime:_ rejected, it
overrides the client's own safety check on a guess that the v2 wire format is unchanged.
_Alternative — our own minimal client for the two endpoints we use:_ rejected for now. It
would drop the Python-cap problem below and the `biotrainer-core` dependency, but we would
then own the task-polling protocol and the HDF5 payload decoding. Revisit if the client's
version window keeps costing us releases.

**2. Diagnose after the timeout rather than probing first.** `wait_for_server(api)` calls the
client's `wait_until_healthy(max_wait_seconds=30)` and, only when that raises `TimeoutError`,
makes one `GET {url}/health` (5 s timeout) to find out why. A happy-path connection costs
nothing extra. _Alternative — probe first and fail at once on a mismatch:_ rejected; it adds a
request to every connection and a second way to fail, to save 30 seconds in a rare, permanent
condition.

**3. The message keeps the old words and adds the reason.** It begins `No healthy Biocentral
service became available in time` — the pattern `_BIOCENTRAL_DOWN_PATTERNS` and the
`prep-failure-routing` spec already match — followed by the reason. The server did not answer,
or answered with an HTTP error status (the underlying error, which also carries the
`connection refused` / `name resolution` / `503 Server Error` text the other patterns look
for), or answered without a readable version. Or it runs a major outside the client's window
(server version, client version, window, remedy). Or it reports a supported version but did
not pass the health check in time. The remedy depends on direction: a newer server needs
`pip install -U protspace`; an older one gets no upgrade advice, since upgrading cannot help.
The message carries no Python-version caveat: only a release that already requires 3.12 can
print it, so its reader is compliant by construction, and the installer caveats live in the
CLI guide, where they can be edited. Majors are compared as integers; the client's own string
comparison puts `10` before `2`. The window comes from `MIN_API_VERSION` / `MAX_API_VERSION`
on the client the helper is handed, and the client's version from `importlib.metadata`. (The
first version read the window from the client module at import. The retriever's tests import
the helper lazily while `biocentral_api.BiocentralAPI` is swapped for a fake, so 15 of them
failed whenever that file ran on its own, and only a full run hid it.)

**4. `BiocentralUnavailableError(ValueError)`, and the helper takes the client.** The
`embed-completeness` spec already settles that a stage failure is a `ValueError`, which
`cli/embed.py` and `cli/prepare.py` catch to print `ERROR: <message>` and exit 1; a
`RuntimeError` or `TimeoutError` would escape as a traceback. `embed` carries on after a
per-model `ValueError`, which is right for per-model failures and wrong here: every model goes
to the same server, so a multi-model run waited out the same 30 s once per model, six minutes
for the documented 12, against one wait before this change. `embed` therefore catches
`BiocentralUnavailableError` first, reports it once and exits 1; `prepare` already stops at the
first failure. The helper takes the already-built client instead of building it, because the
existing tests replace `biocentral.BiocentralAPI` (embedding) and
`biocentral_api.BiocentralAPI` (retriever) and both seams must keep working. The server
address becomes one constant, `BIOCENTRAL_URL`, used by all three sites.

**5. The helper gets a module of its own, outside `data/embedding/`.** Putting it in
`embedding/biocentral.py` would make annotation import the embedding package just to reach a
connection helper, and `data/embedding/__init__.py` imports that module eagerly, so nothing
placed beside it is light. `data/biocentral_connection.py` depends only on `requests` and the
standard library and imports nothing from the client, so a change to the client cannot break
its import. Both sides import it at module level.

**6. The shortcut table holds model ids, not enum member names.** `MODEL_SHORT_KEYS` named
`CommonEmbedder` members and resolved them at import. 2.0 renamed one (`ESM_8M`), and since
`data/embedding/__init__.py` imports `biocentral.py` eagerly, a renamed member would also have
broken importing the offline backend, which has nothing to do with Biocentral. The client's
enum is generated from the server's spec, so the `<3` cap does not promise its names. The five
entries now hold the ids directly, as `EXTRA_SHORT_KEYS` already did for seven models through
the same `embed(embedder_name=<str>)` call. The ids are the values the members held, so
resolved ids, cache paths and the HDF5 identity stamp are unchanged. A typed member name
(`-e ProtT5`) was never served by this table but by `resolve_embedder`'s own call-time
branch, so that input is unaffected. One test pins the ids to the ones the client lists, a
check that can now fail on its own, and another that a renamed member cannot break
resolution. `MODEL_SHORT_KEYS` is re-exported from `protspace.data.embedding`, so its values
changing from member names to ids is visible to out-of-repo callers; none is known.

**7. `requires-python` stays `>=3.12`.** `biocentral-api` 2.x declares `<3.14`, but it
imports and reports the live server healthy on Python 3.14.8. `uv` ignores that upper
bound: `uv lock` produces one `biocentral-api` entry for every interpreter, and
`uv sync --locked`, the command the CI 3.14 leg runs, installs it there (checked locally on
3.14.8). Stock `pip` honours it, so on 3.14 `pip install protspace` cannot satisfy
`biocentral-api>=2.0.0` and falls back to an older protspace. Capping our own
`requires-python` would drop 3.14 from the supported range and break `uv`'s interpreter
selection in that CI leg, while leaving `pip` users on the same old release. So the range
stays, the CLI guide says what 3.14 `pip` users see, and upstream is asked to widen the cap.

## Risks / Trade-offs

- [`pip` on Python 3.14 resolves to an older protspace, without failing] → documented in the CLI guide with
  the `uv` and 3.12/3.13 routes; upstream asked to widen `Requires-Python`. `uv` users, the
  lock and CI are unaffected.
- [A mismatch takes the full 30 s wait to report] → accepted (decision 2); the message is
  immediate once it comes, and the condition is permanent, not intermittent.
- [A v3 server breaks us again] → the 2.x client refuses it and the cap keeps users on 2.x,
  so the failure is the diagnosed one: a single line naming both versions, classified as
  unavailable rather than mistaken for an outage, fixed by one deliberate bump. Not detected
  ahead of users until the canary exists.
- [`biotrainer-core` raises the numpy floor to 2.4.1] → the lock already holds numpy 2.4.6,
  and the Colab notebook already tells users to restart after the install upgrades numpy.
- [Importing the 2.x client costs about 0.65 s where torch is installed, against 0.2 s] →
  `biotrainer-core` imports torch when it is present, and `prepare` and `embed` pay it through
  `data/embedding`'s eager imports. Measured in review and not fixed here: the fix is lazy
  imports in the embedding package, a structural change of its own. A plain
  `pip install protspace` and the prep image have no torch and pay about 10 ms.
- [The v2 server rate-limits] → not caused or fixed here. Large annotation runs send
  sequential batches, so one that hits the limit is slower, not broken.

## Migration Plan

Merging to `main` touches `apps/protspace/**` and `uv.lock`, so `publish-images.yml` rebuilds
the `protspace-prep` image from source and the lock, and the deploy repo picks it up by
digest. The `fix:` commit makes semantic-release cut a patch version on PyPI for `pip` users.
Rollback is a revert, which restores a client the server rejects.

## Open Questions

- Should a scheduled job compare the live server's major with the installed client's window
  and fail before a user reports it? Proposed, not part of this change.
- Upstream `biocentral-api` has not widened `Requires-Python` to 3.14; worth an issue there.
