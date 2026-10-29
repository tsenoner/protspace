## Context

Both backends serve the same 12 shortcuts today, and three places pin that: `EMBEDDER_MODELS`
(the CLI's copy, kept off the Biocentral import path) equals `ALL_SHORT_KEYS`, every
`ALL_SHORT_KEYS` key resolves locally, and both backends name the same checkpoint. The Colab
panel blocks per backend: `BIOCENTRAL_INVALID` (empty since #558, removal planned in #559) and
`COLAB_OVERSIZED` (RAM-gated, local only).

`biohub/ESMC-6B`: `model_type: esmc`, hidden 2560, 80 layers, 25.4 GB of fp32 weights in six
shards, MIT, not gated. Biocentral accepts the id but fails the task.

## Goals / Non-Goals

**Goals:**

- `protspace embed/prepare --backend local -e esmc_6b` works and fits a 24–40 GB GPU.
- `--backend biocentral -e esmc_6b` fails at once with the remedy, not after a UniProt download
  or a server round trip.
- The panel offers `esmc_6b` only where it can run.

**Non-Goals:**

- Biocentral support. When the server computes it, the shortcut moves into `EXTRA_SHORT_KEYS`
  and stops being local-only.
- Half precision for the other models.

## Decisions

**Local-only, not `BIOCENTRAL_INVALID`.** `BIOCENTRAL_INVALID` means "the server answers, but
with the wrong model", a notebook-only rule the CLI deliberately ignores; #559 deletes it.
"Biocentral has no such model" is a fact about the package, and so the CLI enforces it. Listing
`esmc_6b` in `biocentral.py` would also make the CLI send a request that is known to fail.

**Where local-only lives.** `cli/common_options.py` gets `LOCAL_ONLY_EMBEDDERS =
frozenset({"esmc_6b"})` next to `EMBEDDER_MODELS`, for the same reason that list is copied there
(no Biocentral import at CLI startup). Tests pin both copies:
`set(EMBEDDER_MODELS) == set(LOCAL_CHECKPOINTS)`, and
`set(EMBEDDER_MODELS) - LOCAL_ONLY_EMBEDDERS == set(ALL_SHORT_KEYS)`.

**Refusal.** `prepare` and `embed` reject a local-only shortcut on the Biocentral backend as a
usage error, before any input is fetched. `biocentral.resolve_embedder` (used by `embed_fasta`,
the library path) also names `--backend local` for a key `LOCAL_CHECKPOINTS` has, instead of
"unknown shortcut".

**Notebook.** The panel blocks `ALL_EMBEDDERS - ALL_SHORT_KEYS` on the Biocentral backend, plus
`BIOCENTRAL_INVALID`. `ALL_SHORT_KEYS` is read in its own guarded import, falling back to
`ALL_EMBEDDERS` (nothing extra blocked). That fallback is correct for every release: a release
without the import also has no local-only shortcut. A new package constant would need a literal
fallback that differs from the package's value for one release, which the fallback test rejects.
The Biocentral note becomes generic ("Biocentral cannot serve this model"), because it now covers
both cases.

**Precision.** `setup_model` loads checkpoints in `_HALF_ON_GPU` (just `biohub/ESMC-6B`) with
`dtype=torch.bfloat16` when `torch.cuda.is_bf16_supported()`, else `torch.float16`, and fp32 on
CPU. bf16 is the training precision and has fp32's exponent range, so activations cannot
overflow. fp16 (T4, V100) is measured against fp32 before it is allowed (see the tasks). Half
precision halves the weights to about 12.7 GB, so an L4 (24 GB) or A100 holds them; in fp32 they
need 25.4 GB plus activations. Pooling already upcasts (`hidden.cpu().float()`).

**Oversized.** `esmc_6b` joins `COLAB_OVERSIZED`: even in half precision 12.7 GB exceeds free
Colab's 12.7 GB of host RAM. The warning text stops saying "fp32", which is no longer always true.

## Risks / Trade-offs

- [The half-precision vectors differ from fp32] → Measured on real weights (cosine, relative L2,
  finiteness, sequences up to the 2000-residue cap), and the numbers go in the PR. The `.h5`
  producer stamp stays `esmc_6b` for any dtype, as with the fp16 ProtT5 export.
- [Validation runs on a Mac, not on CUDA] → fp32 on CPU and bf16/fp16 on Apple MPS. Their kernels
  accumulate differently from CUDA's, so the numbers bound the dtype error, not the exact CUDA
  result. Measured on 11 proteins (33–1990 aa): bf16 cosine ≥ 0.99990, relative L2 ≤ 1.4e-2; fp16
  cosine ≥ 0.999999, relative L2 ≤ 1.4e-3; all finite. fp16 was closer, but bf16 stays preferred
  because it cannot overflow.
- [Biocentral fixes 6B later] → Move the key to `EXTRA_SHORT_KEYS` and drop it from
  `LOCAL_ONLY_EMBEDDERS`; the tests above then force the rest.
