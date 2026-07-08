/**
 * User persona + account watchlist (~/.config/dcos/user.yaml, accounts.yaml).
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDcosInstallDir } from "./load-dcos-env.mjs";

export const PERSONA_CHOICES = [
  { id: "ae", label: "Account Executive (AE)", ownerKey: "ae", agent: "ae-account-coach" },
  { id: "avp", label: "Area VP / Sales Leader (AVP)", ownerKey: "avp", agent: "avp-leadership-brief" },
  { id: "sa", label: "Solution Architect (SA)", ownerKey: "sa", agent: "sa-technical-brief" },
  { id: "sdr", label: "Sales Development Rep (SDR)", ownerKey: "sdr", agent: "sdr-prospecting-brief" },
  { id: "ca", label: "Customer Architect (CA)", ownerKey: "ca", agent: "ca-customer-brief" },
  { id: "services", label: "Professional Services (PS)", ownerKey: "services", agent: "services-delivery-brief" },
];

export function yamlQuote(value) {
  const s = String(value ?? "").trim();
  if (!s) return '""';
  if (/[:#\n"'\\]|^\s/.test(s) || s.includes(",")) return JSON.stringify(s);
  return s;
}

export function parseSimpleYaml(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.+)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function parseAccountNames(yaml) {
  if (!yaml) return [];
  return [...yaml.matchAll(/^\s*-\s*name:\s*(.+)$/gm)].map((m) =>
    m[1].trim().replace(/^["']|["']$/g, "")
  );
}

export function profilePaths(installDir = getDcosInstallDir()) {
  return {
    installDir,
    user: join(installDir, "user.yaml"),
    accounts: join(installDir, "accounts.yaml"),
    personas: join(installDir, "personas.yaml"),
  };
}

export function loadUserProfile(installDir = getDcosInstallDir()) {
  const { user, accounts, personas } = profilePaths(installDir);
  const envPersona = process.env.DCOS_PERSONA?.trim().toLowerCase();
  const envName = process.env.DCOS_USER_NAME?.trim();

  let userData = null;
  if (existsSync(user)) {
    userData = parseSimpleYaml(readFileSync(user, "utf8"));
  } else if (envPersona || envName) {
    userData = { persona: envPersona, name: envName };
  }

  const accountsYaml = existsSync(accounts) ? readFileSync(accounts, "utf8") : null;
  const personaDef = userData?.persona
    ? PERSONA_CHOICES.find((p) => p.id === userData.persona) ?? null
    : null;

  return {
    configured: Boolean(userData?.persona && userData?.name),
    user: userData,
    persona: personaDef,
    accounts_yaml: accountsYaml,
    account_names: parseAccountNames(accountsYaml),
    paths: { user, accounts, personas },
    personas_available: existsSync(personas),
  };
}

export function buildAccountsYaml({ name, persona, territoryName, accountNames }) {
  const choice = PERSONA_CHOICES.find((p) => p.id === persona) ?? PERSONA_CHOICES[0];
  const territory = territoryName?.trim() || "My territory";
  const lines = [
    "# Account watchlist — Digital Chief of Staff",
    `# Persona: ${choice.label} · ${name}`,
    "",
    "territory:",
    `  name: ${yamlQuote(territory)}`,
    `  avp: ${yamlQuote(persona === "avp" ? name : "")}`,
    "",
    "accounts:",
  ];

  const names = accountNames.filter(Boolean);
  if (!names.length) {
    lines.push("  []");
  } else {
    for (const accountName of names) {
      const owner = { ae: null, sdr: null, sa: null, ca: null, avp: null, services: null };
      if (choice.ownerKey === "avp") {
        owner.avp = name;
      } else {
        owner[choice.ownerKey] = name;
      }
      const status =
        persona === "ca" || persona === "services" ? "customer" : "prospect";
      lines.push(`  - name: ${yamlQuote(accountName)}`);
      lines.push(`    status: ${status}`);
      lines.push("    owner:");
      lines.push(`      ae: ${owner.ae ? yamlQuote(owner.ae) : "null"}`);
      lines.push(`      sdr: ${owner.sdr ? yamlQuote(owner.sdr) : "null"}`);
      lines.push(`      sa: ${owner.sa ? yamlQuote(owner.sa) : "null"}`);
      lines.push(`      ca: ${owner.ca ? yamlQuote(owner.ca) : "null"}`);
      lines.push(`      services: ${owner.services ? yamlQuote(owner.services) : "null"}`);
      lines.push("    keywords: []");
      lines.push("    executives: []");
      lines.push("");
    }
  }

  lines.push(
    "research:",
    "  web_window: qdr:w",
    "  parallel_queries: 4",
    "  index_findings: true",
    ""
  );
  return lines.join("\n");
}

export function buildUserYaml({ name, persona, territoryName }) {
  return [
    "# DCOS user profile — role and defaults for briefs",
    `persona: ${persona}`,
    `name: ${yamlQuote(name)}`,
    `territory_name: ${yamlQuote(territoryName || "")}`,
    "",
  ].join("\n");
}

export function writeProfile(
  { name, persona, territoryName, accountNames },
  installDir = getDcosInstallDir()
) {
  const paths = profilePaths(installDir);
  writeFileSync(
    paths.user,
    buildUserYaml({ name, persona, territoryName }),
    "utf8"
  );
  writeFileSync(
    paths.accounts,
    buildAccountsYaml({ name, persona, territoryName, accountNames }),
    "utf8"
  );
  return paths;
}

export function ensurePersonasFile(installDir, sourcePath) {
  const dest = profilePaths(installDir).personas;
  if (existsSync(dest)) return dest;
  if (sourcePath && existsSync(sourcePath)) {
    copyFileSync(sourcePath, dest);
    return dest;
  }
  return null;
}

export function appendProfileEnvVars(
  { persona, name, installDir = getDcosInstallDir() },
  envShPath
) {
  if (!existsSync(envShPath)) return;
  let content = readFileSync(envShPath, "utf8");
  const accountsPath = join(installDir, "accounts.yaml");
  const userPath = join(installDir, "user.yaml");
  const sets = {
    DCOS_PERSONA: persona,
    DCOS_USER_NAME: name,
    DCOS_ACCOUNTS_CONFIG: accountsPath,
    DCOS_USER_CONFIG: userPath,
  };
  if (!content.includes("DCOS user profile")) {
    content += "\n# DCOS user profile (setup-user-profile.mjs)\n";
  }
  for (const [key, value] of Object.entries(sets)) {
    const line = `export ${key}="${String(value).replace(/"/g, '\\"')}"`;
    const re = new RegExp(`^export ${key}=.*$`, "m");
    content = re.test(content) ? content.replace(re, line) : `${content}${line}\n`;
  }
  writeFileSync(envShPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

export function appendProfileEnvPs1(
  { persona, name, installDir = getDcosInstallDir() },
  envPs1Path
) {
  if (!existsSync(envPs1Path)) return;
  let content = readFileSync(envPs1Path, "utf8");
  const accountsPath = join(installDir, "accounts.yaml").replace(/\\/g, "\\\\");
  const userPath = join(installDir, "user.yaml").replace(/\\/g, "\\\\");
  const sets = {
    DCOS_PERSONA: persona,
    DCOS_USER_NAME: name,
    DCOS_ACCOUNTS_CONFIG: accountsPath,
    DCOS_USER_CONFIG: userPath,
  };
  for (const [key, value] of Object.entries(sets)) {
    const line = `$env:${key} = "${value.replace(/"/g, '`"')}"`;
    if (content.includes(`$env:${key}`)) {
      content = content.replace(new RegExp(`^\\$env:${key} =.*$`, "m"), line);
    } else {
      content += `\n${line}`;
    }
  }
  writeFileSync(envPs1Path, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}
