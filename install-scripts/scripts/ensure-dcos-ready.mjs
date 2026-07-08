#!/usr/bin/env node
/**
 * Preflight: local Elasticsearch up + DCOS/Jina Claude extensions installed.
 *
 *   node scripts/ensure-dcos-ready.mjs           # report only
 *   node scripts/ensure-dcos-ready.mjs --repair  # start ES, seed/enable extensions
 *   node scripts/ensure-dcos-ready.mjs --json    # machine-readable
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { applyDcosEnv, readDcosEnv } from "../lib/load-dcos-env.mjs";
import { requireElasticsearchUrl } from "../lib/elasticsearch.mjs";
import {
  ensureLocalElasticsearch,
  isLocalElasticsearchUrl,
  probeElasticsearch,
} from "../lib/ensure-local-elasticsearch.mjs";
import {
  getExtensionStatus,
  DCOS_EXTENSION,
  JINA_EXTENSION,
} from "../lib/claude-extension-status.mjs";
import { getAppRoot, resolveDcosRoot, getDcosInstallDir } from "../lib/paths.mjs";

applyDcosEnv();

const args = new Set(process.argv.slice(2));
const repair = args.has("--repair");
const jsonOut = args.has("--json");
const quiet = args.has("--quiet");

function log(msg) {
  if (!quiet && !jsonOut) console.log(msg);
}

function warn(msg) {
  if (!quiet && !jsonOut) console.warn(msg);
}

function rootDir() {
  return resolveDcosRoot();
}

async function ensureVendorCache() {
  const installDir = getDcosInstallDir();
  const vendor = join(installDir, "vendor", "digital-chief-of-staff");
  const marker = join(vendor, "scripts", "verify-bq-crm.mjs");
  if (existsSync(marker)) return { ok: true, path: vendor };
  const syncScript = join(rootDir(), "scripts", "sync-vendor-cache.sh");
  if (!existsSync(syncScript)) {
    return { ok: false, error: "sync-vendor-cache.sh not found — re-run install.sh" };
  }
  const r = shellScript("sync-vendor-cache", { DCOS_ROOT_DIR: rootDir() });
  if (!r.ok) return { ok: false, error: r.error || "vendor sync failed" };
  return existsSync(marker) ? { ok: true, path: vendor } : { ok: false, error: "vendor cache still missing" };
}

async function checkBigQueryCrm() {
  if (process.env.DCOS_CRM_SOURCE !== "bigquery") {
    const vars = readDcosEnv(getDcosInstallDir());
    if (vars.DCOS_CRM_SOURCE !== "bigquery") return { skipped: true };
  }
  const script = join(rootDir(), "scripts", "verify-bq-crm.mjs");
  if (!existsSync(script)) return { ok: false, error: "verify-bq-crm.mjs not found" };
  const r = spawnSync(process.execPath, [script], {
    env: { ...process.env, DCOS_ROOT_DIR: rootDir() },
    encoding: "utf8",
  });
  return {
    ok: r.status === 0,
    output: (r.stdout || r.stderr || "").trim(),
    error: r.status === 0 ? undefined : (r.stderr || r.stdout || "").trim(),
  };
}

async function ensureElasticsearchForReady() {
  const url = requireElasticsearchUrl();
  const local = isLocalElasticsearchUrl(url);
  if (repair && local) {
    const pre = await probeElasticsearch(url);
    if (!pre.ok) log("→ Starting local Elasticsearch…");
  }
  return ensureLocalElasticsearch({ repair: repair && local });
}

function runNodeScript(scriptName) {
  const script = join(rootDir(), "scripts", scriptName);
  if (!existsSync(script)) return { ok: false, error: `${scriptName} not found` };
  const r = spawnSync(process.execPath, [script], {
    env: { ...process.env, DCOS_ROOT_DIR: rootDir() },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return { ok: false, error: r.stderr?.trim() || r.stdout?.trim() || `exit ${r.status}` };
  }
  try {
    return { ok: true, result: JSON.parse(r.stdout) };
  } catch {
    return { ok: true, result: r.stdout?.trim() };
  }
}

function shellScript(name, extraEnv = {}) {
  const script = join(rootDir(), "scripts", `${name}.sh`);
  if (!existsSync(script)) return { ok: false, error: `${name}.sh not found` };
  const r = spawnSync("bash", [script], {
    env: { ...process.env, DCOS_ROOT_DIR: rootDir(), ...extraEnv },
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
  return { ok: r.status === 0, exitCode: r.status ?? 1, output: r.stdout?.trim() };
}

async function ensureExtensions() {
  const dcos = getExtensionStatus(DCOS_EXTENSION);
  const jina = getExtensionStatus(JINA_EXTENSION);
  const jinaKey = Boolean(process.env.JINA_API_KEY?.trim());
  const actions = [];

  if (repair) {
    if (!dcos.installed || !dcos.enabled) {
      const seed = runNodeScript("seed-claude-extension-config.mjs");
      actions.push({ step: "seed_dcos_extension", ...seed });
      Object.assign(dcos, getExtensionStatus(DCOS_EXTENSION));
    }
    if (!jina.installed) {
      const install = shellScript("install-jina-extension");
      actions.push({ step: "install_jina_mcpb", ...install });
      Object.assign(jina, getExtensionStatus(JINA_EXTENSION));
    } else if (!jina.enabled) {
      const seed = runNodeScript("seed-claude-jina-extension.mjs");
      actions.push({ step: "seed_jina_extension", ...seed });
      Object.assign(jina, getExtensionStatus(JINA_EXTENSION));
    }
  }

  return {
    dcos,
    jina,
    jina_api_key: jinaKey,
    actions,
  };
}

function overallReady(es, extensions) {
  return (
    es.ok &&
    extensions.dcos.installed &&
    extensions.dcos.enabled &&
    extensions.jina.installed &&
    extensions.jina.enabled &&
    extensions.jina_api_key
  );
}

async function main() {
  let vendor = { ok: true };
  if (repair) {
    vendor = await ensureVendorCache();
    if (!vendor.ok) warn(`Vendor cache: ${vendor.error}`);
  }

  const es = await ensureElasticsearchForReady();
  const extensions = await ensureExtensions();
  const bigquery = repair ? await checkBigQueryCrm() : { skipped: true };
  const ready = overallReady(es, extensions) && (!bigquery.skipped ? bigquery.ok !== false : true);

  const report = {
    ready,
    vendor_cache: vendor,
    bigquery_crm: bigquery,
    elasticsearch: es,
    extensions: {
      dcos: extensions.dcos,
      jina: extensions.jina,
      jina_api_key_set: extensions.jina_api_key,
    },
    repair_attempted: repair,
    repair_actions: extensions.actions,
    fixes: [],
  };

  if (!es.ok) {
    report.fixes.push(
      es.local
        ? "Double-click Ensure DCOS Ready.command or run: node scripts/ensure-dcos-ready.mjs --repair"
        : "Check ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY in ~/.config/dcos/env.sh"
    );
  }
  if (!extensions.dcos.installed) {
    report.fixes.push("Install DCOS: double-click digital-chief-of-staff.mcpb or re-run install.sh");
  } else if (!extensions.dcos.enabled) {
    report.fixes.push("Enable DCOS: ./Refresh Claude Extension.command");
  }
  if (!extensions.jina.installed) {
    report.fixes.push("Install Jina: ./Install Jina.command or double-click jina.mcpb in Claude");
  } else if (!extensions.jina.enabled) {
    report.fixes.push("Enable Jina: node scripts/seed-claude-jina-extension.mjs then restart Claude");
  }
  if (!extensions.jina_api_key) {
    report.fixes.push("Add JINA_API_KEY to ~/.config/dcos/env.sh (free key at https://jina.ai)");
  }
  if (bigquery.skipped === false && !bigquery.ok) {
    report.fixes.push(
      "BigQuery CRM: double-click ~/.config/dcos/Refresh Google Auth.command then Verify BigQuery CRM.command"
    );
  }
  if (vendor.ok === false) {
    report.fixes.push("Re-run install.sh or double-click Ensure DCOS Ready.command with --repair");
  }
  if (!ready && (extensions.dcos.installed || extensions.jina.installed)) {
    report.fixes.push("Quit and reopen Claude Desktop (Cmd+Q) after installing extensions");
  }

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    log("");
    log(ready ? "✓ DCOS ready — Elasticsearch + Claude extensions OK" : "! DCOS not fully ready");
    log(`  Elasticsearch: ${es.ok ? es.status + " @ " + es.url : es.error}`);
    log(
      `  DCOS extension: ${extensions.dcos.installed ? "installed" : "missing"}, ${extensions.dcos.enabled ? "enabled" : "disabled"}`
    );
    log(
      `  Jina extension: ${extensions.jina.installed ? "installed" : "missing"}, ${extensions.jina.enabled ? "enabled" : "disabled"}, API key ${extensions.jina_api_key ? "set" : "missing"}`
    );
    if (vendor.path) log(`  Scripts cache: ${vendor.path}`);
    if (bigquery.skipped === false) {
      log(`  BigQuery CRM: ${bigquery.ok ? "verified" : "failed"}`);
      if (bigquery.error) log(`    ${bigquery.error.split("\n")[0]}`);
    }
    if (report.fixes.length) {
      log("");
      log("Fixes:");
      for (const f of report.fixes) log(`  • ${f}`);
    }
    if (repair && extensions.actions.length) {
      log("");
      log("Repair steps run:");
      for (const a of extensions.actions) log(`  • ${a.step}: ${a.ok ? "ok" : a.error || "failed"}`);
    }
  }

  process.exit(ready ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
