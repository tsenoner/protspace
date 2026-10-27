## Why

The Embeddings notebook kept an optional Hugging Face token field and its own login code. No model
it offers needs a login any more (ESM C and ESM3 moved to Biohub, MIT and ungated), and
huggingface_hub already reads a Colab secret named `HF_TOKEN` by itself, so the field duplicated
what Colab does.

## What Changes

- The token field and the notebook's login code go. A gated or private model's failure message says
  to add the token as the Colab secret `HF_TOKEN`.

## Capabilities

### Modified Capabilities

- `notebook-embedding-generation`

## Impact

`ClickThrough_GenerateEmbeddings.ipynb` and one test.
