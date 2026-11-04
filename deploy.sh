#!/usr/bin/env bash
# Build the committed main branch and publish only the static output.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=true; shift; fi
if [[ $# -ne 0 ]]; then echo 'Usage: ./deploy.sh [--dry-run]' >&2; exit 1; fi
git rev-parse --verify main >/dev/null 2>&1 || { echo 'Commit the app to a main branch first.' >&2; exit 1; }
REMOTE="$(git remote get-url origin)"
SOURCE_COMMIT="$(git rev-parse main)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/plouf-deploy.XXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/source" "$TMP/pages"
git archive main | tar -x -C "$TMP/source"
# Only public Vite configuration is embedded in a Pages build.
if [[ -f "$ROOT/.env.local" ]]; then
  awk '/^VITE_SUPABASE_(URL|PUBLISHABLE_KEY)=/' "$ROOT/.env.local" > "$TMP/source/.env.local"
fi
cd "$TMP/source"
npm ci
npm test
npm run build
test "$(cat dist/CNAME)" = 'plouf.space'
touch dist/.nojekyll
if $DRY_RUN; then echo "Build verified from main ($SOURCE_COMMIT). No branch or remote changed."; exit 0; fi
cd "$TMP/pages"
git init --quiet
git remote add origin "$REMOTE"
if git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git fetch --quiet --depth=1 origin gh-pages
  git checkout --quiet -b gh-pages FETCH_HEAD
else
  git checkout --quiet --orphan gh-pages
fi
# Delete only this disposable checkout's previously published files.
git rm -r --ignore-unmatch --quiet .
cp -R "$TMP/source/dist/." .
git add --all
if git diff --cached --quiet; then echo 'GitHub Pages is already up to date.'; exit 0; fi
git -c user.name="$(git -C "$ROOT" config user.name || echo 'Plouf deploy')" \
    -c user.email="$(git -C "$ROOT" config user.email || echo 'deploy@plouf.space')" \
    commit --quiet -m "Deploy Plouf from main ${SOURCE_COMMIT:0:12}"
git push origin HEAD:gh-pages
echo 'Published gh-pages. Configure GitHub Pages to use gh-pages / (root) and plouf.space.'
