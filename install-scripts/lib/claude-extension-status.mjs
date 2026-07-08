/**
 * Inspect Claude Desktop local MCP extension install + enable state.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export function claudeSupportDir() {
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

function settingsDir() {
  return join(claudeSupportDir(), "Claude Extensions Settings");
}

function findSettingsPath(extensionName) {
  const dir = settingsDir();
  const exactPrefix = `local.mcpb.`;
  const suffix = `.${extensionName}.json`;
  if (!existsSync(dir)) return null;
  try {
    const match = readdirSync(dir).find(
      (name) => name.startsWith(exactPrefix) && name.endsWith(suffix)
    );
    return match ? join(dir, match) : null;
  } catch {
    return null;
  }
}

export function getExtensionStatus({ authorSlug, extensionName }) {
  const extensionDir = join(
    claudeSupportDir(),
    "Claude Extensions",
    `local.mcpb.${authorSlug}.${extensionName}`
  );
  const manifestPath = join(extensionDir, "manifest.json");
  const installed = existsSync(manifestPath);
  const settingsPath = findSettingsPath(extensionName);
  let enabled = false;
  let version = null;

  if (installed) {
    try {
      version = JSON.parse(readFileSync(manifestPath, "utf8")).version ?? null;
    } catch {
      version = null;
    }
  }
  if (settingsPath && existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      enabled = settings.isEnabled !== false;
    } catch {
      enabled = false;
    }
  }

  return { extensionName, authorSlug, installed, enabled, version, extensionDir, settingsPath };
}

export const DCOS_EXTENSION = {
  authorSlug: "elastic-field-enablement",
  extensionName: "digital-chief-of-staff",
};

export const JINA_EXTENSION = {
  authorSlug: "elastic-field-enablement",
  extensionName: "jina-web-research",
};
