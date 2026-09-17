# Design

## Why the constraints are Colab-scoped

Both rules describe an _environment_, not the package:

- Biocentral's ESM-C defect is remote and temporary. The CLI cannot fix it, and pretending
  the shortcut does not exist would be wrong the day Biocentral is fixed.
- `esm2_3b`'s size is a property of the runtime, not of protspace. On real hardware
  `protspace prepare --backend local -e esm2_3b` is correct and should stay so.

So enforcement lives in the notebook, and the package holds only the _fact_ (which
checkpoints are large) plus an advisory warning. This is why the spec requires the CLI to
keep accepting both combinations.

## Which resource the size rule keys on

`esm2_3b` publishes no safetensors — only `pytorch_model-00001-of-00002.bin` (9.98 GB) plus
`-00002-` (1.39 GB) = **11.37 GB**, and `setup_model` passes no dtype for ESM, so it loads
fp32. `from_pretrained` materialises that on the **host** before `model.to(device)`.

Against the free tier's 12.7 GB of RAM that is the binding constraint, and it is the worst
possible failure: a host-RAM blowout kills the kernel with no traceback, taking the uploaded
FASTA or just-fetched UniProt sequences with it. `setup_model` also sits _outside_ the
`torch.cuda.OutOfMemoryError` backoff, which only wraps `_embed_batch`, so nothing recovers.

VRAM is the wrong axis to probe:

- It does not discriminate. On a high-RAM T4 the model fits VRAM but the host load is what
  decides, and every paid tier that clears the RAM bar also clears the VRAM bar.
- A CUDA OOM at load _raises_, so it is the survivable failure. Trading a recoverable
  exception for a kernel kill is the wrong way round.
- `torch.cuda.get_device_properties()` forces a CUDA context at panel-render time, on the
  budget the gate exists to protect. `torch.cuda.is_available()` does not.

Host RAM is readable from stdlib (`os.sysconf`), costs nothing, and separates the tiers
cleanly: free is 12.7 GB, every paid runtime is 51 GB or more. The threshold sits between
them with room on both sides rather than being fitted to one model.

## Why the set stays identity-keyed

The spec requires a _declared_ set rather than a computed size estimate. `esm2_3b` is
10.59 GiB of weights; the runner-up (`ankh_large` / `ankh3_large`, encoder-only once
`T5EncoderModel` drops the decoder) is 4.29 GiB. Nothing sits between them, so a threshold
anywhere in that gap selects the same one model — there is no boundary to tune, and a
per-model GB column would be the same hand-maintained table carrying numbers that rot
silently across a `transformers` minor bump.

The identity set answers "which models are worth checking"; the capacity probe answers
"can this runtime take one". Keeping those separate is what lets the package own the first
without claiming anything about the second.

## One table, both directions

The two rules are complementary — `esmc_*` is local-only, `esm2_3b` is Biocentral-only when
the runtime is small — so they are expressed as one map from effective backend to
(blocked set, note) and read by both the checkbox gating and the drop-at-Generate
backstop. Before #446 those were separate code paths and had already diverged.

The remedy is a whole phrase rather than "the other backend's name" because for `esm2_3b`
the other backend is not always the answer: during the Biocentral outage that routes users
here it is down, and on a large runtime the model simply works.

## Disclosing the fallback

`auto` is the default and resolves to `biocentral` whenever CUDA is absent — which is the
default state of a free Colab runtime. A user arriving from a Biocentral outage therefore
gets handed back to the failed service unless they know to attach a GPU. The spec requires
that resolution be _visible_, and that the panel say how to change it, rather than adding
another silent fallback.

## Alternatives considered

- **Enforce in the CLI too.** Rejected: it would break correct use on real hardware, and
  the CLI cannot know what a Colab runtime has.
- **Load ESM in fp16 on GPU.** Would halve `esm2_3b` to 5.29 GiB and let the size rule be
  deleted rather than conditioned. Deferred (#448): it changes numerics for every `esm2_*`
  and `esmc_*` key, so it needs the local↔Biocentral parity cross-check re-run and
  `apps/protspace/CLAUDE.md` updated — `esm2_3b` was never in that cross-check.
- **Probe VRAM as well as host RAM.** Rejected above; it adds a CUDA context for a check
  that changes no outcome on any current Colab tier.
