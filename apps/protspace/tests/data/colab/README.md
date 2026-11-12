# Colab runtime snapshot

`pip-freeze.txt` and `os-info.txt` are copied from
[googlecolab/backend-info](https://github.com/googlecolab/backend-info) at commit `e39694e2`
(2026-10-03): the packages and Python version of Colab's default (CPU) runtime.
`tests/test_colab_compat.py` checks protspace against them, so the Colab notebooks' install
cells keep Colab's preloaded packages (numpy, pandas, ...) at the versions already in memory.

Refresh when Colab updates its image, and whenever the check fails for a reason that is not ours:

```bash
cd apps/protspace/tests/data/colab
for f in pip-freeze.txt os-info.txt; do
  gh api repos/googlecolab/backend-info/contents/$f -H "Accept: application/vnd.github.raw" > $f
done
gh api repos/googlecolab/backend-info/commits --jq '.[0].sha[0:8] + " " + .[0].commit.committer.date'
```

Then update the commit and date above, and run
`PROTSPACE_COLAB_RESOLVE=1 uv run pytest tests/test_colab_compat.py` (it needs `uv` and PyPI).
