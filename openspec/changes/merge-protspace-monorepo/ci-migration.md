# CI secrets & settings to migrate: `protspace` → `protspace_web`

Operator runbook for the protspace release/publish pipeline once it lives in this
monorepo (`apps/protspace`). Complete **before** archiving the old `protspace`
repo (OpenSpec task 3.4/4.3). The web/prep pipeline already has its own secrets in
`protspace_web` — only the items below need to move.

## Repository secrets to create

Copy these from the old `protspace` repo's settings into
`protspace_web` → Settings → Secrets and variables → Actions:

| Secret                    | Used by                 | Purpose                                                                                                                                                         |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELEASE_APP_ID`          | `protspace-release.yml` | GitHub App ID. python-semantic-release authenticates as this App to push the version-bump commit, tag, and GitHub Release, and to dispatch `protspace-publish`. |
| `RELEASE_APP_PRIVATE_KEY` | `protspace-release.yml` | Private key (PEM) for the same App.                                                                                                                             |

The GitHub App behind `RELEASE_APP_*` must be **installed on `protspace_web`**
with **Contents: read & write** (push commits/tags/releases and fire the
`repository_dispatch`). If it was installed only on the old repo, add the
`protspace_web` installation.

## GitHub Actions environment

`protspace-publish.yml`'s `pypi` job runs in environment **`pypi`**. Create that
environment in `protspace_web` → Settings → Environments (empty is fine — it
scopes the OIDC trusted-publish and any future protection rules).

## PyPI Trusted Publishing (OIDC — no token secret)

Publishing uses OIDC (`id-token: write`), not a `PYPI_API_TOKEN`. On PyPI, project
**`protspace`** → Settings → Publishing, add a trusted publisher:

| Field       | Value                                |
| ----------- | ------------------------------------ |
| Owner       | `<repository_owner>` (same org/user) |
| Repository  | `protspace_web`                      |
| Workflow    | `protspace-publish.yml`              |
| Environment | `pypi`                               |

Keep the old `protspace` repo as a trusted publisher until cutover is verified,
then remove it. (protlabel is published from the same job; if it becomes its own
PyPI project it needs its own trusted-publisher entry — today it ships under the
protspace release.)

## GHCR image — no secret to move

`protspace-publish.yml`'s `docker` job pushes `ghcr.io/<owner>/protspace` using the
built-in `GITHUB_TOKEN` (`packages: write`). Nothing to copy, but on first publish
from this repo confirm the existing `protspace` package's **Actions access** is
linked to `protspace_web` (Package → Settings → Manage Actions access), else the
push 403s against a package still owned by the old repo.

## Already present in `protspace_web` — do NOT re-create

- `DEPLOY_APP_ID` / `DEPLOY_APP_PRIVATE_KEY` — web + prep image deploy (`publish-images.yml`, `deploy.yml`).
- `GITHUB_TOKEN` — built-in, auto-provided.

## After cutover

Once a live release dry-run passes (task 3.4) and the old repo is archived (4.3),
delete `RELEASE_APP_*` from the old `protspace` repo and remove its PyPI
trusted-publisher entry.
