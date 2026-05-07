#!/usr/bin/env bash
# Vercel "Ignored Build Step" — exit 0 to skip build, exit 1 to proceed.
# Register at: Vercel → Project → Settings → Git → Ignored Build Step
#   Command: bash scripts/vercel-ignore-build.sh

set -e

# Always build the production branch.
if [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then
  echo "non-main branch ($VERCEL_GIT_COMMIT_REF) — skipping"
  exit 0
fi

# Compare against the previous deployed commit if available, otherwise HEAD^.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"

# Paths whose changes do NOT affect the deployed app.
# If every changed file matches one of these, skip the build.
IGNORE_PATTERNS=(
  '^local-agent/'
  '^imagemaker/'
  '^agents/'
  '^docs/'
  '^business-plan-2026\.md$'
  '^README\.md$'
  '^AGENTS\.md$'
  '^CLAUDE\.md$'
  '\.md$'
  '^\.gitignore$'
  '^crisp plugin identifier'
  '^threads\.env$'
)

CHANGED=$(git diff --name-only "$BASE" HEAD 2>/dev/null || git diff --name-only HEAD^ HEAD)

if [ -z "$CHANGED" ]; then
  echo "no changes detected — proceeding (safe default)"
  exit 1
fi

echo "changed files:"
echo "$CHANGED"

while IFS= read -r file; do
  match=0
  for pat in "${IGNORE_PATTERNS[@]}"; do
    if echo "$file" | grep -qE "$pat"; then
      match=1
      break
    fi
  done
  if [ $match -eq 0 ]; then
    echo "→ build needed: $file does not match ignore list"
    exit 1
  fi
done <<< "$CHANGED"

echo "→ all changed files are deploy-irrelevant — skipping build"
exit 0
