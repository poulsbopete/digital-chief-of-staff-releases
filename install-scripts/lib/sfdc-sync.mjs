/**
 * Incremental CRM → DCOS Elasticsearch sync (BigQuery or Salesforce CLI).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { getCrmConnection, fetchModifiedRecords, fetchPipelineSnapshot, getCrmSource } from "./crm-backend.mjs";
import { isTableConfigured } from "./bq-crm.mjs";
import { createEsClient, getIndexNames } from "./elasticsearch.mjs";
import { requireElasticsearch } from "./ensure-local-elasticsearch.mjs";
import { SYNC_OBJECTS } from "./sfdc-objects.mjs";

function defaultWatermarkPath() {
  if (process.env.DCOS_SFDC_WATERMARK_FILE) return process.env.DCOS_SFDC_WATERMARK_FILE;
  const preferred = resolve(homedir(), ".config", "dcos", "sfdc-watermark.json");
  if (existsSync(dirname(preferred))) return preferred;
  return resolve(process.cwd(), ".dcos-sfdc-watermark.json");
}

function log(msg, extra) {
  if (extra !== undefined) console.error(`[dcos-sfdc-sync] ${msg}`, extra);
  else console.error(`[dcos-sfdc-sync] ${msg}`);
}

function loadWatermarks(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveWatermarks(file, wm) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(wm, null, 2) + "\n");
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function upsertInBatches(es, index, docs, batchSize = 2000) {
  for (let i = 0; i < docs.length; i += batchSize) {
    await es.bulkUpsert(index, docs.slice(i, i + batchSize));
  }
}

export async function syncSalesforceToElasticsearch({
  objects = ["Opportunity", "Account", "Task", "Event"],
  lookbackDays = 30,
  watermarkFile = defaultWatermarkPath(),
  fullSnapshot = false,
  openPipelineOnly = false,
} = {}) {
  await requireElasticsearch();
  const es = createEsClient();
  await es.ensureAllIndices();
  const indices = getIndexNames();
  const indexByKey = {
    notes: indices.notes,
    opportunities: indices.opportunities,
    activities: indices.activities,
    signals: indices.signals,
  };

  const session = await getCrmConnection();
  const source = getCrmSource();
  const watermarks = loadWatermarks(watermarkFile);
  const stats = {};

  for (const objectType of objects) {
    const cfg = SYNC_OBJECTS[objectType];
    if (!cfg) continue;
    if (source === "bigquery" && !isTableConfigured(objectType)) {
      stats[objectType] = { skipped: true, reason: "table not configured" };
      continue;
    }
    if (source === "bigquery" && objectType === "Account") {
      const acctTable = process.env.DCOS_BQ_TABLE_ACCOUNT?.trim() || "";
      if (/dim_account|csg_mart__dim_account/i.test(acctTable)) {
        stats[objectType] = {
          skipped: true,
          reason: "dim_account has no last_modified column — use dcos_sfdc_query for account lookups",
        };
        continue;
      }
    }

    const wmKey = objectType;
    let rows;
    let since = watermarks[wmKey] || isoDaysAgo(lookbackDays);

    if (fullSnapshot && objectType === "Opportunity" && source === "bigquery") {
      log(`full certified pipeline snapshot (openOnly=${openPipelineOnly})`);
      rows = await fetchPipelineSnapshot({ openOnly: openPipelineOnly });
      since = "full_snapshot";
    } else {
      log(`querying ${objectType} since ${since} (${source})`);
      rows = await fetchModifiedRecords(objectType, since);
    }

    const targetIndex = indexByKey[cfg.index];
    let upserted = 0;

    if (rows.length) {
      const docs = rows.map(cfg.toEs);
      await upsertInBatches(es, targetIndex, docs);
      upserted = docs.length;
      const lastMod = rows[rows.length - 1].LastModifiedDate;
      if (lastMod && !fullSnapshot) watermarks[wmKey] = lastMod;
    }

    stats[objectType] = { fetched: rows.length, upserted, index: targetIndex, since };
  }

  saveWatermarks(watermarkFile, watermarks);
  return { ok: true, stats, watermark_file: watermarkFile, crm_source: session.source };
}
