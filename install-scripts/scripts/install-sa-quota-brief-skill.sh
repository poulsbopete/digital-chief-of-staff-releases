#!/usr/bin/env bash
# Install SA Quota Brief skill + quota.yaml for Claude Desktop / Claude Code.
set -euo pipefail

ROOT="${DCOS_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INSTALL_DIR="${DCOS_INSTALL_DIR:-$HOME/.config/dcos}"
SRC="${ROOT}/skills/sa-quota-brief"
DEST="${INSTALL_DIR}/skills/sa-quota-brief"
SKILL_ZIP="${INSTALL_DIR}/sa-quota-brief.skill"
CLAUDE_SKILLS="${HOME}/.claude/skills"
QUOTA_FILE="${INSTALL_DIR}/quota.yaml"
QUOTA_EXAMPLE="${ROOT}/config/quota-peter-simkins.yaml"
[[ -f "$QUOTA_EXAMPLE" ]] || QUOTA_EXAMPLE="${ROOT}/config/quota.yaml.example"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m!\033[0m %s\n' "$*"; }

if [[ ! -f "${SRC}/SKILL.md" ]]; then
  warn "SA Quota Brief skill not found at ${SRC}"
  exit 1
fi

log "Installing SA Quota Brief skill…"
mkdir -p "${INSTALL_DIR}/skills" "${CLAUDE_SKILLS}"
rm -rf "${DEST}"
cp -R "${SRC}" "${DEST}"
ok "Copied skill to ${DEST}"

if [[ ! -f "$QUOTA_FILE" ]]; then
  cp "$QUOTA_EXAMPLE" "$QUOTA_FILE"
  ok "Created ${QUOTA_FILE} — edit rep quotas and period dates"
else
  ok "Quota config already exists: ${QUOTA_FILE}"
fi

DCOS_ROOT_DIR="$ROOT" bash "${ROOT}/scripts/build-sa-quota-brief-skill.sh" >/dev/null
if [[ -f "${ROOT}/dist/sa-quota-brief.skill" ]]; then
  cp -f "${ROOT}/dist/sa-quota-brief.skill" "${SKILL_ZIP}"
  ok "Packaged ${SKILL_ZIP}"
fi

if [[ -e "${CLAUDE_SKILLS}/sa-quota-brief" && ! -L "${CLAUDE_SKILLS}/sa-quota-brief" ]]; then
  warn "${CLAUDE_SKILLS}/sa-quota-brief exists (not a symlink) — left unchanged"
else
  ln -sfn "${DEST}" "${CLAUDE_SKILLS}/sa-quota-brief"
  ok "Linked Claude Code skill → ${CLAUDE_SKILLS}/sa-quota-brief"
fi

cat <<EOF

$(printf '\033[1mSA Quota Brief — enable in Claude Desktop\033[0m')

  Claude Desktop → Settings → Capabilities → Skills → Upload skill
  Select: ${SKILL_ZIP}
  Toggle **sa-quota-brief** ON

  Quota targets: ${QUOTA_FILE}
  Live progress: run dcos_quota_progress (BigQuery CRM)

  Try: "Run my SA quota daily brief and post to Slack"

EOF

if [[ "${DCOS_OPEN_SKILL_UPLOAD:-1}" == "1" && -f "$SKILL_ZIP" ]]; then
  case "$(uname -s)" in
    Darwin) open -R "$SKILL_ZIP" 2>/dev/null || open "$SKILL_ZIP" 2>/dev/null || true ;;
  esac
fi
