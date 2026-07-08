import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readDcosEnv } from "./load-dcos-env.mjs";

/** Repo root in dev (`…/digital-chief-of-staff`) or bundle root (`…/server`). */
export function getAppRoot() {
  const libDir = dirname(fileURLToPath(import.meta.url));
  return join(libDir, "..");
}

export function getDcosInstallDir() {
  return process.env.DCOS_INSTALL_DIR || join(homedir(), ".config", "dcos");
}

/** Stable scripts root: env → env.sh → vendor cache → dev bundle. */
export function resolveDcosRoot() {
  const installDir = getDcosInstallDir();
  const vendor = join(installDir, "vendor", "digital-chief-of-staff");
  const marker = join("scripts", "verify-bq-crm.mjs");

  const candidates = [
    process.env.DCOS_ROOT_DIR,
    readDcosEnv(installDir).DCOS_ROOT_DIR,
    vendor,
    getAppRoot(),
  ].filter(Boolean);

  for (const root of candidates) {
    if (existsSync(join(root, marker))) return root;
  }
  return getAppRoot();
}

export function dockerDir() {
  return join(getAppRoot(), "docker");
}

export function configCandidates(basename) {
  const root = getAppRoot();
  return [
    process.env.DCOS_CONNECTORS_CONFIG,
    join(homedir(), ".config", "dcos", basename),
    join(root, "config", basename),
  ].filter(Boolean);
}

export function pathExists(...parts) {
  return existsSync(join(...parts));
}

/** Dependencies: bundled extension uses server/node_modules; dev repo uses mcp/node_modules. */
export function mcpNodeModules() {
  const root = getAppRoot();
  const bundled = join(root, "node_modules");
  if (existsSync(bundled)) return bundled;
  return join(root, "mcp", "node_modules");
}
