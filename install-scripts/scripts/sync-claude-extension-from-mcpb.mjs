#!/usr/bin/env node
/**
 * Hot-sync DCOS server code from .mcpb into Claude's installed extension folder.
 * Use when Claude still runs an old bundle after double-clicking .mcpb did not apply.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDcosInstallDir } from "../lib/load-dcos-env.mjs";

const EXTENSION_NAME = "digital-chief-of-staff";
const AUTHOR_SLUG = "elastic-field-enablement";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.DCOS_ROOT_DIR || join(SCRIPT_DIR, "..");

function claudeSupportDir() {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude");
  }
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(config, "Claude");
}

function extensionDir() {
  return join(claudeSupportDir(), "Claude Extensions", `local.mcpb.${AUTHOR_SLUG}.${EXTENSION_NAME}`);
}

function resolveMcpbPath() {
  const installDir = getDcosInstallDir();
  const candidates = [
    join(installDir, "digital-chief-of-staff.mcpb"),
    join(REPO_ROOT, "dist", "digital-chief-of-staff.mcpb"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(`No digital-chief-of-staff.mcpb found in ${installDir} or ${join(REPO_ROOT, "dist")}`);
}

function ensureFreshMcpb() {
  const installMcpb = join(getDcosInstallDir(), "digital-chief-of-staff.mcpb");
  const distMcpb = join(REPO_ROOT, "dist", "digital-chief-of-staff.mcpb");
  const buildScript = join(REPO_ROOT, "scripts", "build-dcos-mcpb.sh");
  if (!existsSync(installMcpb) && !existsSync(distMcpb) && existsSync(buildScript)) {
    execSync(`bash ${JSON.stringify(buildScript)}`, { stdio: "inherit", cwd: REPO_ROOT });
  }
}

function hasBigQueryLib(serverLibDir) {
  return existsSync(join(serverLibDir, "bq-crm.mjs")) && existsSync(join(serverLibDir, "crm-backend.mjs"));
}

function main() {
  ensureFreshMcpb();
  const mcpbPath = resolveMcpbPath();
  const dest = extensionDir();

  const stage = mkdtempSync(join(tmpdir(), "dcos-mcpb-"));
  try {
    execSync(`unzip -q ${JSON.stringify(mcpbPath)} -d ${JSON.stringify(stage)}`);
    const serverSrc = join(stage, "server");
    const manifestSrc = join(stage, "manifest.json");
    if (!existsSync(serverSrc) || !hasBigQueryLib(join(serverSrc, "lib"))) {
      throw new Error("Bundle missing BigQuery libs — rebuild with scripts/build-dcos-mcpb.sh");
    }

    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "manifest.json"), readFileSync(manifestSrc, "utf8"));

    const serverDest = join(dest, "server");
    rmSync(serverDest, { recursive: true, force: true });
    cpSync(serverSrc, serverDest, { recursive: true });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  const manifest = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
  console.log(
    JSON.stringify(
      {
        ok: true,
        synced_from: mcpbPath,
        installed_to: dest,
        version: manifest.version,
        bigquery_libs: hasBigQueryLib(join(dest, "server", "lib")),
        hint: "Quit Claude Desktop completely (Cmd+Q), reopen, then run dcos_sfdc_auth_status.",
      },
      null,
      2
    )
  );
}

main();
