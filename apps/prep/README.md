# protspace-prep

FASTA → `.parquetbundle` HTTP service for ProtSpace. See
[`docs/superpowers/specs/2026-05-05-fasta-prep-backend-design.md`](../../docs/superpowers/specs/2026-05-05-fasta-prep-backend-design.md)
for the design.

## Run locally

`protspace-prep` is a uv workspace member, so every command below runs from the
repo root. Keep `--package protspace-prep` on `uv run` too: the workspace root is
virtual, so a bare `uv run` resolves _all_ members and pulls in ~135 extra
packages (torch, jupyter) that this service does not use.

From the repo root:

```bash
uv sync --package protspace-prep
uv run --package protspace-prep uvicorn protspace_prep.app:app --reload --port 8000
```

## Tests

From the repo root — the path is required, since the root has no pytest config
and a bare `pytest` collects the whole workspace:

```bash
uv run --package protspace-prep pytest apps/prep -q
```

## Build the Docker image

From the repo root — the build context is the workspace root, not `apps/prep`
(see the header of [`Dockerfile`](./Dockerfile)):

```bash
docker build -f apps/prep/Dockerfile -t protspace-prep:local .
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
