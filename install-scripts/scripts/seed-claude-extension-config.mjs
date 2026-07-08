#!/usr/bin/env node
/**
 * Enable the DCOS Claude extension without Configure → Save.
 * Patches installed manifest (removes user_config) and sets isEnabled: true.
 * Credentials load from ~/.config/dcos/env.sh at MCP launch.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { getDcosInstallDir } from "../lib/load-dcos-env.mjs";

const EXTENSION_NAME = "digital-chief-of-staff";
const AUTHOR_SLUG = "elastic-field-enablement";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.DCOS_ROOT_DIR || join(SCRIPT_DIR, "..");
const MANIFEST_REL = join("extensions", "digital-chief-of-staff", "manifest.json");

function claudeSupportDir() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Claude");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude");
  }
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(config, "Claude");
}

function extensionDir() {
  return join(claudeSupportDir(), "Claude Extensions", `local.mcpb.${AUTHOR_SLUG}.${EXTENSION_NAME}`);
}

function settingsDir() {
  return join(claudeSupportDir(), "Claude Extensions Settings");
}

function expectedSettingsBasename() {
  return `local.mcpb.${AUTHOR_SLUG}.${EXTENSION_NAME}.json`;
}

function findSettingsPath() {
  const dir = settingsDir();
  if (!existsSync(dir)) return join(dir, expectedSettingsBasename());

  const exact = join(dir, expectedSettingsBasename());
  if (existsSync(exact)) return exact;

  try {
    const match = readdirSync(dir).find(
      (name) => name.endsWith(`.${EXTENSION_NAME}.json`) && name.startsWith("local.mcpb.")
    );
    if (match) return join(dir, match);
  } catch {
    /* first install */
  }

  return exact;
}

function findSourceManifestPath() {
  const installDir = getDcosInstallDir();
  const candidates = [
    join(REPO_ROOT, MANIFEST_REL),
    join(installDir, MANIFEST_REL),
    join(installDir, "vendor", "digital-chief-of-staff", MANIFEST_REL),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0];
}

function loadCleanManifest() {
  const sourcePath = findSourceManifestPath();
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing source manifest (checked repo, ${getDcosInstallDir()}, and vendor cache)`);
  }
  const manifest = JSON.parse(readFileSync(sourcePath, "utf8"));
  delete manifest.user_config;
  if (manifest.server?.mcp_config?.env) {
    delete manifest.server.mcp_config.env;
  }
  return manifest;
}

function patchInstalledManifest() {
  const installedPath = join(extensionDir(), "manifest.json");
  if (!existsSync(installedPath)) {
    return { patched: false, reason: "extension_not_installed", installedPath };
  }

  const clean = loadCleanManifest();
  const installed = JSON.parse(readFileSync(installedPath, "utf8"));
  const hadUserConfig = Boolean(installed.user_config);
  const hadEnv = Boolean(installed.server?.mcp_config?.env);

  if (!hadUserConfig && !hadEnv && installed.version === clean.version) {
    return { patched: false, reason: "already_clean", installedPath };
  }

  writeFileSync(installedPath, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  return { patched: true, installedPath, removedUserConfig: hadUserConfig, removedEnv: hadEnv };
}

function enableExtensionSettings() {
  const settingsPath = findSettingsPath();
  mkdirSync(settingsDir(), { recursive: true });

  let existing = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      /* overwrite corrupt file */
    }
  }

  const next = { ...existing, isEnabled: true };
  delete next.userConfig;

  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { settingsPath, isEnabled: true };
}

function main() {
  const manifest = patchInstalledManifest();
  const settings = enableExtensionSettings();
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...manifest,
        ...settings,
        hint: "Quit and reopen Claude Desktop if the extension still shows Configure.",
      },
      null,
      2
    )
  );
}

main();
