#!/usr/bin/env bash
# Install MEDDPICC Coach skill for Claude Desktop + Claude Code.
set -euo pipefail

ROOT="${DCOS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
SRC="${ROOT}/skills/meddpicc-coach"
DEST="${INSTALL_DIR}/skills/meddpicc-coach"
SKILL_ZIP="${INSTALL_DIR}/meddpicc-coach.skill"
RELEASES_REPO="${DCOS_RELEASES_REPO:-poulsbopete/digital-chief-of-staff-releases}"
CLAUDE_SKILLS="${HOME}/.claude/skills"
OPEN_UPLOAD="${DCOS_OPEN_SKILL_UPLOAD:-1}"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }

if [[ ! -f "${SRC}/SKILL.md" ]]; then
  log "Skill sources not in ${SRC} — trying release download…"
  if [[ -f "${ROOT}/scripts/download-release-asset.sh" ]]; then
    bash "${ROOT}/scripts/download-release-asset.sh" "meddpicc-coach.skill" "${SKILL_ZIP}" && ok "Downloaded ${SKILL_ZIP}" || true
  elif command -v curl >/dev/null 2>&1; then
    url="$(curl -fsSL "https://api.github.com/repos/${RELEASES_REPO}/releases/latest" \
      | grep -Eo "\"browser_download_url\"[[:space:]]*:[[:space:]]*\"[^\"]*meddpicc-coach\.skill\"" \
      | head -1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
    if [[ -n "$url" ]]; then
      curl -fsSL "$url" -o "${SKILL_ZIP}"
      ok "Downloaded ${SKILL_ZIP}"
    fi
  fi
  if [[ -f "${SKILL_ZIP}" ]]; then
    cat <<EOF

$(printf '\033[1mMEDDPICC Coach — enable in Claude Desktop\033[0m')

  Claude Desktop → Settings → Capabilities → Skills → Upload skill
  Select: ${SKILL_ZIP}
  Toggle **meddpicc-coach** ON

EOF
    if [[ "$OPEN_UPLOAD" == "1" ]]; then
      case "$(uname -s)" in
        Darwin) open -R "$SKILL_ZIP" 2>/dev/null || true ;;
      esac
    fi
    exit 0
  fi
  warn "MEDDPICC Coach skill not found — skip or clone the DCOS repo"
  exit 0
fi

log "Installing MEDDPICC Coach skill…"
mkdir -p "${INSTALL_DIR}/skills" "${CLAUDE_SKILLS}"
rm -rf "${DEST}"
cp -R "${SRC}" "${DEST}"
ok "Copied skill to ${DEST}"

DCOS_ROOT_DIR="$ROOT" bash "${ROOT}/scripts/build-meddpicc-coach-skill.sh" >/dev/null
if [[ -f "${ROOT}/dist/meddpicc-coach.skill" ]]; then
  cp -f "${ROOT}/dist/meddpicc-coach.skill" "${SKILL_ZIP}"
  ok "Packaged ${SKILL_ZIP}"
fi

if [[ -e "${CLAUDE_SKILLS}/meddpicc-coach" && ! -L "${CLAUDE_SKILLS}/meddpicc-coach" ]]; then
  warn "${CLAUDE_SKILLS}/meddpicc-coach exists (not a symlink) — left unchanged"
else
  ln -sfn "${DEST}" "${CLAUDE_SKILLS}/meddpicc-coach"
  ok "Linked Claude Code skill → ${CLAUDE_SKILLS}/meddpicc-coach"
fi

cat <<EOF

$(printf '\033[1mMEDDPICC Coach — enable in Claude Desktop\033[0m')

  Claude Desktop → Settings → Capabilities → Skills → Upload skill
  Select: ${SKILL_ZIP}
  Toggle **meddpicc-coach** ON

  Then try:
  • "Score my [Account] deal using MEDDPICC"
  • "Open the pipeline app"
  • "Role-play the CFO on [Opp Name]"

  With DCOS MCP connected, the coach can pull live CRM via dcos_sfdc_get_opportunity + dcos_search.

EOF

if [[ "$OPEN_UPLOAD" == "1" && -f "$SKILL_ZIP" ]]; then
  case "$(uname -s)" in
    Darwin)
      open -R "$SKILL_ZIP" 2>/dev/null || open "$SKILL_ZIP" 2>/dev/null || true
      ok "Opened Finder — drag ${SKILL_ZIP} into Claude → Settings → Capabilities → Skills"
      ;;
  esac
fi
