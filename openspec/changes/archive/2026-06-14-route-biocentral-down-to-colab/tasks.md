## 1. Backend classification

- [x] 1.1 Add `"no healthy biocentral"` to `_BIOCENTRAL_DOWN_PATTERNS` in `services/protspace-prep/src/protspace_prep/pipeline.py`
- [x] 1.2 Add a test in `services/protspace-prep/tests/test_pipeline.py` mirroring `test_embed_failure_with_connection_refused_is_classified_as_biocentral_unavailable`, with `fail_stderr=[b"TimeoutError: No healthy biocentral service became available in time\n"]`, asserting `code == "BIOCENTRAL_UNAVAILABLE"`
- [x] 1.3 Run the prep test suite and confirm the new test passes and `test_embed_failure_with_unrelated_error_passes_through` still passes

## 2. Frontend notification primitive

- [x] 2.1 Extend `NotifyOptions` in `app/src/lib/notify.ts` with `action?: { label: string; href: string }`
- [x] 2.2 In `emitNotification`, when `action` is present, pass Sonner `action: { label, onClick }`; `onClick` opens `href` — `mailto:` via `window.location.href`, otherwise `window.open(href, '_blank', 'noopener,noreferrer')`
- [x] 2.3 In `app/src/lib/notify.test.ts`, assert `action` is forwarded to the Sonner `toast` mock as `{ label, onClick }`, and that omitting `action` produces no action control

## 3. Shared Colab constant

- [x] 3.1 Add `export const COLAB_NOTEBOOK_URL = 'https://colab.research.google.com/github/tsenoner/protspace/blob/main/notebooks/ProtSpace_Preparation.ipynb';` to `app/src/explore/fasta-prep-limits.ts`
- [x] 3.2 Replace the hardcoded Colab URL in `app/src/explore/runtime.ts` (the `colabNote.href`) with the imported `COLAB_NOTEBOOK_URL`

## 4. Frontend failure routing

- [x] 4.1 Update `FASTA_PREP_CODE_MESSAGES.BIOCENTRAL_UNAVAILABLE` in `app/src/explore/notifications.ts` to name the outage and point to Google Colab
- [x] 4.2 In `getDataLoadFailureNotification`, when `code === 'BIOCENTRAL_UNAVAILABLE'`, attach `action: { label: 'Open in Colab ↗', href: COLAB_NOTEBOOK_URL }`, leaving the non-Biocentral path untouched (the support-mailto "Report this" `else` arm is not added here)
- [x] 4.3 In `app/src/explore/notifications.test.ts`, assert a `BIOCENTRAL_UNAVAILABLE` `FastaPrepError` yields Colab-pointing copy plus `action: { label: 'Open in Colab ↗', href: COLAB_NOTEBOOK_URL }`

## 5. Verification

- [x] 5.1 Run the frontend unit tests (`notify`, `notifications`) and confirm green
- [x] 5.2 Run lint/typecheck on the touched `app/src` files
- [x] 5.3 Confirm the change does not redefine `NotifyOptions.action` in a way that conflicts with the `feat/contac_link` support-mailto design (identical shape + mailto/http handling)
