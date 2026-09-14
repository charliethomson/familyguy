#!/usr/bin/env sh
# Canonical fleet version: <tag MAJOR.MINOR>.<commit count>.
#
# Copied from vision's scripts/ci/version.sh (this repo has no standards
# submodule; the rule is standards/docs/versioning.md in charliethomson/standards).
# Replaces the inline "Resolve version" step .github/workflows/bot.build.yml carried.
#
# Usage:  eval "$(scripts/ci/version.sh)"   # -> sets VERSION and BUILD
set -eu

# plugin-git's clone doesn't reliably populate local tag refs, so refetch.
git fetch --tags --quiet origin 2>/dev/null || true

COUNT="$(git rev-list --count HEAD)"

# MAJOR.MINOR from any vN.N release tag, filtered in-shell (`git tag -l 'v[0-9]*'`
# comes back empty in CI; `git describe --match` misses tags off the current
# ancestry) and sorted numerically field by field (BSD sort has no -V).
MM="$(git tag -l | sed -nE 's/.*v([0-9]+\.[0-9]+).*/\1/p' | sort -t. -k1,1n -k2,2n | tail -1)"

# No tags exist yet, so 0.0 is expected, and is what the GitHub workflow produced.
if [ -z "$MM" ]; then
  echo "version.sh: no vMAJOR.MINOR tag found, falling back to 0.0" >&2
  MM="0.0"
fi

printf 'VERSION=%s\nBUILD=%s\n' "$MM.$COUNT" "$COUNT"
