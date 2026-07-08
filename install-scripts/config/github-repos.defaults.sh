# Default GitHub slugs for DCOS (override via env for forks / transition).
# Source repo: elastic org (private). Releases: public mirror for curl install + artifacts.
export DCOS_GITHUB_REPO="${DCOS_GITHUB_REPO:-elastic/digital-chief-of-staff}"
export DCOS_RELEASES_REPO="${DCOS_RELEASES_REPO:-poulsbopete/digital-chief-of-staff-releases}"
export DCOS_SCRIPTS_MIRROR_REPO="${DCOS_SCRIPTS_MIRROR_REPO:-poulsbopete/digital-chief-of-staff-releases}"
export DCOS_SCRIPTS_MIRROR_PREFIX="${DCOS_SCRIPTS_MIRROR_PREFIX:-install-scripts/}"
