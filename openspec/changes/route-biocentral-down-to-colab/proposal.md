## Why

Biocentral, the embedding backend, is routinely unavailable. When it is, the
embedding step fails with a timeout the pipeline does not recognise, so users see
a generic "embedding step failed, please try again" toast and keep retrying a
doomed job instead of being sent to the working Google Colab notebook.

## What Changes

- Recognise the Biocentral outage timeout (`No healthy biocentral service became
available in time`) as a Biocentral-down failure so it is tagged
  `BIOCENTRAL_UNAVAILABLE` (today only connection-refused / DNS / 503 are
  matched).
- Rewrite the `BIOCENTRAL_UNAVAILABLE` frontend toast copy to name the outage and
  direct the user to Colab.
- Add a clickable **"Open in Colab ↗"** action to that toast via a new optional
  `action` field on the notification primitive (shape shared with the pending
  support-mailto work; this change implements it first).
- For the `BIOCENTRAL_UNAVAILABLE` toast, the single action slot is the Colab
  link (a known, routine outage is not a user-reportable bug).
- Extract the Colab notebook URL into a shared constant (currently hardcoded in
  `runtime.ts`).

## Capabilities

### New Capabilities

- `prep-failure-routing`: How FASTA-preparation failures are classified on the
  backend and surfaced to the user, including routing a Biocentral-unavailable
  failure to the Google Colab notebook.

### Modified Capabilities

<!-- None: prep-observability covers structured logging, not failure routing. -->

## Impact

- Backend: `services/protspace-prep/src/protspace_prep/pipeline.py`
  (`_BIOCENTRAL_DOWN_PATTERNS`).
- Frontend: `app/src/lib/notify.ts` (new `action` field),
  `app/src/explore/notifications.ts` (copy + Colab action),
  `app/src/explore/fasta-prep-limits.ts` (new `COLAB_NOTEBOOK_URL`),
  `app/src/explore/runtime.ts` (use the constant).
- Coordination: overlaps the `feat/contac_link` support-mailto design on
  `notify.ts` and `notifications.ts`; this change implements the shared `action`
  primitive first and owns the Biocentral arm of the failure toast.
- No API, dependency, or schema changes.
