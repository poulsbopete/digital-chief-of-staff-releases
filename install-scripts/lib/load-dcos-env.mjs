/**
 * Read ~/.config/dcos/env.sh or env.ps1 written by the installer.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getDcosInstallDir() {
  return process.env.DCOS_INSTALL_DIR || join(homedir(), ".config", "dcos");
}

export function parseEnvSh(content) {
  const vars = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^export ([A-Z0-9_]+)="((?:[^"\\]|\\.)*)"/);
    if (m) vars[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return vars;
}

export function parseEnvPs1(content) {
  const vars = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^\$env:([A-Z0-9_]+) = "((?:[^"\\]|\\.)*)"/);
    if (m) vars[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return vars;
}

export function readDcosEnv(installDir = getDcosInstallDir()) {
  const envSh = join(installDir, "env.sh");
  const envPs1 = join(installDir, "env.ps1");
  if (existsSync(envSh)) return parseEnvSh(readFileSync(envSh, "utf8"));
  if (existsSync(envPs1)) return parseEnvPs1(readFileSync(envPs1, "utf8"));
  return {};
}

/** Apply installer env vars when Claude extension fields are empty. */
export function applyDcosEnv({ overwrite = false } = {}) {
  const vars = readDcosEnv();
  for (const [key, value] of Object.entries(vars)) {
    if (value == null || value === "") continue;
    if (overwrite || !String(process.env[key] ?? "").trim()) {
      process.env[key] = value;
    }
  }
  return vars;
}

export function readElasticsearchConfig(installDir = getDcosInstallDir()) {
  const vars = readDcosEnv(installDir);
  const url = vars.ELASTICSEARCH_URL || process.env.ELASTICSEARCH_URL || "";
  const apiKey = vars.ELASTICSEARCH_API_KEY || process.env.ELASTICSEARCH_API_KEY || "";
  return { url, apiKey, installDir };
}
