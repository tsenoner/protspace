# CI secrets & settings to migrate: `protspace-legacy` → `protspace`

Operator runbook for the protspace release/publish pipeline now that it lives in
this monorepo (`apps/protspace`). The repo was renamed `protspace_web` →
**`protspace`**, and the old standalone repo was renamed → **`protspace-legacy`**
and archived. The web/prep pipeline already has its own secrets here — only the
items below need to move from the legacy repo.

## Repository secrets to create

Recreate these in `protspace` → Settings → Secrets and variables → Actions
(GitHub secret **values** are write-only, so they cannot be copied — set them
from the GitHub App's own credentials):

| Secret                    | Used by                 | Purpose                                                                                                                                                         |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELEASE_APP_ID`          | `protspace-release.yml` | GitHub App ID. python-semantic-release authenticates as this App to push the version-bump commit, tag, and GitHub Release, and to dispatch `protspace-publish`. |
| `RELEASE_APP_PRIVATE_KEY` | `protspace-release.yml` | Private key (PEM) for the same App.                                                                                                                             |

The GitHub App behind `RELEASE_APP_*` must be **installed on `protspace`**
with **Contents: read & write** (push commits/tags/releases and fire the
`repository_dispatch`). If it was installed only on the legacy repo, add the
`protspace` installation.

## GitHub Actions environment

`protspace-publish.yml`'s `pypi` job runs in environment **`pypi`**. This
environment now exists in `protspace` → Settings → Environments (created during
the rename; empty is fine — it scopes the OIDC trusted-publish and any future
protection rules).

## PyPI Trusted Publishing (OIDC — no token secret)

Publishing uses OIDC (`id-token: write`), not a `PYPI_API_TOKEN`. On PyPI, project
**`protspace`** → Settings → Publishing, add a trusted publisher:

| Field       | Value                                |
| ----------- | ------------------------------------ |
| Owner       | `<repository_owner>` (same org/user) |
| Repository  | `protspace`                          |
| Workflow    | `protspace-publish.yml`              |
| Environment | `pypi`                               |

Remove the legacy repo's stale trusted-publisher entry once the new one is
verified. (protlabel is published from the same job; if it becomes its own
PyPI project it needs its own trusted-publisher entry — today it ships under the
protspace release.)

## GHCR image — no secret to move

`protspace-publish.yml`'s `docker` job pushes `ghcr.io/<owner>/protspace` using the
built-in `GITHUB_TOKEN` (`packages: write`). Nothing to copy, but on first publish
from this repo confirm the existing `protspace` GHCR package's **Actions access** is
linked to this repo (Package → Settings → Manage Actions access), else the push
403s against a package still linked to the legacy repo.

## Already present in `protspace` — do NOT re-create

- `DEPLOY_APP_ID` / `DEPLOY_APP_PRIVATE_KEY` — web + prep image deploy (`publish-images.yml`, `deploy.yml`).
- `GITHUB_TOKEN` — built-in, auto-provided.

## After cutover

Once a live release dry-run passes, remove the legacy repo's PyPI
trusted-publisher entry. (`RELEASE_APP_*` secrets on `protspace-legacy` are moot —
the repo is archived and its workflows no longer run.)
