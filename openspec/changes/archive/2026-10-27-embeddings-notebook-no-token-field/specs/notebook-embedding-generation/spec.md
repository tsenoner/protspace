## MODIFIED Requirements

### Requirement: The Embeddings notebook says what each step did and why one stopped

The Embeddings notebook SHALL print one line per stage (model and device, proteins, IDs, weights
with the time taken, the saved file) and SHALL stop with a message naming the cause and the fix for
a cancelled upload, a missing path, an unreadable FASTA, a FASTA without records, duplicate IDs, a
gated or unreachable model, and a missing package. A '/' in an ID SHALL become '\_' instead of
stopping the run.

#### Scenario: A private model without a token

- **WHEN** loading a model fails with an authorization error
- **THEN** the message says it is gated or private and to add the token as the Colab secret
  `HF_TOKEN`
