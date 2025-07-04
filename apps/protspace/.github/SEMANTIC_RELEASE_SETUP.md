# Semantic Release Setup for Protected Branches

This repository uses automated semantic versioning with protected main branch support.

## Quick Setup

### 1. Create Personal Access Token (PAT)

1. Go to **GitHub** → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
2. Click **"Generate new token"**
3. Configure:
   - **Repository access**: Select this repository
   - **Permissions**:
     - ✅ **Contents**: Read and Write
     - ✅ **Metadata**: Read
     - ✅ **Pull requests**: Write
     - ✅ **Administration**: Write (to bypass branch protection)

### 2. Add Token to Repository Secrets

1. Go to your **repository** → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"**
3. Name: `SEMANTIC_RELEASE_TOKEN`
4. Value: Paste your PAT token
5. Click **"Add secret"**

## How It Works

- ✅ **Automatic versioning** using conventional commits
- ✅ **Changelog generation**
- ✅ **Git tags** and **GitHub releases**
- ✅ **Protected branch bypass** using PAT token
- ✅ **Fallback** to GITHUB_TOKEN if PAT not available

## Conventional Commits

Use these prefixes for automatic versioning:

- `feat:` → **Minor version** (1.0.0 → 1.1.0)
- `fix:` → **Patch version** (1.0.0 → 1.0.1)
- `feat!:` or `BREAKING CHANGE:` → **Major version** (1.0.0 → 2.0.0)

## Example

```bash
git commit -m "feat: add new CLI command for protein queries"
# This will bump the minor version and create a release
```

## Troubleshooting

If semantic release fails with "protected branch" error:

1. Verify `SEMANTIC_RELEASE_TOKEN` secret exists
2. Check PAT token has **Administration** permission
3. Check PAT token hasn't expired
