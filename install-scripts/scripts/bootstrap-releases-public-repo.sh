#!/usr/bin/env bash
# One-time bootstrap: create the public releases repo and enable GitHub Pages.
# Requires: gh auth login (repo scope), RELEASES_REPO_TOKEN optional for CI later.
set -euo pipefail

REPO="${DCOS_RELEASES_REPO:-poulsbopete/digital-chief-of-staff-releases}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/releases-public"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null 2>&1 || err "Install GitHub CLI: brew install gh && gh auth login"

if ! gh repo view "$REPO" >/dev/null 2>&1; then
  log "Creating public repo ${REPO}…"
  gh repo create "${REPO#*/}" --public \
    --description "Public downloads for Digital Chief of Staff (installers + GitHub Pages)" \
    --source "$SRC" \
    --remote origin \
    --push 2>/dev/null || {
      # Repo may not exist under user — create empty then push
      gh repo create "$REPO" --public --description "Public DCOS downloads"
      tmp="$(mktemp -d)"
      cp -R "$SRC/." "$tmp/"
      git -C "$tmp" init -b main
      git -C "$tmp" add -A
      git -C "$tmp" commit -m "Initial public download site"
      git -C "$tmp" remote add origin "https://github.com/${REPO}.git"
      git -C "$tmp" push -u origin main
      rm -rf "$tmp"
    }
  ok "Created ${REPO}"
else
  log "Repo exists — syncing releases-public/ content…"
  tmp="$(mktemp -d)"
  git clone "https://github.com/${REPO}.git" "$tmp"
  rsync -a --delete --exclude '.git' --exclude '.vercel' --exclude '.env*' "$SRC/" "$tmp/"
  git -C "$tmp" add -A
  if git -C "$tmp" diff --staged --quiet; then
    ok "Already up to date"
  else
    git -C "$tmp" commit -m "Sync download site from digital-chief-of-staff"
    git -C "$tmp" push origin main
    ok "Pushed site update"
  fi
  rm -rf "$tmp"
fi

log "Enabling GitHub Pages (branch main, /docs)…"
gh api "repos/${REPO}/pages" -X POST \
  -f build_type=legacy \
  -f source[branch]=main \
  -f source[path]=/docs 2>/dev/null || \
  gh api "repos/${REPO}/pages" -X PUT \
  -f build_type=legacy \
  -f source[branch]=main \
  -f source[path]=/docs 2>/dev/null || \
  warn "Enable Pages manually: Settings → Pages → main /docs"

PAGES_URL="https://digital-chief-of-staff-releases.vercel.app/"
GH_PAGES_URL="https://${REPO%%/*}.github.io/${REPO#*/}/"
echo ""
ok "Done"
echo ""
echo "  Download page (Vercel): ${PAGES_URL}"
echo "  GitHub Pages mirror:  ${GH_PAGES_URL}"
echo "  Releases:             https://github.com/${REPO}/releases"
echo ""
echo "  Vercel: import ${REPO} at https://vercel.com/new (see releases-public/VERCEL.md)"
echo "  Add secret to private repo (Settings → Secrets → Actions):"
echo "    RELEASES_REPO_TOKEN = fine-grained PAT with Contents read/write on ${REPO}"
echo ""
