## Context

`local.py` maps each short key to `(checkpoint, family)`. The `esmc` family is the only one that
needs third-party modeling code: `Synthyra/ESMplusplus_*` is loaded with
`AutoModelForMaskedLM.from_pretrained(..., trust_remote_code=True)`, its tokenizer hangs off the
model (`model.tokenizer`), that tokenizer rejects `truncation` / `max_length` /
`add_special_tokens`, and the tokenizer↔model reference cycle needs a `gc.collect()` before
`torch.cuda.empty_cache()` frees the GPU. The Colab Embeddings notebook (PR #554) already loads
`biohub/ESMC-*` through transformers' native `esmc` model.

Each `.h5` the local backend writes is stamped `backend=local, model=<short key>` (see
`data/embedding/store.py`), and a resume refuses a file stamped by another producer. The stamp
names the short key, not the checkpoint, so swapping the checkpoint behind `esmc_300m` keeps
existing files resumable. That is only correct if the new vectors are the same as the old ones.

## Goals / Non-Goals

**Goals:**

- Load ESM-C from the official `biohub/ESMC-300M` / `-600M` repos with `AutoModel` /
  `AutoTokenizer`, no remote code.
- Treat ESM-C like every other family in tokenization.
- Keep vectors equal to the ESM++ ones, so caches and the producer contract stay valid.

**Non-Goals:**

- The Biocentral backend's ESM-C ids and its server-side bug (it loads ESM++ as ESM-2).
- The `esm` SDK or ESM3.
- Changing pooling, the `max_length` cap or batch handling.

## Decisions

**Checkpoint ids.** `esmc_300m` → `biohub/ESMC-300M`, `esmc_600m` → `biohub/ESMC-600M`, family
`esmc`. The family keeps `_STRIP_BOTH_ENDS`: the native tokenizer wraps each sequence in `<cls>` …
`<eos>`, as ESM++'s did.

**Loading.** `AutoModel.from_pretrained(checkpoint)` resolves to `EsmcModel` (encoder only, no LM
head), whose `last_hidden_state` is what `_embed_batch` pools. This replaces
`AutoModelForMaskedLM` + `trust_remote_code`. `AutoTokenizer` gives the native `EsmcTokenizer`
(fast). The `esm` branch could not be reused: it constructs `EsmModel` (ESM-2) explicitly.

**One tokenizer call.** The native tokenizer accepts the full signature, so the `esmc` special case
in `_embed_batch` goes. Truncation to `max_length + 2` is then applied to ESM-C too; it never
fires, because sequences longer than `max_length` are skipped before tokenization.

**`gc.collect()` stays.** Its comment blamed Synthyra's tokenizer↔model cycle, so it looked
removable. Measured with gc disabled: after `setup_model`, `del` frees neither the native ESM-C
model nor its tokenizer (nor the ESM-2 model); `gc.collect()` frees all of them. Without it
`empty_cache` would run while the weights are still referenced. Only the comment changes.

**transformers floor 5.16.0.** `models/esmc` first appears in the 5.16.0 wheel (2026-08-26);
5.15.1 does not have it. Later releases only refactor the rotary embedding and set
`base_model_prefix` on one head class; the floor is verified on real weights, not assumed.

**No producer change.** Measured on real weights through `embed_sequences` (451 proteins: Pla2g2's
448, 108 with rare residues, plus 624, 1126 and 1705 aa concatenations), Synthyra on the old lock
(transformers 5.13.1) against the new code on 5.16.0 and 5.21.0:

| Model | transformers | Cosine (min) | Relative L2 (max / mean) | Max abs diff |
| ----- | ------------ | ------------ | ------------------------ | ------------ |
| 300M  | 5.16.0       | 1.00000000   | 1.6e-6 / 1.2e-7          | 5.9e-7       |
| 300M  | 5.21.0       | 1.00000000   | 1.6e-6 / 1.2e-7          | 5.9e-7       |
| 300M  | 5.21.0, bs 1 | 1.00000000   | 1.6e-6 / 1.7e-7          | 5.9e-7       |
| 600M  | 5.16.0       | 1.00000000   | 2.9e-6 / 6.3e-7          | 1.4e-6       |
| 600M  | 5.21.0       | 1.00000000   | 2.9e-6 / 6.3e-7          | 1.4e-6       |

That is float32 noise, so an old vector and a new one are interchangeable, and the `esmc_*` stamp
keeps meaning one model. A Synthyra-written `.h5` with 10 proteins removed resumed under the new
code: 441 kept, 10 embedded, all equal to the reference. Had the vectors differed, the stamp would
have needed a new model key so old and new vectors could not mix in one file.

## Risks / Trade-offs

- [Users pinned below 5.16 get transformers upgraded by `protspace[local]`] → The floor is the
  minimum that works; Colab's snapshot is checked to still resolve
  (`PROTSPACE_COLAB_RESOLVE=1 tests/test_colab_compat.py`).
- [A future transformers release changes `esmc` numerics] → The same risk applies to every family;
  the parity numbers are recorded in the PR for reference.
- [Hugging Face cache] → Users who embedded ESM-C before download ~1.2 GB / ~2.3 GB again for the
  new repos. One-time, and the Colab Embeddings notebook already uses the same repos.

## Migration Plan

None. Existing `.h5` files resume unchanged; rollback is reverting the commit.
