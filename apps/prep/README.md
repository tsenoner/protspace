# protspace-prep

FASTA → `.parquetbundle` HTTP service for ProtSpace. See
[`docs/superpowers/specs/2026-05-05-fasta-prep-backend-design.md`](../../docs/superpowers/specs/2026-05-05-fasta-prep-backend-design.md)
for the design.

## Run locally

`protspace-prep` is a member of the repo-root uv workspace, so run these from the
repo root. The `dev` dependency group installs by default — no extra flag needed.

```bash
uv sync --package protspace-prep
uv run uvicorn protspace_prep.app:app --reload --port 8000
```

## Tests

```bash
uv run pytest -q
```

## Build the Docker image

```bash
docker build -t protspace-prep:local .
```

## Configuration

All knobs are env vars; defaults match the MVP spec.

| Variable                        | Default                        | Meaning                                                                  |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `PREP_JOB_ROOT`                 | `/var/lib/protspace-prep/jobs` | Where job directories live.                                              |
| `PREP_MAX_CONCURRENT_JOBS`      | `5`                            | Active-job semaphore size.                                               |
| `PREP_BUNDLE_TTL_SECONDS`       | `3600`                         | Bundle deletion deadline.                                                |
| `PREP_UPLOAD_MAX_BYTES`         | `8388608`                      | Max FASTA upload size.                                                   |
| `PREP_SEQUENCE_MIN_COUNT`       | `20`                           | Min sequences per FASTA.                                                 |
| `PREP_SEQUENCE_MAX_COUNT`       | `1500`                         | Max sequences per FASTA.                                                 |
| `PREP_SEQUENCE_MAX_RESIDUES`    | `2000`                         | Max residues per sequence.                                               |
| `PREP_EMBEDDER`                 | `prot_t5`                      | Biocentral embedder model.                                               |
| `PREP_METHODS`                  | `pca2,umap2`                   | Projections to compute.                                                  |
| `PREP_ANNOTATIONS`              | `default`                      | Annotation group.                                                        |
| `PREP_PIPELINE_TIMEOUT_SECONDS` | `420`                          | Watchdog: kills the subprocess and surfaces a timeout error if exceeded. |

## Known limitations

- The `JobRegistry` is in-memory. A container restart loses live job state:
  job directories survive on the volume, but `_jobs` is empty, so `/bundle`
  returns 404 for pre-restart jobs until the sweeper reclaims the directories.
