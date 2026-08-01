#!/usr/bin/env bash
#
# sync-plans.sh — share superpowers phase plans between the two FinanceBot developers.
#
#   npm run sync-plans -- Saurav
#   npm run sync-plans -- Stephen
#
# What it does:
#   1. Publishes YOUR own plan folders (docs/superpowers/plans/*/<You>/) to the
#      dedicated documentation branch (`docs/phase-0-shared-services` by default),
#      using a throwaway git worktree so your current working branch is never touched.
#   2. Refreshes the other developer's personal plan folders from that
#      documentation branch, without touching shared core plans being edited
#      on your current feature branch.
#
# Override the branch for a one-off migration/test with PLANS_SYNC_BRANCH.
# The sync command never pushes to main, so plan-only updates do not trigger the
# staging deployment attached to main.
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
SYNC_BRANCH="${PLANS_SYNC_BRANCH:-docs/phase-0-shared-services}"
SYNC_MARKER="$PLANS/.sync-branch-initialized"

echo "==> [$ME] Fetching origin..."
git fetch origin "$SYNC_BRANCH" --quiet

# --- 1. Publish my plan folders via an isolated worktree ---------------------
WT="$(mktemp -d)"
cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || true; rm -rf "$WT" 2>/dev/null || true; }
trap cleanup EXIT

git worktree add --quiet --detach "$WT" "origin/$SYNC_BRANCH"

# The selected branch predates most personal plans. Seed it once from the
# caller's complete plans tree before switching to per-developer publishing;
# otherwise the first refresh would remove newer plans that the old branch has
# never seen.
if [ ! -f "$WT/$SYNC_MARKER" ]; then
  mkdir -p "$WT/$PLANS"
  cp -R "$PLANS/." "$WT/$PLANS/"
  cat > "$WT/$SYNC_MARKER" <<EOF
This branch is the canonical exchange point for personal phase-plan folders.
Initialized by sync-plans.sh; plan-only pushes must not target main.
EOF
fi

found_mine=0
while IFS= read -r dir; do
  found_mine=1
  rel="${dir#./}"
  mkdir -p "$WT/$(dirname "$rel")"
  cp -R "$dir/." "$WT/$rel/"
done < <(find "$PLANS" -type d -name "$ME")

(
  cd "$WT"
  # Stage first, then check the index: plain `git diff` can't see brand-new
  # (untracked) plan files, which would silently skip publishing them.
  if [ "$found_mine" -eq 1 ]; then
    git add "$PLANS"
  fi
  if [ "$found_mine" -eq 1 ] && ! git diff --cached --quiet -- "$PLANS"; then
    git -c user.name="$ME" -c user.email="$EMAIL" commit -q -m "docs(plans): publish $ME's plans"
    if ! git push --quiet origin "HEAD:$SYNC_BRANCH" 2>/dev/null; then
      # A concurrent sync usually touches only the other developer's folder.
      # Rebase once so both updates land without a force-push.
      git fetch origin "$SYNC_BRANCH" --quiet
      git rebase "origin/$SYNC_BRANCH"
      git push --quiet origin "HEAD:$SYNC_BRANCH"
    fi
    echo "==> Published $ME's plans to $SYNC_BRANCH."
    exit 0
  fi
  echo "==> No new changes in your plan folders to publish."
  exit 0
) || exit 1

# --- 2. Refresh the other developer's folders from the documentation branch -
git fetch origin "$SYNC_BRANCH" --quiet
for phase_dir in "$PLANS"/phase-*; do
  [ -d "$phase_dir" ] || continue
  other_dir="$phase_dir/$OTHER"
  if git cat-file -e "origin/$SYNC_BRANCH:$other_dir" 2>/dev/null; then
    git checkout "origin/$SYNC_BRANCH" -- "$other_dir"
    git restore --staged "$other_dir" 2>/dev/null || true
  fi
done
echo "==> Pulled $OTHER's latest personal plans from $SYNC_BRANCH."

echo "==> Done. Read $OTHER's plans under $PLANS/<phase>/$OTHER/."
