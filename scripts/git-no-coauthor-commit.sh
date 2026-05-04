#!/usr/bin/env sh
# Run git commit with an empty hooks directory so nothing can append
# Co-authored-by trailers (e.g. from the agent environment).
# Usage: ./scripts/git-no-coauthor-commit.sh -m "your message"
set -e
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
mkdir -p .git/empty-hooks
exec git -c core.hooksPath="$ROOT/.git/empty-hooks" commit "$@"
