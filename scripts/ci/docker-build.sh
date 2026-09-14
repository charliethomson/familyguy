#!/usr/bin/env sh
# Build (and, off pull requests, push) one image to ghcr.
#
# Usage:  scripts/ci/docker-build.sh <image> <dockerfile> <context> [extra docker build args...]
#   e.g.  scripts/ci/docker-build.sh familyguyfunnymomentsbot Dockerfile .
#
# Copied from vision's scripts/ci/docker-build.sh (via homelab's), with changes:
#
#   * `:main` and EXTRA_TAGS are pushed only from the main branch, so a manual run
#     on a feature branch can't overwrite the tag the deployment pulls. The GitHub
#     workflow only applied its branch/version tags on main.
#   * EXTRA_TAGS (space-separated) adds tags that move with :main. `{version}` in
#     it is replaced by the derived version.
#   * A push/manual run without GHCR_TOKEN fails rather than going green unpushed.
#
# Env: GHCR_TOKEN (absent on pull requests), CI_PIPELINE_EVENT, CI_COMMIT_SHA,
# CI_COMMIT_BRANCH, EXTRA_TAGS, BUILDER_KEEP_STORAGE.
set -eu

image="${1:?docker-build.sh needs an image name}"
dockerfile="${2:?docker-build.sh needs a dockerfile}"
context="${3:?docker-build.sh needs a build context}"
shift 3

repo="ghcr.io/charliethomson/$image"

# NB the nested substitution: this must capture the script's output.
eval "$("$(dirname "$0")/version.sh")"
echo "Building $image $VERSION (event=${CI_PIPELINE_EVENT:-unknown} branch=${CI_COMMIT_BRANCH:-unknown})"

export DOCKER_BUILDKIT=1

# Log in before building so --cache-from can read the private cache image
# (replaces `cache-{from,to}: type=gha`, which has no meaning off GitHub).
# Without a token (pull requests) the cache pull fails with a warning and the
# build runs cold.
if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u charliethomson --password-stdin >/dev/null
fi

moving_tags="main $(printf '%s' "${EXTRA_TAGS:-}" | sed "s/{version}/$VERSION/g")"
tag_args=""
for t in $moving_tags; do
  tag_args="$tag_args -t $repo:$t"
done

# BUILDKIT_INLINE_CACHE embeds cache metadata in the pushed image, which is what
# makes :main usable as --cache-from on the *other* agent.
# shellcheck disable=SC2086 # tag_args is deliberately word-split
docker build \
  -f "$dockerfile" \
  --build-arg RELEASE_VERSION="$VERSION" \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  --cache-from "$repo:main" \
  $tag_args \
  -t "$repo:sha-$CI_COMMIT_SHA" \
  "$@" \
  "$context"

if [ "${CI_PIPELINE_EVENT:-}" = "pull_request" ]; then
  echo "pull_request: built only, not pushed"
elif [ -z "${GHCR_TOKEN:-}" ]; then
  echo "docker-build.sh: no GHCR_TOKEN on a $CI_PIPELINE_EVENT run, refusing to report success without pushing" >&2
  exit 1
else
  docker push "$repo:sha-$CI_COMMIT_SHA"
  if [ "${CI_COMMIT_BRANCH:-}" = "main" ]; then
    for t in $moving_tags; do
      docker push "$repo:$t"
    done
  else
    echo "branch ${CI_COMMIT_BRANCH:-?} is not main: pushed sha-$CI_COMMIT_SHA only"
  fi
fi

# Housekeeping: tagged images are never reclaimed by prune, so drop every tag
# except :main (the --cache-from source).
docker rmi "$repo:sha-$CI_COMMIT_SHA" >/dev/null 2>&1 || true
for t in $moving_tags; do
  [ "$t" = main ] || docker rmi "$repo:$t" >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null 2>&1 || true
# The builder cache is the daemon's, shared by every repo on the agent. This
# image is a small node build; 4GB matches homelab's, sized for agent-1 having
# 7.6G free of 77G on 2026-09-14.
docker builder prune -f --keep-storage "${BUILDER_KEEP_STORAGE:-4GB}" >/dev/null 2>&1 || true
echo "disk after build:"
df -h /var/lib/docker 2>/dev/null | tail -1 || df -h / | tail -1
