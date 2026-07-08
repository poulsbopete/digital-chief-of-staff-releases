/**
 * Read Salesforce session from the Salesforce CLI (browser login — no API keys).
 */
import { execSync } from "node:child_process";

function sfDisplayJson(orgAlias) {
  const alias = orgAlias || process.env.DCOS_SF_ORG_ALIAS || "";
  const args = alias
    ? ["org", "display", "--json", "--target-org", alias]
    : ["org", "display", "--json"];
  const cmd = `sf ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: [
        process.env.PATH,
        "/usr/local/bin",
        "/opt/homebrew/bin",
        `${process.env.HOME}/.local/bin`,
      ]
        .filter(Boolean)
        .join(":"),
    },
  });
}

export function getSessionFromSfCli(orgAlias) {
  if (process.env.DCOS_SF_DISABLE_CLI === "1") return null;
  try {
    const raw = sfDisplayJson(orgAlias);
    const { result, status } = JSON.parse(raw);
    if (status !== 0 && status !== undefined && status !== null) return null;
    const instance = (result?.instanceUrl || "").replace(/\/$/, "");
    const token = result?.accessToken;
    if (!instance || !token) return null;
    return {
      access_token: token,
      instance_url: instance,
      org_alias: result?.alias || orgAlias || null,
      username: result?.username || null,
      source: "sf_cli",
    };
  } catch {
    return null;
  }
}

/** Shell exports for wrapper scripts: eval "$(node load-sf-session.mjs --export)" */
export function exportSessionShell(orgAlias) {
  const session = getSessionFromSfCli(orgAlias);
  if (!session) return "";
  return [
    `export DCOS_SF_ACCESS_TOKEN=${shellQuote(session.access_token)}`,
    `export DCOS_SF_INSTANCE_URL=${shellQuote(session.instance_url)}`,
  ].join("\n");
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
