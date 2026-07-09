/**
 * Probe and optionally start local Elasticsearch (127.0.0.1 / localhost).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createEsClient, requireElasticsearchUrl } from "./elasticsearch.mjs";
import { getAppRoot } from "./paths.mjs";

export const LOCAL_ES_FIX_HINTS = [
  "Double-click Ensure DCOS Ready.command in digital-chief-of-staff",
  "Or: node scripts/ensure-dcos-ready.mjs --repair",
  "Or: ./scripts/dcos-elasticsearchctl.sh start",
];

export function isLocalElasticsearchUrl(url) {
  return /127\.0\.0\.1|localhost/.test(url || "");
}

export function autoStartLocalElasticsearchEnabled() {
  return process.env.DCOS_ES_AUTO_START !== "0";
}

function esControlScript() {
  const root = process.env.DCOS_ROOT_DIR || getAppRoot();
  const ctl = join(root, "scripts", "dcos-elasticsearchctl.sh");
  return existsSync(ctl) ? ctl : null;
}

function probeFailure(esUrl, local, error, fix_steps) {
  return { ok: false, url: esUrl, local, error, fix_steps };
}

async function probeServerlessRoot(es, esUrl, local) {
  try {
    const root = await es.esFetch("/");
    const buildFlavor = root.version?.build_flavor;
    const serverless = buildFlavor === "serverless" || /\.elastic\.cloud/i.test(esUrl);
    return {
      ok: true,
      url: esUrl,
      flavor: serverless ? "serverless" : "cloud",
      serverless,
      version: root.version?.number,
      cluster_name: root.cluster_name,
      local,
      status: "serverless",
      note:
        "Elastic Serverless (Search or Elasticsearch project) does not expose /_cluster/health — connectivity verified via GET /.",
    };
  } catch (e) {
    return probeFailure(esUrl, local, e.message, local ? LOCAL_ES_FIX_HINTS : cloudFixHints());
  }
}

export async function probeElasticsearch(esUrl = requireElasticsearchUrl()) {
  const es = createEsClient(esUrl);
  const local = isLocalElasticsearchUrl(esUrl);

  try {
    const health = await es.esFetch("/_cluster/health");
    const ok = health.status === "green" || health.status === "yellow";
    return {
      ok,
      url: esUrl,
      flavor: local ? "local" : "stateful",
      serverless: false,
      status: health.status,
      local,
      error: ok ? undefined : `Cluster status is ${health.status}`,
      fix_steps: ok ? undefined : local ? LOCAL_ES_FIX_HINTS : cloudFixHints(),
    };
  } catch (e) {
    // Serverless Search + Elasticsearch projects return 410 for cluster-level APIs.
    if (e.status === 410) {
      return probeServerlessRoot(es, esUrl, local);
    }
    return probeFailure(
      esUrl,
      local,
      e.message,
      local ? LOCAL_ES_FIX_HINTS : cloudFixHints()
    );
  }
}

function cloudFixHints() {
  return [
    "Check ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY in ~/.config/dcos/env.sh and Claude extension settings",
    "Serverless API key needs create_index + write privileges for dcos_* indices",
    "Local ES (separate from your other clusters): export ELASTICSEARCH_URL=http://127.0.0.1:9200",
  ];
}

export function startLocalElasticsearch({ quiet = false } = {}) {
  const ctl = esControlScript();
  if (!ctl) {
    throw new Error("dcos-elasticsearchctl.sh not found — run install.sh");
  }
  execSync(`bash "${ctl}" start`, { stdio: quiet ? "pipe" : "inherit" });
}

export async function waitForElasticsearch({ esUrl, maxMs = 90000, intervalMs = 2000 } = {}) {
  const url = esUrl || requireElasticsearchUrl();
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const probe = await probeElasticsearch(url);
    if (probe.ok) return probe;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return probeElasticsearch(url);
}

/**
 * Ensure Elasticsearch responds. When URL is local and repair=true, starts native ES and waits.
 */
export async function ensureLocalElasticsearch({
  repair = false,
  waitMs = 90000,
  esUrl,
} = {}) {
  const url = esUrl || requireElasticsearchUrl();
  let probe = await probeElasticsearch(url);
  if (probe.ok) {
    return { ...probe, started: false, repair_attempted: repair };
  }

  if (!probe.local || !repair) {
    return { ...probe, started: false, repair_attempted: false };
  }

  try {
    startLocalElasticsearch({ quiet: true });
  } catch (e) {
    return {
      ...probe,
      started: false,
      repair_attempted: true,
      start_error: e.message,
      fix_steps: LOCAL_ES_FIX_HINTS,
    };
  }

  probe = await waitForElasticsearch({ esUrl: url, maxMs: waitMs });
  return { ...probe, started: true, repair_attempted: true };
}

export function assertElasticsearchAvailable(probe) {
  if (probe.ok) return;
  const err = new Error(
    probe.local
      ? `Local Elasticsearch is not running at ${probe.url}: ${probe.error || "unreachable"}`
      : `Elasticsearch unavailable at ${probe.url}: ${probe.error || "unreachable"}`
  );
  err.code = "ELASTICSEARCH_UNAVAILABLE";
  err.probe = probe;
  err.fix_steps = probe.fix_steps || (probe.local ? LOCAL_ES_FIX_HINTS : cloudFixHints());
  throw err;
}

export async function requireElasticsearch({ repair, esUrl } = {}) {
  const shouldRepair =
    repair ?? (autoStartLocalElasticsearchEnabled() && isLocalElasticsearchUrl(esUrl || requireElasticsearchUrl()));
  const probe = await ensureLocalElasticsearch({ repair: shouldRepair, esUrl });
  assertElasticsearchAvailable(probe);
  return probe;
}
