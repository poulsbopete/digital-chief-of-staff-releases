#!/usr/bin/env node
/**
 * Interactive setup: sales role (AE, AVP, SA, …) + account watchlist.
 *
 *   node scripts/setup-user-profile.mjs
 *   node scripts/setup-user-profile.mjs --persona ae --name "Jane Doe" --accounts "Acme,Globex"
 */
import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import {
  PERSONA_CHOICES,
  appendProfileEnvPs1,
  appendProfileEnvVars,
  ensurePersonasFile,
  loadUserProfile,
  writeProfile,
} from "../lib/dcos-profile.mjs";
import { getDcosInstallDir } from "../lib/load-dcos-env.mjs";

function parseArgs(argv) {
  const args = { persona: "", name: "", territory: "", accounts: "", force: false, yes: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--persona") args.persona = argv[++i]?.toLowerCase() ?? "";
    else if (a === "--name") args.name = argv[++i] ?? "";
    else if (a === "--territory") args.territory = argv[++i] ?? "";
    else if (a === "--accounts") args.accounts = argv[++i] ?? "";
    else if (a === "--force") args.force = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
  }
  return args;
}

function splitAccounts(raw) {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function promptPersona(rl, preset) {
  if (preset && PERSONA_CHOICES.some((p) => p.id === preset)) return preset;
  console.log("\n  Your sales role:");
  PERSONA_CHOICES.forEach((p, i) => {
    console.log(`    ${i + 1}) ${p.label}`);
  });
  const answer = (await rl.question("\n  Choice [1]: ")).trim() || "1";
  const idx = Number.parseInt(answer, 10);
  if (idx >= 1 && idx <= PERSONA_CHOICES.length) return PERSONA_CHOICES[idx - 1].id;
  const byId = PERSONA_CHOICES.find((p) => p.id === answer.toLowerCase());
  if (byId) return byId.id;
  return "ae";
}

async function main() {
  const cli = parseArgs(process.argv);
  const installDir = getDcosInstallDir();
  mkdirSync(installDir, { recursive: true });
  const existing = loadUserProfile(installDir);
  const personasSource = join(
    process.env.DCOS_ROOT_DIR || join(installDir, "vendor/digital-chief-of-staff"),
    "config/personas.yaml"
  );
  const repoPersonas = join(process.cwd(), "config/personas.yaml");
  ensurePersonasFile(
    installDir,
    existsSync(repoPersonas) ? repoPersonas : personasSource
  );

  if (existing.configured && !cli.force && !cli.persona) {
    console.log(`\n  Profile already set: ${existing.user.name} (${existing.user.persona.toUpperCase()})`);
    console.log(`  Watchlist: ${existing.account_names.length ? existing.account_names.join(", ") : "(none)"}`);
    if (!process.stdin.isTTY) return;
    const rl = createInterface({ input, output });
    const again = (await rl.question("\n  Reconfigure? [y/N] ")).trim();
    rl.close();
    if (!/^y/i.test(again)) {
      console.log("  Keeping existing profile.");
      return;
    }
  }

  let persona = cli.persona;
  let name = cli.name;
  let territory = cli.territory;
  let accountNames = cli.accounts ? splitAccounts(cli.accounts) : [];

  const nonInteractive = cli.yes || cli.persona || !process.stdin.isTTY;

  if (!nonInteractive || (!persona && !name)) {
    const rl = createInterface({ input, output });
    console.log("\n  Digital Chief of Staff — your role & watchlist");
    console.log("  ─────────────────────────────────────────────");

    if (!name) {
      name = (await rl.question("\n  Your name (as in Salesforce): ")).trim();
    }
    persona = await promptPersona(rl, persona);
    if (!territory && (persona === "avp" || persona === "ae")) {
      territory = (
        await rl.question("  Territory or patch name (optional): ")
      ).trim();
    }
    if (!cli.accounts) {
      const raw = await rl.question(
        "\n  Accounts to watch (comma-separated, e.g. Acme, Globex): "
      );
      accountNames = splitAccounts(raw);
    }
    rl.close();
  }

  if (!name?.trim()) {
    console.error("Name is required. Use --name or run interactively.");
    process.exit(1);
  }
  if (!persona) persona = "ae";
  if (!PERSONA_CHOICES.some((p) => p.id === persona)) {
    console.error(`Unknown persona: ${persona}. Use: ${PERSONA_CHOICES.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  const paths = writeProfile(
    {
      name: name.trim(),
      persona,
      territoryName: territory,
      accountNames,
    },
    installDir
  );

  const envSh = join(installDir, "env.sh");
  const envPs1 = join(installDir, "env.ps1");
  appendProfileEnvVars({ persona, name: name.trim(), installDir }, envSh);
  appendProfileEnvPs1({ persona, name: name.trim(), installDir }, envPs1);

  const label = PERSONA_CHOICES.find((p) => p.id === persona)?.label ?? persona;
  console.log("");
  console.log(`  ✓ Role: ${label}`);
  console.log(`  ✓ Watchlist: ${accountNames.length ? accountNames.join(", ") : "(add later in accounts.yaml)"}`);
  console.log(`  ✓ Saved ${paths.user}`);
  console.log(`  ✓ Saved ${paths.accounts}`);
  console.log("");
  console.log("  In Claude, try:");
  console.log(`    "Produce my ${persona.toUpperCase()} morning brief"`);
  if (accountNames[0]) {
    console.log(`    "Account prep for ${accountNames[0]}"`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
