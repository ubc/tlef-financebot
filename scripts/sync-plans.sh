#!/usr/bin/env bash
#
# sync-plans.sh — share superpowers phase plans between the two FinanceBot developers.
#
#   npm run sync-plans -- Saurav
#   npm run sync-plans -- Stephen
#
# What it does:
#   1. Publishes YOUR own plan folders (docs/superpowers/plans/*/<You>/) to `main`,
#      using a throwaway git worktree so your current working branch is never touched.
#   2. Refreshes your local copy of every plan folder from `main`, so you can read
#      the other developer's latest plans.
#
# If `main` rejects a direct push (branch protection), your plans go to a
# `plans-sync-<You>` branch instead and you are told to open a PR. In that case
# the local refresh is skipped so your unpublished work is never overwritten.
#
# Written for macOS's default bash 3.2 — no bash-4 features.

set -euo pipefail

# Accept any casing (Stephen, stephen, STEPHEN) and normalize to the canonical
# capitalized name, which is what the folders on disk are named.
case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
  saurav)  ME="Saurav";  OTHER="Stephen" ;;
  stephen) ME="Stephen"; OTHER="Saurav"  ;;
  *) echo "Usage: npm run sync-plans -- <Saurav|Stephen>" >&2; exit 1 ;;
esac

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PLANS="docs/superpowers/plans"
EMAIL="$(echo "$ME" | tr '[:upper:]' '[:lower:]')@users.noreply.github.com"

echo "==> [$ME] Fetching origin..."
git fetch origin --quiet

# --- 1. Publish my plan folders to main via an isolated worktree ------------
WT="$(mktemp -d)"
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || true; rm -rf "$WT" 2>/dev/null || true; }
trap cleanup EXIT

git worktree add --quiet --detach "$WT" origin/main

found_mine=0
while IFS= read -r dir; do
  found_mine=1
  rel="${dir#./}"
  mkdir -p "$WT/$(dirname "$rel")"
  cp -R "$dir/." "$WT/$rel/"
done < <(find "$PLANS" -type d -name "$ME")

pushed_to_main=0
(
  cd "$WT"
  # Stage first, then check the index: `git diff --quiet` alone misses brand-new
  # (untracked) plan files, which are the common case when publishing a plan.
  [ "$found_mine" -eq 1 ] && git add -A -- "$PLANS"
  if [ "$found_mine" -eq 1 ] && ! git diff --cached --quiet -- "$PLANS"; then
    git -c user.name="$ME" -c user.email="$EMAIL" commit -q -m "docs(plans): publish $ME's plans"
    if git push --quiet origin HEAD:main 2>/dev/null; then
      echo "==> Published $ME's plans to main."
      exit 0
    else
      git push --quiet --force origin "HEAD:plans-sync-$ME"
      echo "==> 'main' rejected a direct push; pushed to 'plans-sync-$ME' — open a PR to merge." >&2
      exit 3
    fi
  fi
  echo "==> No new changes in your plan folders to publish."
  exit 0
) && pushed_to_main=1 || { [ "$?" -eq 3 ] && pushed_to_main=0 || exit 1; }

# --- 2. Refresh local plan folders from main --------------------------------
if [ "$pushed_to_main" -eq 1 ]; then
  git fetch origin main --quiet
  git checkout origin/main -- "$PLANS" 2>/dev/null || true
  git restore --staged "$PLANS" 2>/dev/null || true   # keep them unstaged on your branch
  echo "==> Pulled latest plans from main (yours + $OTHER's)."
else
  echo "==> Skipped local refresh: your plans are not on main yet (resolve the PR first)." >&2
fi

echo "==> Done. Read $OTHER's plans under $PLANS/<phase>/$OTHER/."
